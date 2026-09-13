import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@restaurant/database';
import type { PermissionKey } from '@restaurant/shared-types';
import type { z } from 'zod';
import type {
  createUserSchema,
  terminalSchema,
  updateTerminalSchema,
} from '@restaurant/validation';
import { DatabaseService } from '../database.service';
import { audit } from '../audit';
import { hashPassword, type Principal } from '../auth/auth.service';

@Injectable()
export class FoundationService {
  constructor(private readonly db: DatabaseService) {}
  private scope(p: Principal) {
    return { organizationId: p.organizationId, branchId: p.branchId };
  }
  private context(p: Principal) {
    return {
      ...this.scope(p),
      userId: p.userId,
      terminalId: p.terminalId,
      requestId: p.requestId,
      ip: p.ip,
    };
  }
  organization(p: Principal) {
    return this.db.client.organization.findUniqueOrThrow({
      where: { id: p.organizationId },
      select: { id: true, name: true, slug: true },
    });
  }
  branch(p: Principal) {
    return this.db.client.branch.findFirstOrThrow({
      where: { id: p.branchId, organizationId: p.organizationId },
      select: { id: true, name: true, code: true, currency: true, timezone: true },
    });
  }
  users(p: Principal) {
    return this.db.client.branchMembership.findMany({
      where: this.scope(p),
      select: {
        active: true,
        user: { select: { id: true, name: true, email: true, active: true, createdAt: true } },
        roles: { select: { role: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
  }
  roles(p: Principal) {
    return this.db.client.role.findMany({
      where: { organizationId: p.organizationId },
      select: {
        id: true,
        name: true,
        protected: true,
        permissions: { select: { permissionKey: true } },
      },
      orderBy: { name: 'asc' },
      take: 200,
    });
  }
  async grantableRoles(tx: Prisma.TransactionClient, p: Principal, roleIds: string[]) {
    const unique = [...new Set(roleIds)];
    const roles = await tx.role.findMany({
      where: { id: { in: unique }, organizationId: p.organizationId },
      include: { permissions: true },
    });
    if (roles.length !== unique.length) throw new NotFoundException('Role not found');
    if (
      roles.some(
        (role) =>
          role.protected ||
          role.permissions.some(
            ({ permissionKey }) => !p.permissions.includes(permissionKey as PermissionKey),
          ),
      )
    )
      throw new ForbiddenException('Cannot grant these roles');
    return unique;
  }
  async createUser(p: Principal, data: z.infer<typeof createUserSchema>) {
    const passwordHash = await hashPassword(data.password);
    return this.db.client.$transaction(
      async (tx) => {
        const roleIds = await this.grantableRoles(tx, p, data.roleIds);
        const user = await tx.user.create({
          data: {
            organizationId: p.organizationId,
            name: data.name,
            email: data.email,
            passwordHash,
          },
          select: { id: true, name: true, email: true, active: true },
        });
        await tx.branchMembership.create({ data: { ...this.scope(p), userId: user.id } });
        await tx.userBranchRole.createMany({
          data: roleIds.map((roleId) => ({ ...this.scope(p), userId: user.id, roleId })),
        });
        await audit(tx, this.context(p), 'user.created', 'User', user.id, undefined, {
          name: user.name,
          roleIds,
        });
        return user;
      },
      { isolationLevel: 'Serializable' },
    );
  }
  private async editableMembership(tx: Prisma.TransactionClient, p: Principal, userId: string) {
    const membership = await tx.branchMembership.findFirst({
      where: { ...this.scope(p), userId },
      include: { roles: { include: { role: true } } },
    });
    if (!membership) throw new NotFoundException('User not found');
    if (userId === p.userId || membership.roles.some(({ role }) => role.protected))
      throw new ForbiddenException('Cannot change your own access or protected owner access');
    return membership;
  }
  async setUserActive(p: Principal, userId: string, active: boolean) {
    return this.db.client.$transaction(
      async (tx) => {
        const membership = await this.editableMembership(tx, p, userId);
        await tx.branchMembership.update({
          where: { userId_branchId: { userId, branchId: p.branchId } },
          data: { active },
        });
        if (!active)
          await tx.authSession.updateMany({
            where: { ...this.scope(p), userId, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        await audit(
          tx,
          this.context(p),
          'user.branch_access_changed',
          'User',
          userId,
          { active: membership.active },
          { active },
        );
        return { id: userId, active };
      },
      { isolationLevel: 'Serializable' },
    );
  }
  async assignRoles(p: Principal, userId: string, requestedRoleIds: string[]) {
    return this.db.client.$transaction(
      async (tx) => {
        const membership = await this.editableMembership(tx, p, userId);
        const roleIds = await this.grantableRoles(tx, p, requestedRoleIds);
        await tx.userBranchRole.deleteMany({ where: { ...this.scope(p), userId } });
        await tx.userBranchRole.createMany({
          data: roleIds.map((roleId) => ({ ...this.scope(p), userId, roleId })),
        });
        await audit(
          tx,
          this.context(p),
          'user.roles_changed',
          'User',
          userId,
          { roleIds: membership.roles.map((r) => r.roleId) },
          { roleIds },
        );
        return { id: userId, roleIds };
      },
      { isolationLevel: 'Serializable' },
    );
  }
  private ensureGrantable(p: Principal, permissions: PermissionKey[]) {
    if (!permissions.every((key) => p.permissions.includes(key)))
      throw new ForbiddenException('Cannot grant permissions you do not possess');
  }
  async createRole(p: Principal, name: string, permissions: PermissionKey[]) {
    this.ensureGrantable(p, permissions);
    return this.db.client.$transaction(
      async (tx) => {
        const role = await tx.role.create({
          data: {
            organizationId: p.organizationId,
            name,
            permissions: {
              create: [...new Set(permissions)].map((permissionKey) => ({ permissionKey })),
            },
          },
          select: { id: true, name: true },
        });
        await audit(tx, this.context(p), 'role.created', 'Role', role.id, undefined, {
          name,
          permissions,
        });
        return role;
      },
      { isolationLevel: 'Serializable' },
    );
  }
  async updateRole(p: Principal, roleId: string, permissions: PermissionKey[]) {
    this.ensureGrantable(p, permissions);
    return this.db.client.$transaction(
      async (tx) => {
        const role = await tx.role.findFirst({
          where: { id: roleId, organizationId: p.organizationId },
          include: { permissions: true },
        });
        if (!role) throw new NotFoundException('Role not found');
        if (role.protected)
          throw new ForbiddenException(
            'Protected owner role requires an operator-controlled migration',
          );
        if (
          await tx.userBranchRole.findFirst({
            where: {
              roleId,
              OR: [{ userId: p.userId, branchId: p.branchId }, { branchId: { not: p.branchId } }],
            },
          })
        )
          throw new ConflictException(
            'Cannot edit a role assigned to yourself or another branch; create a dedicated role',
          );
        await tx.rolePermission.deleteMany({ where: { roleId } });
        await tx.rolePermission.createMany({
          data: [...new Set(permissions)].map((permissionKey) => ({ roleId, permissionKey })),
        });
        await tx.role.update({ where: { id: roleId }, data: { updatedAt: new Date() } });
        await audit(
          tx,
          this.context(p),
          'role.permissions_changed',
          'Role',
          roleId,
          { permissions: role.permissions.map((r) => r.permissionKey) },
          { permissions },
        );
        return { id: roleId, permissions };
      },
      { isolationLevel: 'Serializable' },
    );
  }
  terminals(p: Principal) {
    return this.db.client.terminal.findMany({
      where: { ...this.scope(p), deletedAt: null },
      orderBy: { name: 'asc' },
      take: 200,
    });
  }
  async createTerminal(p: Principal, data: z.infer<typeof terminalSchema>) {
    return this.db.client.$transaction(async (tx) => {
      const terminal = await tx.terminal.create({ data: { ...this.scope(p), ...data } });
      await audit(tx, this.context(p), 'terminal.registered', 'Terminal', terminal.id, undefined, {
        name: terminal.name,
        type: terminal.type,
      });
      return terminal;
    });
  }
  async updateTerminal(
    p: Principal,
    terminalId: string,
    data: z.infer<typeof updateTerminalSchema>,
  ) {
    return this.db.client.$transaction(async (tx) => {
      const before = await tx.terminal.findFirst({
        where: { ...this.scope(p), id: terminalId, deletedAt: null },
      });
      if (!before) throw new NotFoundException('Terminal not found');
      const terminal = await tx.terminal.update({ where: { id: terminalId }, data });
      if (data.active === false)
        await tx.authSession.updateMany({
          where: { ...this.scope(p), terminalId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      await audit(
        tx,
        this.context(p),
        'terminal.changed',
        'Terminal',
        terminal.id,
        { name: before.name, active: before.active },
        { name: terminal.name, active: terminal.active },
      );
      return terminal;
    });
  }
  async heartbeat(p: Principal) {
    if (!p.terminalId) throw new ForbiddenException('Session is not bound to a terminal');
    await this.db.client.terminal.updateMany({
      where: { ...this.scope(p), id: p.terminalId, active: true, deletedAt: null },
      data: { lastSeenAt: new Date() },
    });
    return { ok: true };
  }
  auditLogs(p: Principal) {
    return this.db.client.auditLog.findMany({
      where: this.scope(p),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
  }
}
