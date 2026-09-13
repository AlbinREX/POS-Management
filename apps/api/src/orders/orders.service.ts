import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Prisma } from '@restaurant/database';
import type { OrderRecord, PermissionKey } from '@restaurant/shared-types';
import type {
  OrderCommandInput,
  OrderCreateInput,
  layoutChangesSchema,
  orderListSchema,
} from '@restaurant/validation';
import type { z } from 'zod';
import type { Principal } from '../auth/auth.service';
import { audit } from '../audit';
import { DatabaseService } from '../database.service';
import { LayoutService } from '../layout/layout.service';
import { calculateOrder } from './money';
import { cancelKitchenTickets } from '../kitchen/kitchen.transactions';

const scope = (p: Principal) => ({ branchId: p.branchId, organizationId: p.organizationId });
const context = (p: Principal) => ({
  ...scope(p),
  userId: p.userId,
  terminalId: p.terminalId,
  requestId: p.requestId,
  ip: p.ip,
});
const options = { isolationLevel: 'Serializable' as const, timeout: 15000 };
const include = {
  bill: { select: { orderId: true } },
  kitchenSubmission: { select: { id: true } },
  items: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    include: { modifiers: { orderBy: { id: 'asc' as const } } },
  },
};
type Row = Prisma.OrderGetPayload<{ include: typeof include }>;
export function record(r: Row): OrderRecord {
  return {
    paymentStarted: !!r.bill,
    kitchenSubmitted: !!r.kitchenSubmission,
    id: r.id,
    orderNumber: r.orderNumber.toString(),
    type: r.type,
    status: r.status,
    tableId: r.tableId,
    areaId: r.areaId,
    tableName: r.tableName,
    areaName: r.areaName,
    waiterId: r.waiterId,
    waiterName: r.waiterName,
    currency: r.currency,
    subtotal: r.subtotal.toFixed(2),
    discount: r.discount.toFixed(2),
    tax: r.tax.toFixed(2),
    total: r.total.toFixed(2),
    discountReason: r.discountReason,
    cancellationReason: r.cancellationReason,
    notes: r.notes,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    items: r.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      productName: i.productName,
      sku: i.sku,
      categoryName: i.categoryName,
      unitPrice: i.unitPrice.toFixed(2),
      taxRate: i.taxRate.toFixed(2),
      taxMode: i.taxMode,
      quantity: i.quantity,
      notes: i.notes,
      subtotal: i.subtotal.toFixed(2),
      discount: i.discount.toFixed(2),
      tax: i.tax.toFixed(2),
      total: i.total.toFixed(2),
      voidedAt: i.voidedAt?.toISOString() ?? null,
      voidReason: i.voidReason,
      modifiers: i.modifiers.map((m) => ({
        modifierId: m.modifierId,
        groupName: m.groupName,
        name: m.name,
        priceAdjustment: m.priceAdjustment.toFixed(2),
      })),
    })),
  };
}
// DTOs contain only JSON-safe allowlisted fields; preserve types at the persistence boundary.
const json = (r: OrderRecord): Prisma.InputJsonObject => JSON.parse(JSON.stringify(r));
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
@Injectable()
export class OrdersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly layout: LayoutService,
  ) {}
  private require(p: Principal, permission: PermissionKey) {
    if (!p.permissions.includes(permission))
      throw new ForbiddenException('Required order permission is missing');
  }
  async row(tx: Prisma.TransactionClient, p: Principal, id: string) {
    const r = await tx.order.findFirst({ where: { ...scope(p), id }, include });
    if (!r) throw new NotFoundException('Order not found');
    return r;
  }
  async get(p: Principal, id: string) {
    return record(await this.row(this.db.client, p, id));
  }
  list(p: Principal, q: z.infer<typeof orderListSchema>) {
    return this.db.client.$transaction(
      async (tx) => {
        const counter = await tx.orderCounter.findFirst({ where: scope(p) });
        const rows = await tx.order.findMany({
          where: { ...scope(p), status: q.status },
          orderBy: { orderNumber: 'desc' },
          skip: (q.page - 1) * q.limit,
          take: q.limit + 1,
          include,
        });
        return {
          items: rows.slice(0, q.limit).map(record),
          page: q.page,
          hasMore: rows.length > q.limit,
          revision: counter?.revision.toString() ?? '0',
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async changes(p: Principal, q: z.infer<typeof layoutChangesSchema>, orderId?: string) {
    if (orderId) await this.get(p, orderId);
    const rows = await this.db.client.orderEvent.findMany({
      where: { ...scope(p), orderId, revision: { gt: BigInt(q.after) } },
      orderBy: { revision: 'asc' },
      take: q.limit + 1,
    });
    const events = rows.slice(0, q.limit).map((e) => ({
      id: e.id,
      orderId: e.orderId,
      orderVersion: e.orderVersion,
      revision: e.revision.toString(),
      action: e.action,
      createdAt: e.createdAt.toISOString(),
      ...(orderId ? { snapshot: e.response } : {}),
    }));
    return { events, cursor: events.at(-1)?.revision ?? q.after, hasMore: rows.length > q.limit };
  }
  async waiters(p: Principal, q: z.infer<typeof orderListSchema>) {
    const rows = await this.db.client.branchMembership.findMany({
      where: {
        ...scope(p),
        active: true,
        user: { active: true, deletedAt: null },
        roles: { some: { role: { permissions: { some: { permissionKey: 'order.manage' } } } } },
      },
      select: { userId: true, user: { select: { name: true } } },
      orderBy: { userId: 'asc' },
      skip: (q.page - 1) * q.limit,
      take: q.limit + 1,
    });
    return {
      items: rows.slice(0, q.limit).map((r) => ({ id: r.userId, name: r.user.name })),
      hasMore: rows.length > q.limit,
    };
  }
  private async waiter(tx: Prisma.TransactionClient, p: Principal, waiterId: string | null) {
    if (waiterId === null) return { waiterId: null, waiterName: null };
    const member = await tx.branchMembership.findFirst({
      where: {
        ...scope(p),
        userId: waiterId,
        active: true,
        user: { active: true, deletedAt: null },
        roles: { some: { role: { permissions: { some: { permissionKey: 'order.manage' } } } } },
      },
      select: { user: { select: { name: true } } },
    });
    if (!member) throw new NotFoundException('Eligible waiter not found');
    return { waiterId, waiterName: member.user.name };
  }
  async replay(tx: Prisma.TransactionClient, p: Principal, commandId: string, requestHash: string) {
    const e = await tx.orderEvent.findFirst({ where: { ...scope(p), commandId } });
    if (!e) return null;
    if (e.userId !== p.userId || e.requestHash !== requestHash)
      throw new ConflictException('Command ID was already used');
    return e.response as unknown as OrderRecord;
  }
  async event(
    tx: Prisma.TransactionClient,
    p: Principal,
    commandId: string,
    requestHash: string,
    action: string,
    after: OrderRecord,
    before?: OrderRecord,
  ) {
    const counter = await tx.orderCounter.update({
      where: { branchId: p.branchId, organizationId: p.organizationId },
      data: { revision: { increment: 1n } },
    });
    await audit(
      tx,
      context(p),
      action,
      'Order',
      after.id,
      before ? json(before) : undefined,
      json(after),
    );
    await tx.orderEvent.create({
      data: {
        ...scope(p),
        orderId: after.id,
        userId: p.userId,
        commandId,
        requestHash,
        revision: counter.revision,
        orderVersion: after.version,
        action,
        response: json(after),
      },
    });
    return after;
  }
  async tableStatus(
    tx: Prisma.TransactionClient,
    p: Principal,
    id: string,
    status: 'OCCUPIED' | 'ORDER_SENT' | 'WAITING_PAYMENT' | 'FREE',
  ) {
    const row = await tx.restaurantTable.findFirstOrThrow({ where: { ...scope(p), id } });
    if (row.status === status) return;
    const before = {
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: row.deletedAt?.toISOString() ?? null,
    };
    const changed = await tx.restaurantTable.update({
      where: { ...scope(p), id, version: row.version },
      data: { status, version: { increment: 1 } },
    });
    // Layout serializer shape, with no user or request data included.
    const toRecord = (r: typeof before) => ({
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
      status: r.status,
      active: r.active,
      version: r.version,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      deletedAt: r.deletedAt,
    });
    await this.layout.emit(
      tx,
      p,
      'RestaurantTable',
      'layout.table.order_status_changed',
      toRecord({
        ...changed,
        createdAt: changed.createdAt.toISOString(),
        updatedAt: changed.updatedAt.toISOString(),
        deletedAt: changed.deletedAt?.toISOString() ?? null,
      }),
      toRecord(before),
    );
  }
  create(p: Principal, input: OrderCreateInput) {
    if (input.waiterId && input.waiterId !== p.userId) this.require(p, 'order.assign');
    const requestHash = hash({ create: input });
    return this.db.client.$transaction(async (tx) => {
      const replay = await this.replay(tx, p, input.commandId, requestHash);
      if (replay) return replay;
      const waiter = await this.waiter(tx, p, input.waiterId);
      let tableData = {};
      if (input.tableId) {
        const table = await tx.restaurantTable.findFirst({
          where: { ...scope(p), id: input.tableId, active: true, deletedAt: null },
          include: { area: true },
        });
        if (!table) throw new NotFoundException('Table not found');
        if (table.status !== 'FREE' || !table.area.active || table.area.deletedAt)
          throw new ConflictException('Table is unavailable');
        tableData = {
          tableId: table.id,
          areaId: table.areaId,
          tableName: table.name,
          areaName: table.area.name,
        };
        await this.tableStatus(tx, p, table.id, 'OCCUPIED');
      }
      const branch = await tx.branch.findFirstOrThrow({
        where: { id: p.branchId, organizationId: p.organizationId },
      });
      const counter = await tx.orderCounter.upsert({
        where: { branchId: p.branchId },
        create: { ...scope(p), number: 1n },
        update: { number: { increment: 1n } },
      });
      const row = await tx.order.create({
        data: {
          ...scope(p),
          ...tableData,
          ...waiter,
          type: input.type,
          notes: input.notes,
          currency: branch.currency,
          orderNumber: counter.number,
        },
        include,
      });
      return this.event(tx, p, input.commandId, requestHash, 'order.created', record(row));
    }, options);
  }
  private async add(
    tx: Prisma.TransactionClient,
    p: Principal,
    order: Row,
    input: Extract<OrderCommandInput, { action: 'add_item' }>,
  ) {
    if (order.items.length >= 500 || order.items.filter((i) => !i.voidedAt).length >= 100)
      throw new ConflictException('Order item limit reached');
    const product = await tx.product.findFirst({
      where: { ...scope(p), id: input.productId, active: true, deletedAt: null },
      include: {
        category: true,
        modifierGroups: { include: { group: { include: { modifiers: true } } } },
      },
    });
    if (!product) throw new NotFoundException('Product not found');
    if (!product.category.active || product.category.deletedAt)
      throw new ConflictException('Product category is unavailable');
    const selected = new Set(input.modifierIds);
    const snapshots: {
      modifierId: string;
      groupName: string;
      name: string;
      priceAdjustment: Prisma.Decimal;
    }[] = [];
    for (const link of product.modifierGroups) {
      const group = link.group;
      if (!group.active || group.deletedAt)
        throw new ConflictException('Product modifier group is unavailable');
      const choices = group.modifiers.filter((m) => selected.has(m.id));
      if (
        choices.length < group.minSelections ||
        choices.length > group.maxSelections ||
        choices.some((m) => !m.active || m.deletedAt)
      )
        throw new ConflictException(
          'Modifier selection does not satisfy the product configuration',
        );
      for (const m of choices)
        snapshots.push({
          modifierId: m.id,
          groupName: group.name,
          name: m.name,
          priceAdjustment: m.priceAdjustment,
        });
    }
    if (snapshots.length !== selected.size)
      throw new NotFoundException('Selected modifier is not available for this product');
    const item = await tx.orderItem.create({
      data: {
        ...scope(p),
        id: randomUUID(),
        orderId: order.id,
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        categoryName: product.category.name,
        unitPrice: product.sellingPrice,
        taxRate: product.taxRate,
        taxMode: product.taxMode,
        quantity: input.quantity,
        notes: input.notes,
        subtotal: '0.00',
        total: '0.00',
        tax: '0.00',
      },
    });
    if (snapshots.length)
      await tx.orderItemModifier.createMany({
        data: snapshots.map((m) => ({ ...scope(p), ...m, itemId: item.id })),
      });
  }
  command(p: Principal, id: string, input: OrderCommandInput) {
    if (input.action === 'discount') this.require(p, 'order.discount');
    if (input.action === 'cancel') this.require(p, 'order.cancel');
    if (input.action === 'assign_waiter') this.require(p, 'order.assign');
    const requestHash = hash({ id, input });
    return this.db.client.$transaction(async (tx) => {
      const replay = await this.replay(tx, p, input.commandId, requestHash);
      if (replay) return replay;
      const row = await this.row(tx, p, id),
        before = record(row);
      if (row.version !== input.version)
        throw new ConflictException('Order changed. Reload before saving.');
      if (row.bill) {
        if (input.action !== 'cancel')
          throw new ConflictException('Payment history freezes this order');
        const receipts = await tx.payment.findMany({
          where: { ...scope(p), orderId: id },
          include: { reversals: true },
        });
        if (receipts.some((v) => !v.reversals.some((r) => r.kind === 'CANCELLATION')))
          throw new ConflictException('Cancel outstanding payments before cancelling this order');
      }
      const submitted = await tx.kitchenSubmission.findFirst({
        where: { ...scope(p), orderId: id },
      });
      if (
        submitted &&
        input.action !== 'cancel' &&
        !(input.action === 'status' && input.status === 'WAITING_PAYMENT' && row.status === 'READY')
      )
        throw new ConflictException(
          'Submitted orders are immutable; kitchen amendments are not available',
        );
      if (
        !['DRAFT', 'OPEN', 'SENT_TO_KITCHEN', 'PREPARING', 'READY', 'WAITING_PAYMENT'].includes(
          row.status,
        )
      )
        throw new ConflictException('This order is locked');
      if (row.status === 'WAITING_PAYMENT' && !['status', 'cancel'].includes(input.action))
        throw new ConflictException('Reopen the order before editing');
      const data: Prisma.OrderUncheckedUpdateInput = { version: { increment: 1 } };
      switch (input.action) {
        case 'add_item':
          await this.add(tx, p, row, input);
          break;
        case 'update_item':
        case 'void_item': {
          const item = row.items.find((i) => i.id === input.itemId && !i.voidedAt);
          if (!item) throw new NotFoundException('Active order item not found');
          await tx.orderItem.update({
            where: { ...scope(p), id: item.id, orderId: id },
            data:
              input.action === 'void_item'
                ? { voidedAt: new Date(), voidReason: input.reason }
                : { quantity: input.quantity, notes: input.notes },
          });
          break;
        }
        case 'discount':
          data.discount = input.amount;
          data.discountReason = input.reason;
          break;
        case 'notes':
          data.notes = input.notes;
          break;
        case 'assign_waiter':
          Object.assign(data, await this.waiter(tx, p, input.waiterId));
          break;
        case 'cancel':
          await cancelKitchenTickets(tx, p, id, input.reason);
          data.status = 'CANCELLED';
          data.cancellationReason = input.reason;
          break;
        case 'status': {
          const valid =
            (input.status === 'OPEN' && ['DRAFT', 'WAITING_PAYMENT'].includes(row.status)) ||
            (input.status === 'WAITING_PAYMENT' && ['OPEN', 'READY'].includes(row.status));
          if (!valid || !row.items.some((i) => !i.voidedAt))
            throw new ConflictException('Invalid or empty order transition');
          data.status = input.status;
          break;
        }
      }
      if (['add_item', 'update_item', 'void_item', 'discount'].includes(input.action)) {
        const current = await this.row(tx, p, id);
        let amounts;
        try {
          amounts = calculateOrder(
            current.items
              .filter((i) => !i.voidedAt)
              .map((i) => ({
                id: i.id,
                unitPrice: i.unitPrice.toFixed(2),
                taxRate: i.taxRate.toFixed(2),
                taxMode: i.taxMode,
                quantity: i.quantity,
                adjustments: i.modifiers.map((m) => m.priceAdjustment.toFixed(2)),
              })),
            input.action === 'discount' ? input.amount : row.discount.toFixed(2),
          );
        } catch (error) {
          throw new ConflictException(
            error instanceof Error ? error.message : 'Invalid order amount',
          );
        }
        for (const item of amounts.items) {
          const { id: itemId, ...values } = item;
          await tx.orderItem.update({
            where: { ...scope(p), id: itemId, orderId: id },
            data: values,
          });
        }
        Object.assign(data, {
          subtotal: amounts.subtotal,
          discount: amounts.discount,
          tax: amounts.tax,
          total: amounts.total,
        });
      }
      const after = record(
        await tx.order.update({
          where: { ...scope(p), id, version: input.version },
          data,
          include,
        }),
      );
      if (row.tableId && (input.action === 'status' || input.action === 'cancel'))
        await this.tableStatus(
          tx,
          p,
          row.tableId,
          after.status === 'CANCELLED'
            ? 'FREE'
            : after.status === 'WAITING_PAYMENT'
              ? 'WAITING_PAYMENT'
              : 'OCCUPIED',
        );
      return this.event(
        tx,
        p,
        input.commandId,
        requestHash,
        'order.' + input.action,
        after,
        before,
      );
    }, options);
  }
}
