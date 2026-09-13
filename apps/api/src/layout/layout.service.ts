import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@restaurant/database';
import type {
  AreaMap,
  AreaRecord,
  LayoutChanges,
  TableRecord,
  TableStatus,
} from '@restaurant/shared-types';
import type {
  AreaInput,
  TableGeometryInput,
  TableInput,
  layoutChangesSchema,
  layoutListSchema,
  tableListSchema,
} from '@restaurant/validation';
import type { z } from 'zod';
import type { Principal } from '../auth/auth.service';
import { audit } from '../audit';
import { DatabaseService } from '../database.service';

const scope = (p: Principal) => ({ organizationId: p.organizationId, branchId: p.branchId });
const context = (p: Principal) => ({
  ...scope(p),
  userId: p.userId,
  terminalId: p.terminalId,
  requestId: p.requestId,
  ip: p.ip,
});
const transactionOptions = { isolationLevel: 'Serializable' as const, timeout: 15000 };
function areaRecord(r: Prisma.AreaGetPayload<object>): AreaRecord {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    sortOrder: r.sortOrder,
    active: r.active,
    canvasWidth: r.canvasWidth,
    canvasHeight: r.canvasHeight,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    deletedAt: r.deletedAt?.toISOString() ?? null,
  };
}
function tableRecord(r: Prisma.RestaurantTableGetPayload<object>): TableRecord {
  return {
    id: r.id,
    areaId: r.areaId,
    name: r.name,
    number: r.number,
    capacity: r.capacity,
    positionX: r.positionX,
    positionY: r.positionY,
    width: r.width,
    height: r.height,
    shape: r.shape,
    active: r.active,
    status: r.status,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    deletedAt: r.deletedAt?.toISOString() ?? null,
  };
}
@Injectable()
export class LayoutService {
  constructor(private readonly db: DatabaseService) {}
  getArea(p: Principal, id: string) {
    return this.area(this.db.client, p, id);
  }
  getTable(p: Principal, id: string) {
    return this.table(this.db.client, p, id);
  }
  private async area(tx: Prisma.TransactionClient, p: Principal, id: string) {
    const row = await tx.area.findFirst({ where: { ...scope(p), id } });
    if (!row) throw new NotFoundException('Area not found');
    return areaRecord(row);
  }
  private async table(tx: Prisma.TransactionClient, p: Principal, id: string) {
    const row = await tx.restaurantTable.findFirst({ where: { ...scope(p), id } });
    if (!row) throw new NotFoundException('Table not found');
    return tableRecord(row);
  }
  private editable(row: { deletedAt: string | null; version: number }, version: number) {
    if (row.deletedAt) throw new ConflictException('Archived layout records cannot be changed');
    if (row.version !== version)
      throw new ConflictException('The layout changed. Reload before saving.');
  }
  private movable(row: TableRecord) {
    if (!['FREE', 'DISABLED'].includes(row.status))
      throw new ConflictException('Free the table before moving, resizing or archiving it');
  }
  async emit(
    tx: Prisma.TransactionClient,
    p: Principal,
    entityType: 'Area' | 'RestaurantTable',
    action: string,
    after: AreaRecord | TableRecord,
    before?: AreaRecord | TableRecord,
  ) {
    const counter = await tx.layoutRevision.upsert({
      where: { branchId: p.branchId },
      create: { ...scope(p), revision: 1n },
      update: { revision: { increment: 1n } },
    });
    await audit(tx, context(p), action, entityType, after.id, before ? { ...before } : undefined, {
      ...after,
    });
    await tx.layoutEvent.create({
      data: {
        ...scope(p),
        revision: counter.revision,
        entityType,
        entityId: after.id,
        entityVersion: after.version,
        action,
      },
    });
  }
  async areas(p: Principal, q: z.infer<typeof layoutListSchema>) {
    const rows = await this.db.client.area.findMany({
      where: {
        ...scope(p),
        deletedAt: q.archived === 'true' ? { not: null } : null,
        name: { contains: q.search, mode: 'insensitive' },
      },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      skip: (q.page - 1) * q.limit,
      take: q.limit + 1,
    });
    return {
      items: rows.slice(0, q.limit).map(areaRecord),
      page: q.page,
      hasMore: rows.length > q.limit,
    };
  }
  async tables(p: Principal, q: z.infer<typeof tableListSchema>) {
    const rows = await this.db.client.restaurantTable.findMany({
      where: {
        ...scope(p),
        areaId: q.areaId,
        deletedAt: q.archived === 'true' ? { not: null } : null,
        name: { contains: q.search, mode: 'insensitive' },
      },
      orderBy: [{ number: 'asc' }, { id: 'asc' }],
      skip: (q.page - 1) * q.limit,
      take: q.limit + 1,
    });
    return {
      items: rows.slice(0, q.limit).map(tableRecord),
      page: q.page,
      hasMore: rows.length > q.limit,
    };
  }
  async changes(p: Principal, q: z.infer<typeof layoutChangesSchema>): Promise<LayoutChanges> {
    const rows = await this.db.client.layoutEvent.findMany({
      where: { ...scope(p), revision: { gt: BigInt(q.after) } },
      orderBy: { revision: 'asc' },
      take: q.limit + 1,
    });
    const events = rows.slice(0, q.limit).map((r) => ({
      id: r.id,
      revision: r.revision.toString(),
      entityType: r.entityType,
      entityId: r.entityId,
      entityVersion: r.entityVersion,
      action: r.action,
      createdAt: r.createdAt.toISOString(),
    }));
    return { events, cursor: events.at(-1)?.revision ?? q.after, hasMore: rows.length > q.limit };
  }
  map(p: Principal, id: string): Promise<AreaMap> {
    return this.db.client.$transaction(
      async (tx) => {
        const revision = await tx.layoutRevision.findFirst({ where: scope(p) });
        const area = await this.area(tx, p, id);
        const tables = await tx.restaurantTable.findMany({
          where: { ...scope(p), areaId: id, deletedAt: null },
          orderBy: { number: 'asc' },
        });
        return {
          area,
          tables: tables.map(tableRecord),
          revision: revision?.revision.toString() ?? '0',
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async saveArea(p: Principal, input: AreaInput, id?: string, version?: number) {
    return this.db.client.$transaction(async (tx) => {
      const before = id ? await this.area(tx, p, id) : undefined;
      if (before) {
        this.editable(before, version!);
        const tables = await tx.restaurantTable.findMany({
          where: { ...scope(p), areaId: id, deletedAt: null },
        });
        if (
          tables.some(
            (t) =>
              t.positionX + t.width > input.canvasWidth ||
              t.positionY + t.height > input.canvasHeight,
          )
        )
          throw new ConflictException('Area size would clip an existing table');
        if (!input.active && tables.some((t) => t.active))
          throw new ConflictException('Disable all tables before deactivating this area');
      }
      const row = id
        ? await tx.area.update({
            where: { ...scope(p), id, version, deletedAt: null },
            data: { ...input, version: { increment: 1 } },
          })
        : await tx.area.create({ data: { ...scope(p), ...input } });
      const after = areaRecord(row);
      await this.emit(
        tx,
        p,
        'Area',
        id ? 'layout.area.updated' : 'layout.area.created',
        after,
        before,
      );
      return after;
    }, transactionOptions);
  }
  archiveArea(p: Principal, id: string, version: number) {
    return this.db.client.$transaction(async (tx) => {
      const before = await this.area(tx, p, id);
      this.editable(before, version);
      if (await tx.restaurantTable.count({ where: { ...scope(p), areaId: id, deletedAt: null } }))
        throw new ConflictException('Archive or move all tables before archiving the area');
      const after = areaRecord(
        await tx.area.update({
          where: { ...scope(p), id, version, deletedAt: null },
          data: { active: false, deletedAt: new Date(), version: { increment: 1 } },
        }),
      );
      await this.emit(tx, p, 'Area', 'layout.area.archived', after, before);
      return after;
    }, transactionOptions);
  }
  private async fit(tx: Prisma.TransactionClient, p: Principal, data: TableInput, id?: string) {
    const area = await this.area(tx, p, data.areaId);
    if (area.deletedAt) throw new ConflictException('Area is archived');
    if (
      data.positionX + data.width > area.canvasWidth ||
      data.positionY + data.height > area.canvasHeight
    )
      throw new ConflictException('Table must fit inside its area');
    const others = await tx.restaurantTable.findMany({
      where: {
        ...scope(p),
        areaId: data.areaId,
        deletedAt: null,
        ...(id ? { id: { not: id } } : {}),
      },
      select: { positionX: true, positionY: true, width: true, height: true },
    });
    if (
      others.some(
        (t) =>
          data.positionX < t.positionX + t.width &&
          data.positionX + data.width > t.positionX &&
          data.positionY < t.positionY + t.height &&
          data.positionY + data.height > t.positionY,
      )
    )
      throw new ConflictException('Table overlaps another table');
    return area;
  }
  private async writeTable(
    tx: Prisma.TransactionClient,
    p: Principal,
    input: TableInput,
    id?: string,
    version?: number,
    action = 'layout.table.updated',
  ) {
    const before = id ? await this.table(tx, p, id) : undefined;
    if (before) {
      this.editable(before, version!);
      this.movable(before);
    }
    const area = await this.fit(tx, p, input, id);
    if (!area.active && (!before || before.active || before.areaId !== input.areaId))
      throw new ConflictException('Area is inactive');
    const row = id
      ? await tx.restaurantTable.update({
          where: { ...scope(p), id, version, deletedAt: null },
          data: { ...input, version: { increment: 1 } },
        })
      : await tx.restaurantTable.create({ data: { ...scope(p), ...input } });
    const after = tableRecord(row);
    await this.emit(tx, p, 'RestaurantTable', id ? action : 'layout.table.created', after, before);
    return after;
  }
  saveTable(p: Principal, input: TableInput, id?: string, version?: number) {
    return this.db.client.$transaction(
      (tx) => this.writeTable(tx, p, input, id, version),
      transactionOptions,
    );
  }
  geometry(p: Principal, id: string, input: TableGeometryInput) {
    return this.db.client.$transaction(async (tx) => {
      const before = await this.table(tx, p, id);
      const { version, ...geometry } = input;
      return this.writeTable(
        tx,
        p,
        {
          areaId: before.areaId,
          name: before.name,
          number: before.number,
          capacity: before.capacity,
          ...geometry,
        },
        id,
        version,
        'layout.table.geometry_changed',
      );
    }, transactionOptions);
  }
  status(p: Principal, id: string, version: number, status: 'FREE' | 'RESERVED' | 'DISABLED') {
    return this.db.client.$transaction(async (tx) => {
      const before = await this.table(tx, p, id);
      this.editable(before, version);
      const transitions: Partial<Record<TableStatus, readonly TableStatus[]>> = {
        FREE: ['RESERVED', 'DISABLED'],
        RESERVED: ['FREE'],
        DISABLED: ['FREE'],
      };
      if (before.status === status) return before;
      if (!transitions[before.status]?.includes(status))
        throw new ConflictException(
          'This status transition is not available in the layout foundation',
        );
      const area = await this.area(tx, p, before.areaId);
      if (status !== 'DISABLED' && (!area.active || area.deletedAt))
        throw new ConflictException('Area is unavailable');
      const after = tableRecord(
        await tx.restaurantTable.update({
          where: { ...scope(p), id, version, deletedAt: null },
          data: { status, active: status !== 'DISABLED', version: { increment: 1 } },
        }),
      );
      await this.emit(tx, p, 'RestaurantTable', 'layout.table.status_changed', after, before);
      return after;
    }, transactionOptions);
  }
  archiveTable(p: Principal, id: string, version: number) {
    return this.db.client.$transaction(async (tx) => {
      const before = await this.table(tx, p, id);
      this.editable(before, version);
      this.movable(before);
      const after = tableRecord(
        await tx.restaurantTable.update({
          where: { ...scope(p), id, version, deletedAt: null },
          data: {
            status: 'DISABLED',
            active: false,
            deletedAt: new Date(),
            version: { increment: 1 },
          },
        }),
      );
      await this.emit(tx, p, 'RestaurantTable', 'layout.table.archived', after, before);
      return after;
    }, transactionOptions);
  }
}
