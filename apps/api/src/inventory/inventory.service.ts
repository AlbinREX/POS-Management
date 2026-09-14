import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  InventoryUnitCode,
  RecipeRecord,
  StockRecord,
  StockMovementRecord,
} from '@restaurant/shared-types';
import type {
  InventoryItemInput,
  InventoryItemUpdate,
  WarehouseInput,
  WarehouseUpdate,
  InventoryArchiveInput,
  InventoryListInput,
  RecipeInput,
  StockMovementInput,
  StockThresholdInput,
} from '@restaurant/validation';
import type { Principal } from '../auth/auth.service';
import { DatabaseService } from '../database.service';
import { hash } from '../orders/orders.service';
import { convertQuantity, quantityMicros, quantityText } from './quantity';
import {
  inventoryEvent,
  inventoryJson,
  inventoryLock,
  inventoryPosition,
  inventoryScope as scope,
  type InventoryTx,
} from './inventory.transactions';

const page = <T>(rows: T[], q: InventoryListInput) => ({
  items: rows.slice(0, q.limit),
  page: q.page,
  hasMore: rows.length > q.limit,
});
const options = { isolationLevel: 'Serializable' as const, timeout: 15000 };
const visible = (q: InventoryListInput) =>
  q.includeArchived === 'true' ? {} : { deletedAt: null };
@Injectable()
export class InventoryService {
  constructor(private readonly db: DatabaseService) {}
  private mutate(
    p: Principal,
    commandId: string,
    request: unknown,
    action: string,
    fn: (tx: InventoryTx) => Promise<{ id: string; response: unknown; before?: unknown }>,
  ) {
    const requestHash = hash(request);
    return this.db.client.$transaction(async (tx) => {
      await inventoryLock(tx, p);
      const old = await tx.inventoryEvent.findFirst({ where: { ...scope(p), commandId } });
      if (old) {
        if (old.userId !== p.userId || old.requestHash !== requestHash)
          throw new ConflictException('Inventory command ID was already used');
        return old.response;
      }
      const result = await fn(tx);
      return inventoryEvent(tx, p, {
        commandId,
        requestHash,
        action,
        entityId: result.id,
        response: result.response,
        before: result.before,
      });
    }, options);
  }
  units() {
    return this.db.client.inventoryUnit.findMany({ orderBy: { code: 'asc' } });
  }
  async products(p: Principal, q: InventoryListInput) {
    return page(
      await this.db.client.product.findMany({
        where: { ...scope(p), deletedAt: null, name: { contains: q.search, mode: 'insensitive' } },
        select: { id: true, name: true, active: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.limit,
        take: q.limit + 1,
      }),
      q,
    );
  }
  async items(p: Principal, q: InventoryListInput) {
    const rows = await this.db.client.inventoryItem.findMany({
      where: {
        ...scope(p),
        ...visible(q),
        OR: [
          { name: { contains: q.search, mode: 'insensitive' } },
          { sku: { contains: q.search, mode: 'insensitive' } },
        ],
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip: (q.page - 1) * q.limit,
      take: q.limit + 1,
    });
    return page(rows, q);
  }
  async warehouses(p: Principal, q: InventoryListInput) {
    return page(
      await this.db.client.warehouse.findMany({
        where: { ...scope(p), ...visible(q), name: { contains: q.search, mode: 'insensitive' } },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.limit,
        take: q.limit + 1,
      }),
      q,
    );
  }
  createItem(p: Principal, input: InventoryItemInput) {
    return this.mutate(
      p,
      input.commandId,
      { createItem: input },
      'inventory.item_created',
      async (tx) => {
        const { commandId: _command, ...data } = input;
        const row = await tx.inventoryItem.create({ data: { ...scope(p), ...data } });
        return { id: row.id, response: row };
      },
    );
  }
  createWarehouse(p: Principal, input: WarehouseInput) {
    return this.mutate(
      p,
      input.commandId,
      { createWarehouse: input },
      'inventory.warehouse_created',
      async (tx) => {
        const { commandId: _command, ...data } = input;
        const row = await tx.warehouse.create({ data: { ...scope(p), ...data } });
        return { id: row.id, response: row };
      },
    );
  }
  private async unused(tx: InventoryTx, p: Principal, kind: 'items' | 'warehouses', id: string) {
    const recipes = await tx.recipe.findMany({ where: { ...scope(p), active: true } });
    for (const recipe of recipes) {
      const used = await tx.recipeVersion.findFirst({
        where: {
          ...scope(p),
          recipeId: recipe.id,
          version: recipe.version,
          ...(kind === 'warehouses' ? { warehouseId: id } : { items: { some: { itemId: id } } }),
        },
      });
      if (used)
        throw new ConflictException(
          'Disable or revise active recipes before deactivating this record',
        );
    }
  }
  updateItem(
    p: Principal,
    id: string,
    input: InventoryItemUpdate | InventoryArchiveInput,
    archive = false,
  ) {
    return this.mutate(
      p,
      input.commandId,
      { updateItem: id, input, archive },
      archive ? 'inventory.item_archived' : 'inventory.item_updated',
      async (tx) => {
        const old = await tx.inventoryItem.findFirst({ where: { ...scope(p), id } });
        if (!old) throw new NotFoundException('Inventory item not found');
        if (old.version !== input.version || old.deletedAt)
          throw new ConflictException('Reload the current inventory item');
        if (archive || ('active' in input && !input.active)) await this.unused(tx, p, 'items', id);
        const row = await tx.inventoryItem.update({
          where: { ...scope(p), id, version: input.version },
          data: {
            ...(archive
              ? { active: false, deletedAt: new Date() }
              : {
                  name: (input as InventoryItemUpdate).name,
                  active: (input as InventoryItemUpdate).active,
                }),
            version: { increment: 1 },
          },
        });
        return { id, response: row, before: old };
      },
    );
  }
  updateWarehouse(
    p: Principal,
    id: string,
    input: WarehouseUpdate | InventoryArchiveInput,
    archive = false,
  ) {
    return this.mutate(
      p,
      input.commandId,
      { updateWarehouse: id, input, archive },
      archive ? 'inventory.warehouse_archived' : 'inventory.warehouse_updated',
      async (tx) => {
        const old = await tx.warehouse.findFirst({ where: { ...scope(p), id } });
        if (!old) throw new NotFoundException('Warehouse not found');
        if (old.version !== input.version || old.deletedAt)
          throw new ConflictException('Reload the current warehouse');
        if (archive || ('active' in input && !input.active))
          await this.unused(tx, p, 'warehouses', id);
        const row = await tx.warehouse.update({
          where: { ...scope(p), id, version: input.version },
          data: {
            ...(archive
              ? { active: false, deletedAt: new Date() }
              : {
                  name: (input as WarehouseUpdate).name,
                  description: (input as WarehouseUpdate).description,
                  active: (input as WarehouseUpdate).active,
                }),
            version: { increment: 1 },
          },
        });
        return { id, response: row, before: old };
      },
    );
  }
  private async available(tx: InventoryTx, p: Principal, warehouseId: string, itemId: string) {
    const item = await tx.inventoryItem.findFirst({
      where: { ...scope(p), id: itemId, active: true, deletedAt: null },
    });
    const warehouse = await tx.warehouse.findFirst({
      where: { ...scope(p), id: warehouseId, active: true, deletedAt: null },
    });
    if (!item || !warehouse)
      throw new NotFoundException('Active warehouse or item not found in this branch');
    return { item, warehouse };
  }
  saveRecipe(p: Principal, input: RecipeInput) {
    return this.mutate(
      p,
      input.commandId,
      { recipe: input },
      'inventory.recipe_updated',
      async (tx) => {
        const product = await tx.product.findFirst({
          where: {
            ...scope(p),
            id: input.productId,
            ...(input.active ? { active: true, deletedAt: null } : {}),
          },
        });
        if (!product) throw new NotFoundException('Active product not found');
        const old = await tx.recipe.findFirst({
          where: { ...scope(p), productId: input.productId },
        });
        if ((old?.version ?? 0) !== input.version)
          throw new ConflictException('Reload the current recipe version');
        const entries = [];
        for (const line of input.items) {
          const { item } = await this.available(tx, p, input.warehouseId, line.itemId);
          entries.push({
            ...scope(p),
            itemId: item.id,
            quantity: convertQuantity(
              line.quantity,
              line.unitCode,
              item.unitCode as InventoryUnitCode,
            ),
          });
        }
        const recipe = old
          ? await tx.recipe.update({
              where: { ...scope(p), id: old.id, version: old.version },
              data: { version: { increment: 1 }, active: input.active },
            })
          : await tx.recipe.create({
              data: { ...scope(p), productId: product.id, active: input.active },
            });
        const revision = await tx.recipeVersion.create({
          data: {
            ...scope(p),
            recipeId: recipe.id,
            version: recipe.version,
            warehouseId: input.warehouseId,
          },
        });
        await tx.recipeItem.createMany({
          data: entries.map((entry) => ({ ...entry, recipeVersionId: revision.id })),
        });
        return {
          id: recipe.id,
          before: old ?? undefined,
          response: await this.recipeRecord(tx, p, recipe.id, recipe.version),
        };
      },
    );
  }
  private async recipeRecord(
    tx: InventoryTx,
    p: Principal,
    id: string,
    version?: number,
  ): Promise<RecipeRecord> {
    const recipe = await tx.recipe.findFirst({
      where: { ...scope(p), id },
      include: { product: true },
    });
    if (!recipe) throw new NotFoundException('Recipe not found');
    const row = await tx.recipeVersion.findFirst({
      where: { ...scope(p), recipeId: id, version: version ?? recipe.version },
      include: { warehouse: true, items: { include: { item: true }, orderBy: { id: 'asc' } } },
    });
    if (!row) throw new NotFoundException('Recipe version not found');
    return {
      id,
      productId: recipe.productId,
      productName: recipe.product.name,
      version: row.version,
      active: recipe.active,
      warehouseId: row.warehouseId,
      warehouseName: row.warehouse.name,
      items: row.items.map((i) => ({
        itemId: i.itemId,
        name: i.item.name,
        unitCode: i.item.unitCode as InventoryUnitCode,
        quantity: i.quantity.toFixed(6),
      })),
    };
  }
  recipes(p: Principal, q: InventoryListInput) {
    return this.db.client.$transaction(
      async (tx) => {
        const rows = await tx.recipe.findMany({
          where: { ...scope(p), product: { name: { contains: q.search, mode: 'insensitive' } } },
          orderBy: { id: 'asc' },
          skip: (q.page - 1) * q.limit,
          take: q.limit + 1,
        });
        return page(
          await Promise.all(rows.map((r) => this.recipeRecord(tx, p, r.id, r.version))),
          q,
        );
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  recipeHistory(p: Principal, id: string, q: InventoryListInput) {
    return this.db.client.$transaction(
      async (tx) => {
        if (!(await tx.recipe.findFirst({ where: { ...scope(p), id } })))
          throw new NotFoundException('Recipe not found');
        const rows = await tx.recipeVersion.findMany({
          where: { ...scope(p), recipeId: id },
          orderBy: { version: 'desc' },
          skip: (q.page - 1) * q.limit,
          take: q.limit + 1,
        });
        return page(await Promise.all(rows.map((r) => this.recipeRecord(tx, p, id, r.version))), q);
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  movement(p: Principal, input: StockMovementInput) {
    return this.mutate(
      p,
      input.commandId,
      { movement: input },
      input.kind === 'WASTE' ? 'inventory.waste' : 'inventory.adjustment',
      async (tx) => {
        const { item, warehouse } = await this.available(tx, p, input.warehouseId, input.itemId);
        let quantity = convertQuantity(
          input.quantity,
          input.unitCode,
          item.unitCode as InventoryUnitCode,
        );
        if (input.kind === 'WASTE') quantity = quantityText(-quantityMicros(quantity));
        const position = await inventoryPosition(tx, p, input.warehouseId, input.itemId);
        const row = await tx.stockMovement.create({
          data: {
            ...scope(p),
            positionId: position.id,
            userId: p.userId,
            kind: input.kind,
            quantity,
            reason: input.reason,
            enteredQuantity: input.quantity,
            enteredUnit: input.unitCode,
            snapshot: {
              ingredientName: item.name,
              warehouseName: warehouse.name,
              unitCode: item.unitCode,
            },
          },
        });
        return { id: row.id, response: { ...row, quantity: row.quantity.toFixed(6) } };
      },
    );
  }
  threshold(p: Principal, input: StockThresholdInput) {
    return this.mutate(
      p,
      input.commandId,
      { threshold: input },
      'inventory.threshold_updated',
      async (tx) => {
        const { item } = await this.available(tx, p, input.warehouseId, input.itemId);
        const old = await tx.stockPosition.findFirst({
          where: { ...scope(p), warehouseId: input.warehouseId, itemId: input.itemId },
        });
        if ((old?.version ?? 0) !== input.version)
          throw new ConflictException('Reload the current stock threshold');
        const lowStockThreshold = convertQuantity(
          input.lowStockThreshold,
          input.unitCode,
          item.unitCode as InventoryUnitCode,
        );
        const row = old
          ? await tx.stockPosition.update({
              where: { ...scope(p), id: old.id, version: old.version },
              data: { lowStockThreshold, version: { increment: 1 } },
            })
          : await tx.stockPosition.create({
              data: {
                ...scope(p),
                warehouseId: input.warehouseId,
                itemId: input.itemId,
                lowStockThreshold,
              },
            });
        return {
          id: row.id,
          before: old ? inventoryJson(old) : undefined,
          response: { ...row, lowStockThreshold: row.lowStockThreshold.toFixed(6) },
        };
      },
    );
  }
  stock(p: Principal, q: InventoryListInput) {
    return this.db.client.$transaction(
      async (tx) => {
        const rows = await tx.stockPosition.findMany({
          where: {
            ...scope(p),
            warehouseId: q.warehouseId,
            itemId: q.itemId,
            item: { ...visible(q), name: { contains: q.search, mode: 'insensitive' } },
            warehouse: visible(q),
          },
          include: { item: true, warehouse: true },
          orderBy: { id: 'asc' },
          skip: (q.page - 1) * q.limit,
          take: q.limit + 1,
        });
        const sums = await tx.stockMovement.groupBy({
          by: ['positionId'],
          where: { ...scope(p), positionId: { in: rows.map((r) => r.id) } },
          _sum: { quantity: true },
        });
        const quantities = new Map(
          sums.map((r) => [r.positionId, r._sum.quantity?.toFixed(6) ?? '0.000000']),
        );
        return page<StockRecord>(
          rows.map((r) => {
            const quantity = quantities.get(r.id) ?? '0.000000';
            return {
              id: r.id,
              itemId: r.itemId,
              itemName: r.item.name,
              warehouseId: r.warehouseId,
              warehouseName: r.warehouse.name,
              unitCode: r.item.unitCode as InventoryUnitCode,
              quantity,
              lowStockThreshold: r.lowStockThreshold.toFixed(6),
              lowStock: quantityMicros(quantity) <= quantityMicros(r.lowStockThreshold.toFixed(6)),
              version: r.version,
              active: r.item.active && r.warehouse.active,
            };
          }),
          q,
        );
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async history(p: Principal, q: InventoryListInput) {
    const rows = await this.db.client.stockMovement.findMany({
      where: {
        ...scope(p),
        position: {
          warehouseId: q.warehouseId,
          itemId: q.itemId,
          item: { name: { contains: q.search, mode: 'insensitive' } },
        },
      },
      include: {
        actor: { include: { user: true } },
        position: { include: { item: true, warehouse: true } },
        settlement: { include: { order: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (q.page - 1) * q.limit,
      take: q.limit + 1,
    });
    return page<StockMovementRecord>(
      rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        quantity: r.quantity.toFixed(6),
        reason: r.reason,
        enteredQuantity: r.enteredQuantity,
        enteredUnit: r.enteredUnit,
        orderId: r.orderId,
        orderNumber: r.settlement?.order.orderNumber.toString() ?? null,
        createdAt: r.createdAt.toISOString(),
        userName: r.actor.user.name,
        itemId: r.position.itemId,
        itemName: String((r.snapshot as Record<string, unknown>).ingredientName),
        warehouseId: r.position.warehouseId,
        warehouseName: String((r.snapshot as Record<string, unknown>).warehouseName),
        unitCode: r.position.item.unitCode as InventoryUnitCode,
      })),
      q,
    );
  }
  async events(p: Principal, after: string, limit: number) {
    const rows = await this.db.client.inventoryEvent.findMany({
      where: { ...scope(p), revision: { gt: BigInt(after) } },
      orderBy: { revision: 'asc' },
      take: limit + 1,
    });
    return {
      events: rows.slice(0, limit).map((r) => ({
        id: r.id,
        action: r.action,
        entityId: r.entityId,
        revision: r.revision.toString(),
        createdAt: r.createdAt.toISOString(),
      })),
      cursor: rows.slice(0, limit).at(-1)?.revision.toString() ?? after,
      hasMore: rows.length > limit,
    };
  }
}
