import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@restaurant/database';
import type { InventoryUnitCode } from '@restaurant/shared-types';
import type { Principal } from '../auth/auth.service';
import { audit } from '../audit';
import { quantityMicros, quantityText } from './quantity';

export type InventoryTx = Prisma.TransactionClient;
export const inventoryScope = (p: Principal) => ({
  branchId: p.branchId,
  organizationId: p.organizationId,
});
export const inventoryJson = (value: unknown): Prisma.InputJsonObject =>
  JSON.parse(JSON.stringify(value));
export async function inventoryLock(tx: InventoryTx, p: Principal) {
  return tx.inventoryRevision.upsert({
    where: { branchId: p.branchId },
    create: { ...inventoryScope(p), revision: 1n },
    update: { revision: { increment: 1n } },
  });
}
export async function inventoryEvent(
  tx: InventoryTx,
  p: Principal,
  input: {
    commandId: string;
    requestHash: string;
    action: string;
    entityId: string;
    response: unknown;
    before?: unknown;
  },
) {
  const revision = await inventoryLock(tx, p);
  const response = inventoryJson(input.response);
  await audit(
    tx,
    {
      ...inventoryScope(p),
      userId: p.userId,
      terminalId: p.terminalId,
      ip: p.ip,
      requestId: p.requestId,
    },
    input.action,
    'Inventory',
    input.entityId,
    input.before === undefined ? undefined : inventoryJson(input.before),
    response,
  );
  await tx.inventoryEvent.create({
    data: {
      ...inventoryScope(p),
      userId: p.userId,
      commandId: input.commandId,
      requestHash: input.requestHash,
      action: input.action,
      entityId: input.entityId,
      revision: revision.revision,
      response,
    },
  });
  return response;
}
export async function inventoryPosition(
  tx: InventoryTx,
  p: Principal,
  warehouseId: string,
  itemId: string,
) {
  const key = { ...inventoryScope(p), warehouseId, itemId };
  return tx.stockPosition.upsert({
    where: { warehouseId_itemId_branchId_organizationId: key },
    create: key,
    update: {},
  });
}

// Called inside the existing payment transaction, after a bill is frozen.
export async function freezeInventoryPlan(tx: InventoryTx, p: Principal, orderId: string) {
  if (await tx.inventoryPlan.findFirst({ where: { ...inventoryScope(p), orderId } })) return;
  await inventoryLock(tx, p);
  const items = await tx.orderItem.findMany({
    where: { ...inventoryScope(p), orderId, voidedAt: null },
    orderBy: { id: 'asc' },
  });
  const plan = await tx.inventoryPlan.create({
    data: {
      ...inventoryScope(p),
      orderId,
      userId: p.userId,
      snapshot: inventoryJson({
        items: items.map((item) => ({
          id: item.id,
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
        })),
      }),
    },
  });
  for (const orderItem of items) {
    const recipe = await tx.recipe.findFirst({
      where: { ...inventoryScope(p), productId: orderItem.productId, active: true },
    });
    if (!recipe) continue;
    const version = await tx.recipeVersion.findFirst({
      where: { ...inventoryScope(p), recipeId: recipe.id, version: recipe.version },
      include: { warehouse: true, items: { include: { item: true }, orderBy: { id: 'asc' } } },
    });
    if (!version || !version.items.length)
      throw new ConflictException('Active recipe has no ingredients');
    for (const line of version.items) {
      const position = await inventoryPosition(tx, p, version.warehouseId, line.itemId);
      await tx.inventoryPlanItem.create({
        data: {
          ...inventoryScope(p),
          orderId,
          orderItemId: orderItem.id,
          positionId: position.id,
          recipeItemId: line.id,
          quantity: quantityText(
            quantityMicros(line.quantity.toFixed(6)) * BigInt(orderItem.quantity),
          ),
          snapshot: inventoryJson({
            productName: orderItem.productName,
            ingredientName: line.item.name,
            unitCode: line.item.unitCode,
            warehouseName: version.warehouse.name,
            recipeId: recipe.id,
            recipeVersion: recipe.version,
            perProduct: line.quantity.toFixed(6),
            productQuantity: orderItem.quantity,
          }),
        },
      });
    }
  }
  await inventoryEvent(tx, p, {
    commandId: randomUUID(),
    requestHash: '0'.repeat(64),
    action: 'inventory.plan_frozen',
    entityId: orderId,
    response: {
      orderId: plan.orderId,
      lines: await tx.inventoryPlanItem.count({ where: { ...inventoryScope(p), orderId } }),
    },
  });
}

export async function consumeInventoryPlan(tx: InventoryTx, p: Principal, orderId: string) {
  await freezeInventoryPlan(tx, p, orderId);
  await inventoryLock(tx, p);
  const lines = await tx.inventoryPlanItem.findMany({
    where: { ...inventoryScope(p), orderId },
    include: { position: { include: { item: true } } },
    orderBy: { id: 'asc' },
  });
  for (const line of lines) {
    await tx.stockMovement.create({
      data: {
        ...inventoryScope(p),
        userId: p.userId,
        positionId: line.positionId,
        planItemId: line.id,
        orderId,
        kind: 'SALE_CONSUMPTION',
        quantity: quantityText(-quantityMicros(line.quantity.toFixed(6))),
        reason: 'Final order settlement',
        enteredQuantity: line.quantity.toFixed(6),
        enteredUnit: line.position.item.unitCode as InventoryUnitCode,
        snapshot: line.snapshot as Prisma.InputJsonObject,
      },
    });
  }
  await inventoryEvent(tx, p, {
    commandId: randomUUID(),
    requestHash: '0'.repeat(64),
    action: 'inventory.sale_consumed',
    entityId: orderId,
    response: { orderId, movements: lines.length },
  });
}
