import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@restaurant/database';
import type { MenuKind, MenuPage, MenuRecord } from '@restaurant/shared-types';
import type { MenuInput, menuListSchema } from '@restaurant/validation';
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
const productInclude = {
  modifierGroups: { orderBy: { sortOrder: 'asc' as const } },
  kitchenStations: { orderBy: { sortOrder: 'asc' as const } },
};
type Raw =
  | Prisma.CategoryGetPayload<object>
  | Prisma.KitchenStationGetPayload<object>
  | Prisma.ModifierGroupGetPayload<object>
  | Prisma.ModifierGetPayload<object>
  | Prisma.ProductGetPayload<{ include: typeof productInclude }>;
function record(kind: MenuKind, row: Raw): MenuRecord {
  const base: MenuRecord = {
    kind,
    id: row.id,
    name: row.name,
    description: row.description,
    sortOrder: row.sortOrder,
    active: row.active,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
  if ('sku' in row)
    Object.assign(base, {
      sku: row.sku,
      barcode: row.barcode,
      categoryId: row.categoryId,
      sellingPrice: row.sellingPrice.toFixed(2),
      taxRate: row.taxRate.toFixed(2),
      taxMode: row.taxMode,
      imageUrl: row.imageUrl,
      modifierGroupIds: row.modifierGroups.map((link) => link.groupId),
      kitchenStationIds: row.kitchenStations.map((link) => link.stationId),
    });
  if ('minSelections' in row)
    Object.assign(base, { minSelections: row.minSelections, maxSelections: row.maxSelections });
  if ('priceAdjustment' in row)
    Object.assign(base, { groupId: row.groupId, priceAdjustment: row.priceAdjustment.toFixed(2) });
  return base;
}
@Injectable()
export class MenuService {
  constructor(private readonly db: DatabaseService) {}
  private async read(tx: Prisma.TransactionClient, p: Principal, kind: MenuKind, id: string) {
    const where = { id, ...scope(p) };
    let row: Raw | null;
    switch (kind) {
      case 'categories':
        row = await tx.category.findFirst({ where });
        break;
      case 'kitchen-stations':
        row = await tx.kitchenStation.findFirst({ where });
        break;
      case 'modifier-groups':
        row = await tx.modifierGroup.findFirst({ where });
        break;
      case 'modifiers':
        row = await tx.modifier.findFirst({ where });
        break;
      case 'products':
        row = await tx.product.findFirst({ where, include: productInclude });
        break;
    }
    if (!row) throw new NotFoundException('Catalog record not found');
    return record(kind, row);
  }
  get(p: Principal, kind: MenuKind, id: string) {
    return this.read(this.db.client, p, kind, id);
  }
  async list(
    p: Principal,
    kind: MenuKind,
    query: z.infer<typeof menuListSchema>,
  ): Promise<MenuPage> {
    const where = {
      ...scope(p),
      deletedAt: query.archived === 'true' ? { not: null } : null,
      name: { contains: query.search, mode: 'insensitive' as const },
    };
    const args = {
      where,
      skip: (query.page - 1) * query.limit,
      take: query.limit + 1,
      orderBy: [{ sortOrder: 'asc' as const }, { id: 'asc' as const }],
    };
    let rows: Raw[];
    const tx = this.db.client;
    switch (kind) {
      case 'categories':
        rows = await tx.category.findMany(args);
        break;
      case 'kitchen-stations':
        rows = await tx.kitchenStation.findMany(args);
        break;
      case 'modifier-groups':
        rows = await tx.modifierGroup.findMany(args);
        break;
      case 'modifiers':
        rows = await tx.modifier.findMany(args);
        break;
      case 'products':
        rows = await tx.product.findMany({
          ...args,
          where: {
            ...scope(p),
            deletedAt: where.deletedAt,
            OR: ['name', 'sku', 'barcode'].map((field) => ({ [field]: where.name })),
          },
          include: productInclude,
        });
        break;
    }
    return {
      items: rows.slice(0, query.limit).map((row) => record(kind, row)),
      page: query.page,
      hasMore: rows.length > query.limit,
    };
  }
  private editable(row: MenuRecord, version: number) {
    if (row.deletedAt) throw new ConflictException('Archived records cannot be changed');
    if (row.version !== version)
      throw new ConflictException('This record changed. Reload before saving.');
  }
  private async references(tx: Prisma.TransactionClient, p: Principal, data: MenuInput) {
    if (data.kind === 'modifiers') {
      const group = await this.read(tx, p, 'modifier-groups', data.groupId);
      if (group.deletedAt) throw new ConflictException('Modifier group is archived');
    }
    if (data.kind !== 'products') return;
    const category = await this.read(tx, p, 'categories', data.categoryId);
    if (category.deletedAt || (data.active && !category.active))
      throw new ConflictException('Category is unavailable');
    for (const id of data.kitchenStationIds) {
      const station = await this.read(tx, p, 'kitchen-stations', id);
      if (station.deletedAt || (data.active && !station.active))
        throw new ConflictException('Kitchen station is unavailable');
    }
    for (const id of data.modifierGroupIds) {
      const group = await this.read(tx, p, 'modifier-groups', id);
      if (group.deletedAt || (data.active && !group.active))
        throw new ConflictException('Modifier group is unavailable');
      if (data.active) {
        const choices = await tx.modifier.count({
          where: { ...scope(p), groupId: id, active: true, deletedAt: null },
        });
        if (choices < group.minSelections!)
          throw new ConflictException('Required modifier group has insufficient active choices');
      }
    }
  }
  private async dependentCheck(
    tx: Prisma.TransactionClient,
    p: Principal,
    row: MenuRecord,
    archive: boolean,
    input?: MenuInput,
  ) {
    const product = { ...scope(p), deletedAt: null };
    const disabling = archive || input?.active === false;
    if (
      row.kind === 'categories' &&
      disabling &&
      (await tx.product.count({ where: { ...product, categoryId: row.id } }))
    )
      throw new ConflictException('Move or archive products before disabling this category');
    if (
      row.kind === 'kitchen-stations' &&
      disabling &&
      (await tx.productKitchenStation.count({ where: { ...scope(p), stationId: row.id, product } }))
    )
      throw new ConflictException('Detach this station from products first');
    if (row.kind === 'modifier-groups') {
      if (
        disabling &&
        (await tx.productModifierGroup.count({ where: { ...scope(p), groupId: row.id, product } }))
      )
        throw new ConflictException('Detach this modifier group from products first');
      if (
        archive &&
        (await tx.modifier.count({ where: { ...scope(p), groupId: row.id, deletedAt: null } }))
      )
        throw new ConflictException('Archive the group modifiers first');
      if (
        input?.kind === 'modifier-groups' &&
        (await tx.productModifierGroup.count({
          where: { ...scope(p), groupId: row.id, product: { ...product, active: true } },
        }))
      ) {
        const count = await tx.modifier.count({
          where: { ...scope(p), groupId: row.id, active: true, deletedAt: null },
        });
        if (input.minSelections > count)
          throw new ConflictException('Required selections exceed active choices');
      }
    }
    if (row.kind === 'modifiers') {
      if (input?.kind === 'modifiers' && input.groupId !== row.groupId)
        throw new ConflictException('A modifier cannot move to another group');
      if (
        disabling &&
        (await tx.productModifierGroup.count({
          where: { ...scope(p), groupId: row.groupId, product: { ...product, active: true } },
        }))
      ) {
        const group = await this.read(tx, p, 'modifier-groups', row.groupId!);
        const count = await tx.modifier.count({
          where: {
            ...scope(p),
            groupId: row.groupId,
            id: { not: row.id },
            active: true,
            deletedAt: null,
          },
        });
        if (count < group.minSelections!)
          throw new ConflictException('This modifier is required by active products');
      }
    }
  }
  async save(p: Principal, input: MenuInput, id?: string, version?: number) {
    return this.db.client.$transaction(
      async (tx) => {
        const before = id ? await this.read(tx, p, input.kind, id) : undefined;
        if (before) {
          this.editable(before, version!);
          await this.dependentCheck(tx, p, before, false, input);
        }
        await this.references(tx, p, input);
        const common = {
          name: input.name,
          description: input.description,
          sortOrder: input.sortOrder,
          active: input.active,
        };
        const where = { id, ...scope(p), version, deletedAt: null };
        let savedId: string;
        switch (input.kind) {
          case 'categories': {
            const data = { ...common };
            savedId = (
              id
                ? await tx.category.update({
                    where: { ...where, id },
                    data: { ...data, version: { increment: 1 } },
                  })
                : await tx.category.create({ data: { ...scope(p), ...data } })
            ).id;
            break;
          }
          case 'kitchen-stations': {
            const data = { ...common };
            savedId = (
              id
                ? await tx.kitchenStation.update({
                    where: { ...where, id },
                    data: { ...data, version: { increment: 1 } },
                  })
                : await tx.kitchenStation.create({ data: { ...scope(p), ...data } })
            ).id;
            break;
          }
          case 'modifier-groups': {
            const data = {
              ...common,
              minSelections: input.minSelections,
              maxSelections: input.maxSelections,
            };
            savedId = (
              id
                ? await tx.modifierGroup.update({
                    where: { ...where, id },
                    data: { ...data, version: { increment: 1 } },
                  })
                : await tx.modifierGroup.create({ data: { ...scope(p), ...data } })
            ).id;
            break;
          }
          case 'modifiers': {
            const data = {
              ...common,
              groupId: input.groupId,
              priceAdjustment: new Prisma.Decimal(input.priceAdjustment),
            };
            savedId = (
              id
                ? await tx.modifier.update({
                    where: { ...where, id },
                    data: { ...data, version: { increment: 1 } },
                  })
                : await tx.modifier.create({ data: { ...scope(p), ...data } })
            ).id;
            break;
          }
          case 'products': {
            const data = {
              ...common,
              sku: input.sku,
              barcode: input.barcode,
              categoryId: input.categoryId,
              sellingPrice: new Prisma.Decimal(input.sellingPrice),
              taxRate: new Prisma.Decimal(input.taxRate),
              taxMode: input.taxMode,
              imageUrl: input.imageUrl,
            };
            savedId = (
              id
                ? await tx.product.update({
                    where: { ...where, id },
                    data: { ...data, version: { increment: 1 } },
                  })
                : await tx.product.create({ data: { ...scope(p), ...data } })
            ).id;
            if (id) {
              await tx.productModifierGroup.deleteMany({ where: { productId: id, ...scope(p) } });
              await tx.productKitchenStation.deleteMany({ where: { productId: id, ...scope(p) } });
            }
            if (input.modifierGroupIds.length)
              await tx.productModifierGroup.createMany({
                data: input.modifierGroupIds.map((groupId, sortOrder) => ({
                  ...scope(p),
                  productId: savedId,
                  groupId,
                  sortOrder,
                })),
              });
            if (input.kitchenStationIds.length)
              await tx.productKitchenStation.createMany({
                data: input.kitchenStationIds.map((stationId, sortOrder) => ({
                  ...scope(p),
                  productId: savedId,
                  stationId,
                  sortOrder,
                })),
              });
          }
        }
        const after = await this.read(tx, p, input.kind, savedId);
        await audit(
          tx,
          context(p),
          'menu.' + input.kind + (id ? '.updated' : '.created'),
          input.kind,
          savedId,
          before ? { ...before } : undefined,
          { ...after },
        );
        return after;
      },
      { isolationLevel: 'Serializable', timeout: 15000 },
    );
  }
  async archive(p: Principal, kind: MenuKind, id: string, version: number) {
    return this.db.client.$transaction(
      async (tx) => {
        const before = await this.read(tx, p, kind, id);
        this.editable(before, version);
        await this.dependentCheck(tx, p, before, true);
        const args = {
          where: { id, ...scope(p), version, deletedAt: null },
          data: { active: false, deletedAt: new Date(), version: { increment: 1 } },
        };
        switch (kind) {
          case 'categories':
            await tx.category.update(args);
            break;
          case 'kitchen-stations':
            await tx.kitchenStation.update(args);
            break;
          case 'modifier-groups':
            await tx.modifierGroup.update(args);
            break;
          case 'modifiers':
            await tx.modifier.update(args);
            break;
          case 'products':
            await tx.product.update(args);
            break;
        }
        const after = await this.read(tx, p, kind, id);
        await audit(
          tx,
          context(p),
          'menu.' + kind + '.archived',
          kind,
          id,
          { ...before },
          { ...after },
        );
        return after;
      },
      { isolationLevel: 'Serializable', timeout: 15000 },
    );
  }
}
