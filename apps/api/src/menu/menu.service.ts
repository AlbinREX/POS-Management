import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@restaurant/database';
import type { MenuKind, MenuPage, MenuRecord } from '@restaurant/shared-types';
import type { MenuInput, menuListSchema, menuReorderSchema } from '@restaurant/validation';
import type { z } from 'zod';
import type { Principal } from '../auth/auth.service';
import { audit } from '../audit';
import { DatabaseService } from '../database.service';
import { MediaService } from '../media/media.service';
import { liveOffers, productOffer } from './offer-lookup';

const scope = (p: Principal) => ({ organizationId: p.organizationId, branchId: p.branchId });
const context = (p: Principal) => ({
  ...scope(p),
  userId: p.userId,
  terminalId: p.terminalId,
  requestId: p.requestId,
  ip: p.ip,
});
// Audit snapshots are plain JSON copies of the allowlisted record.
const snapshot = (row: MenuRecord) => JSON.parse(JSON.stringify(row)) as Prisma.InputJsonObject;
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
      soldOut: row.soldOut,
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
  constructor(
    private readonly db: DatabaseService,
    private readonly media: MediaService,
  ) {}
  /** Attach the offer that would price each product if it were ordered right now. */
  private async withOffers(p: Principal, rows: MenuRecord[]): Promise<MenuRecord[]> {
    const products = rows.filter((row) => row.kind === 'products');
    if (!products.length) return rows;
    const live = await liveOffers(this.db.client, scope(p), products.map((row) => row.id), new Date());
    return rows.map((row) => {
      if (row.kind !== 'products') return row;
      const offer = live.get(row.id);
      return { ...row, activeOffer: offer ? productOffer(row.sellingPrice!, offer) : null };
    });
  }
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
  async get(p: Principal, kind: MenuKind, id: string) {
    const [row] = await this.withOffers(p, [await this.read(this.db.client, p, kind, id)]);
    return row!;
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
      items: await this.withOffers(
        p,
        rows.slice(0, query.limit).map((row) => record(kind, row)),
      ),
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
    let replacedImage: string | null | undefined;
    const saved = await this.db.client.$transaction(
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
            // A newly chosen upload must still exist, and stays protected from cleanup
            // until this transaction commits.
            if (input.imageUrl !== (before?.imageUrl ?? null))
              await this.media.assertAvailable(tx, input.imageUrl);
            const data = {
              ...common,
              sku: input.sku,
              barcode: input.barcode,
              categoryId: input.categoryId,
              sellingPrice: new Prisma.Decimal(input.sellingPrice),
              taxRate: new Prisma.Decimal(input.taxRate),
              taxMode: input.taxMode,
              imageUrl: input.imageUrl,
              soldOut: input.soldOut ?? before?.soldOut ?? false,
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
          before ? snapshot(before) : undefined,
          snapshot(after),
        );
        if (before && input.kind === 'products') {
          await this.productChanges(tx, p, before, after);
          if (before.imageUrl !== after.imageUrl) replacedImage = before.imageUrl;
        }
        return after;
      },
      { isolationLevel: 'Serializable', timeout: 15000 },
    );
    // Only once the product no longer points at it is the previous image removed.
    await this.media.release(replacedImage);
    return saved;
  }
  /**
   * Named audit entries for the product changes staff and owners look for, beside the
   * full before/after record. Only field values are recorded, never image contents.
   */
  private async productChanges(
    tx: Prisma.TransactionClient,
    p: Principal,
    before: MenuRecord,
    after: MenuRecord,
  ) {
    const entry = (action: string, field: keyof MenuRecord) =>
      audit(
        tx,
        context(p),
        action,
        'products',
        after.id,
        { [field]: (before[field] ?? null) as Prisma.InputJsonValue },
        { [field]: (after[field] ?? null) as Prisma.InputJsonValue },
      );
    if (before.sellingPrice !== after.sellingPrice)
      await entry('menu.products.price_changed', 'sellingPrice');
    if (before.imageUrl !== after.imageUrl) await entry('menu.products.image_changed', 'imageUrl');
    if (before.categoryId !== after.categoryId)
      await entry('menu.products.category_changed', 'categoryId');
    if (before.active !== after.active)
      await entry(after.active ? 'menu.products.activated' : 'menu.products.deactivated', 'active');
    if (before.soldOut !== after.soldOut)
      await entry(after.soldOut ? 'menu.products.sold_out' : 'menu.products.back_in_stock', 'soldOut');
  }
  /**
   * Save a complete display order for the branch's categories, or for the products of
   * one category. Positions are explicit, so the POS never infers order from timestamps.
   */
  async reorder(
    p: Principal,
    kind: 'categories' | 'products',
    input: z.infer<typeof menuReorderSchema>,
  ) {
    return this.db.client.$transaction(
      async (tx) => {
        if (kind === 'products' && !input.categoryId)
          throw new ConflictException('Choose the category whose products to reorder');
        const where = {
          ...scope(p),
          deletedAt: null,
          ...(kind === 'products' ? { categoryId: input.categoryId } : {}),
        };
        const rows =
          kind === 'categories'
            ? await tx.category.findMany({ where })
            : await tx.product.findMany({ where });
        const requested = new Set(input.items.map((item) => item.id));
        if (rows.length !== requested.size || rows.some((row) => !requested.has(row.id)))
          throw new ConflictException('The list changed. Reload before saving the order.');
        const byId = new Map(rows.map((row) => [row.id, row]));
        const previous = rows
          .map((row) => ({ id: row.id, sortOrder: row.sortOrder }))
          .sort((a, b) => a.sortOrder - b.sortOrder);
        for (const [index, item] of input.items.entries()) {
          const row = byId.get(item.id)!;
          if (row.version !== item.version)
            throw new ConflictException('This record changed. Reload before saving.');
          const sortOrder = (index + 1) * 10;
          if (row.sortOrder === sortOrder) continue;
          const args = {
            where: { id: item.id, ...scope(p), version: item.version, deletedAt: null },
            data: { sortOrder, version: { increment: 1 } },
          };
          if (kind === 'categories') await tx.category.update(args);
          else await tx.product.update(args);
        }
        const order = input.items.map((item, index) => ({ id: item.id, sortOrder: (index + 1) * 10 }));
        await audit(
          tx,
          context(p),
          `menu.${kind}.reordered`,
          kind,
          input.categoryId,
          { order: previous },
          { order },
        );
        return Promise.all(input.items.map((item) => this.read(tx, p, kind, item.id)));
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
          snapshot(before),
          snapshot(after),
        );
        return after;
      },
      { isolationLevel: 'Serializable', timeout: 15000 },
    );
  }
}
