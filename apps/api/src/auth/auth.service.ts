import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes, createHash } from 'node:crypto';
import { hash, verify, argon2id } from 'argon2';
import jwt from 'jsonwebtoken';
import type { Prisma } from '@restaurant/database';
import { PERMISSIONS, type PermissionKey, type SessionUser } from '@restaurant/shared-types';
import { DatabaseService } from '../database.service';
import { ACCESS_SECONDS, SESSION_MS, getConfig } from '../config';
import { audit, type AuditContext } from '../audit';

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const hashPassword = (password: string) =>
  hash(password, { type: argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
const sessionInclude = {
  membership: {
    include: {
      user: { include: { organization: true } },
      branch: true,
      roles: { include: { role: { include: { permissions: true } } } },
    },
  },
  terminal: true,
} as const;
type LoadedSession = Prisma.AuthSessionGetPayload<{ include: typeof sessionInclude }>;
export interface Principal extends AuditContext {
  userId: string;
  branchId: string;
  organizationId: string;
  sessionId: string;
  permissions: PermissionKey[];
  user: SessionUser;
}

@Injectable()
export class AuthService {
  private readonly config = getConfig();
  private readonly dummyHash = hashPassword(randomBytes(32).toString('hex'));
  constructor(private readonly db: DatabaseService) {}

  private principal(session: LoadedSession | null): Principal | null {
    if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
    const { membership, terminal } = session;
    const { user, branch } = membership;
    if (
      !membership.active ||
      !user.active ||
      user.deletedAt ||
      !branch.active ||
      branch.deletedAt ||
      !user.organization.active ||
      user.organization.deletedAt ||
      (session.terminalId && (!terminal?.active || terminal.deletedAt))
    )
      return null;
    const permissions = [
      ...new Set(
        membership.roles.flatMap(({ role }) =>
          role.permissions.map(({ permissionKey }) => permissionKey),
        ),
      ),
    ].filter((key): key is PermissionKey => PERMISSIONS.includes(key as PermissionKey));
    return {
      userId: user.id,
      organizationId: session.organizationId,
      branchId: session.branchId,
      terminalId: session.terminalId ?? undefined,
      sessionId: session.id,
      permissions,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        organizationId: session.organizationId,
        branchId: session.branchId,
        branchName: branch.name,
        permissions,
      },
    };
  }
  async authenticate(token: string): Promise<Principal> {
    try {
      const claims = jwt.verify(token, this.config.JWT_SECRET, {
        algorithms: ['HS256'],
        issuer: 'restaurant-local',
        audience: 'restaurant-clients',
      });
      if (
        typeof claims === 'string' ||
        typeof claims.sid !== 'string' ||
        typeof claims.sub !== 'string'
      )
        throw new UnauthorizedException();
      const principal = this.principal(
        await this.db.client.authSession.findUnique({
          where: { id: claims.sid },
          include: sessionInclude,
        }),
      );
      if (!principal || principal.userId !== claims.sub) throw new UnauthorizedException();
      return principal;
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError || error instanceof UnauthorizedException)
        throw new UnauthorizedException('Authentication required');
      throw error;
    }
  }
  private result(principal: Principal, refreshToken: string, expiresAt: Date) {
    return {
      accessToken: jwt.sign({ sid: principal.sessionId }, this.config.JWT_SECRET, {
        algorithm: 'HS256',
        subject: principal.userId,
        issuer: 'restaurant-local',
        audience: 'restaurant-clients',
        expiresIn: ACCESS_SECONDS,
      }),
      expiresIn: ACCESS_SECONDS,
      user: principal.user,
      refreshToken,
      expiresAt,
    };
  }
  async login(
    input: {
      organization: string;
      branch: string;
      email: string;
      password: string;
      terminalId?: string;
    },
    context: AuditContext,
  ) {
    const user = await this.db.client.user.findFirst({
      where: { email: input.email, organization: { slug: input.organization } },
    });
    const validPassword = await verify(
      user?.passwordHash ?? (await this.dummyHash),
      input.password,
    );
    const branch = user
      ? await this.db.client.branch.findUnique({
          where: {
            organizationId_code: { organizationId: user.organizationId, code: input.branch },
          },
        })
      : null;
    const membership =
      user && branch
        ? await this.db.client.branchMembership.findUnique({
            where: { userId_branchId: { userId: user.id, branchId: branch.id } },
          })
        : null;
    const terminal =
      input.terminalId && branch
        ? await this.db.client.terminal.findFirst({
            where: {
              id: input.terminalId,
              branchId: branch.id,
              organizationId: branch.organizationId,
              active: true,
              deletedAt: null,
            },
          })
        : null;
    if (
      !user ||
      !branch ||
      !membership ||
      !validPassword ||
      !user.active ||
      user.deletedAt ||
      !branch.active ||
      branch.deletedAt ||
      !membership.active ||
      (input.terminalId && !terminal)
    ) {
      await audit(
        this.db.client,
        { requestId: context.requestId, ip: context.ip },
        'auth.login_failed',
        'Authentication',
      );
      throw new UnauthorizedException('Invalid credentials or unavailable branch');
    }
    const refreshToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_MS);
    const principal = await this.db.client.$transaction(async (tx) => {
      const session = await tx.authSession.create({
        data: {
          userId: user.id,
          branchId: branch.id,
          organizationId: user.organizationId,
          terminalId: input.terminalId,
          expiresAt,
          tokens: { create: { tokenHash: hashToken(refreshToken), expiresAt } },
        },
        include: sessionInclude,
      });
      const principal = this.principal(session);
      if (!principal) throw new UnauthorizedException('Invalid credentials or unavailable branch');
      await audit(
        tx,
        {
          ...context,
          userId: user.id,
          branchId: branch.id,
          organizationId: user.organizationId,
          terminalId: input.terminalId,
        },
        'auth.login',
        'AuthSession',
        session.id,
      );
      if (terminal)
        await tx.terminal.update({ where: { id: terminal.id }, data: { lastSeenAt: new Date() } });
      return principal;
    });
    return this.result(principal, refreshToken, expiresAt);
  }
  /**
   * Sign in with a staff card.
   *
   * Deliberately the same shape as password login: the same branch, membership, terminal
   * and active checks, the same audited failure, the same session and the same principal.
   * Only the credential differs.
   *
   * The client sends a card and the branch it is standing in. It never sends a user, a
   * role or a permission: identity is resolved from the credential, and authority comes
   * from the roles that user already holds.
   */
  async nfcLogin(
    input: { organization: string; branch: string; credential: string; terminalId?: string },
    context: AuditContext,
  ) {
    const branch = await this.db.client.branch.findFirst({
      where: { code: input.branch, organization: { slug: input.organization } },
    });
    const candidates = branch
      ? await this.db.client.userNfcCredential.findMany({
          where: { branchId: branch.id, organizationId: branch.organizationId, revokedAt: null },
          include: { member: { include: { user: true } } },
        })
      : [];
    // Compare against every live card in the branch. A restaurant has a handful of
    // staff, and the alternative - indexing by a reversible value - would mean storing
    // something equivalent to the card itself.
    let matched: (typeof candidates)[number] | null = null;
    for (const candidate of candidates)
      if (await verify(candidate.credentialHash, input.credential)) {
        matched = candidate;
        break;
      }
    // Spend comparable work when nothing matched, so a valid card is not distinguishable
    // from an unknown one by how long the answer takes.
    if (!matched) await verify(await this.dummyHash, input.credential);

    const terminal =
      input.terminalId && branch
        ? await this.db.client.terminal.findFirst({
            where: {
              id: input.terminalId,
              branchId: branch.id,
              organizationId: branch.organizationId,
              active: true,
              deletedAt: null,
            },
          })
        : null;
    const member = matched?.member;
    if (
      !branch ||
      !matched ||
      !member ||
      !member.active ||
      !member.user.active ||
      member.user.deletedAt ||
      !branch.active ||
      branch.deletedAt ||
      (input.terminalId && !terminal)
    ) {
      await audit(
        this.db.client,
        { requestId: context.requestId, ip: context.ip },
        'auth.nfc_login_failed',
        'Authentication',
      );
      throw new UnauthorizedException('This card is not recognised');
    }
    const refreshToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_MS);
    const principal = await this.db.client.$transaction(async (tx) => {
      const session = await tx.authSession.create({
        data: {
          userId: member.userId,
          branchId: branch.id,
          organizationId: branch.organizationId,
          terminalId: input.terminalId,
          expiresAt,
          tokens: { create: { tokenHash: hashToken(refreshToken), expiresAt } },
        },
        include: sessionInclude,
      });
      const principal = this.principal(session);
      if (!principal) throw new UnauthorizedException('This card is not recognised');
      await audit(
        tx,
        {
          ...context,
          userId: member.userId,
          branchId: branch.id,
          organizationId: branch.organizationId,
          terminalId: input.terminalId,
        },
        'auth.nfc_login',
        'AuthSession',
        session.id,
      );
      await tx.userNfcCredential.update({
        where: { id: matched.id },
        data: { lastUsedAt: new Date() },
      });
      if (terminal)
        await tx.terminal.update({ where: { id: terminal.id }, data: { lastSeenAt: new Date() } });
      return principal;
    });
    return this.result(principal, refreshToken, expiresAt);
  }
  async refresh(rawToken: string | undefined, context: AuditContext) {
    if (!rawToken || !/^[A-Za-z0-9_-]{43}$/.test(rawToken))
      throw new UnauthorizedException('Invalid session');
    const nextToken = randomBytes(32).toString('base64url');
    const result = await this.db.client.$transaction(async (tx) => {
      const token = await tx.refreshToken.findUnique({
        where: { tokenHash: hashToken(rawToken) },
        include: { session: { include: sessionInclude } },
      });
      if (!token) return null;
      // CAS serializes concurrent use of the same secret. Reuse revokes the entire family.
      const consumed = await tx.refreshToken.updateMany({
        where: { id: token.id, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() },
      });
      const principal = this.principal(token.session);
      const safeContext = {
        ...context,
        userId: token.session.userId,
        branchId: token.session.branchId,
        organizationId: token.session.organizationId,
        terminalId: token.session.terminalId ?? undefined,
      };
      if (consumed.count !== 1 || !principal) {
        await tx.authSession.update({
          where: { id: token.sessionId },
          data: { revokedAt: new Date() },
        });
        await audit(
          tx,
          safeContext,
          token.consumedAt || consumed.count !== 1 ? 'auth.refresh_reuse' : 'auth.session_rejected',
          'AuthSession',
          token.sessionId,
        );
        return null; // Commit revocation before returning an HTTP error.
      }
      await tx.refreshToken.create({
        data: {
          sessionId: token.sessionId,
          tokenHash: hashToken(nextToken),
          expiresAt: token.session.expiresAt,
        },
      });
      return { principal, expiresAt: token.session.expiresAt };
    });
    if (!result) throw new UnauthorizedException('Invalid session');
    return this.result(result.principal, nextToken, result.expiresAt);
  }
  async logout(rawToken: string | undefined, context: AuditContext) {
    if (!rawToken || !/^[A-Za-z0-9_-]{43}$/.test(rawToken)) return;
    await this.db.client.$transaction(async (tx) => {
      const token = await tx.refreshToken.findUnique({
        where: { tokenHash: hashToken(rawToken) },
        include: { session: true },
      });
      if (!token || token.session.revokedAt) return;
      await tx.authSession.update({
        where: { id: token.sessionId },
        data: { revokedAt: new Date() },
      });
      await audit(
        tx,
        {
          ...context,
          userId: token.session.userId,
          branchId: token.session.branchId,
          organizationId: token.session.organizationId,
        },
        'auth.logout',
        'AuthSession',
        token.sessionId,
      );
    });
  }
  async changePassword(principal: Principal, currentPassword: string, newPassword: string) {
    const user = await this.db.client.user.findUniqueOrThrow({ where: { id: principal.userId } });
    if (!(await verify(user.passwordHash, currentPassword)))
      throw new UnauthorizedException('Current password is incorrect');
    const passwordHash = await hashPassword(newPassword);
    await this.db.client.$transaction(async (tx) => {
      const changed = await tx.user.updateMany({
        where: {
          id: principal.userId,
          organizationId: principal.organizationId,
          passwordHash: user.passwordHash,
        },
        data: { passwordHash },
      });
      if (changed.count !== 1)
        throw new UnauthorizedException('Password changed concurrently; sign in again');
      await tx.authSession.updateMany({
        where: {
          userId: principal.userId,
          organizationId: principal.organizationId,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
      await audit(
        tx,
        {
          userId: principal.userId,
          organizationId: principal.organizationId,
          branchId: principal.branchId,
          terminalId: principal.terminalId,
          requestId: principal.requestId,
          ip: principal.ip,
        },
        'auth.password_changed',
        'User',
        principal.userId,
      );
    });
  }
}
