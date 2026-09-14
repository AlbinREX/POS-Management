import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@restaurant/database';
import type {
  InventoryUnitCode,
  PurchaseRecord,
  ReceiptRecord,
  SupplierAccount,
} from '@restaurant/shared-types';
import type {
  SupplierInput,
  SupplierUpdate,
  PurchaseDraftInput,
  PurchaseUpdate,
  GoodsReceiptInput,
  SupplierPaymentInput,
  PurchasingListInput,
} from '@restaurant/validation';
import { DatabaseService } from '../database.service';
import type { Principal } from '../auth/auth.service';
import { audit } from '../audit';
import { hash } from '../orders/orders.service';
import {
  inventoryEvent,
  inventoryLock,
  inventoryPosition,
  inventoryScope as scope,
  inventoryJson as json,
} from '../inventory/inventory.transactions';
import { convertQuantity, quantityMicros, quantityText } from '../inventory/quantity';
import {
  purchaseLine,
  purchaseTotals,
  sumMoney,
  negateMoney,
  exceedsMoney,
} from './purchase-money';
type Tx = Prisma.TransactionClient;
const paging = (q: PurchasingListInput) => ({ skip: (q.page - 1) * q.limit, take: q.limit + 1 });
const page = <T>(rows: T[], q: PurchasingListInput) => ({
  items: rows.slice(0, q.limit),
  hasMore: rows.length > q.limit,
  page: q.page,
});
const isoDate = (v: Date | null) => v?.toISOString().slice(0, 10) ?? null;
const date = (v: string | null) => (v ? new Date(v + 'T00:00:00.000Z') : null);
const serialize = (v: unknown): Prisma.InputJsonObject =>
  JSON.parse(
    JSON.stringify(v, (_, value) => (typeof value === 'bigint' ? value.toString() : value)),
  );
@Injectable()
export class PurchasingService {
  constructor(private readonly db: DatabaseService) {}
  private mutate(
    p: Principal,
    commandId: string,
    body: unknown,
    action: string,
    fn: (tx: Tx) => Promise<{
      id: string;
      supplierId?: string;
      purchaseOrderId?: string;
      response: unknown;
      before?: unknown;
    }>,
  ) {
    return this.db.client.$transaction(
      async (tx) => {
        const revision = await tx.purchasingRevision.upsert({
          where: { branchId: p.branchId },
          create: { ...scope(p), revision: 1n },
          update: { revision: { increment: 1n } },
        });
        const requestHash = hash(body),
          old = await tx.purchasingEvent.findFirst({ where: { ...scope(p), commandId } });
        if (old) {
          if (old.userId !== p.userId || old.requestHash !== requestHash)
            throw new ConflictException('Purchasing command ID was already used');
          return old.response;
        }
        const r = await fn(tx),
          response = serialize(r.response);
        await audit(
          tx,
          {
            ...scope(p),
            userId: p.userId,
            terminalId: p.terminalId,
            ip: p.ip,
            requestId: p.requestId,
          },
          action,
          'Purchasing',
          r.id,
          r.before === undefined ? undefined : serialize(r.before),
          response,
        );
        await tx.purchasingEvent.create({
          data: {
            ...scope(p),
            userId: p.userId,
            commandId,
            requestHash,
            revision: revision.revision,
            action,
            entityId: r.id,
            supplierId: r.supplierId,
            purchaseOrderId: r.purchaseOrderId,
            response,
          },
        });
        return response;
      },
      { isolationLevel: 'Serializable', timeout: 20000 },
    );
  }
  suppliers(p: Principal, q: PurchasingListInput) {
    return this.db.client.supplier
      .findMany({
        where: {
          ...scope(p),
          ...(q.includeArchived === 'true' ? {} : { deletedAt: null }),
          OR: [
            { name: { contains: q.search, mode: 'insensitive' as const } },
            { businessNumber: { contains: q.search, mode: 'insensitive' as const } },
          ],
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        ...paging(q),
      })
      .then((rows) => page(rows, q));
  }
  saveSupplier(p: Principal, input: SupplierInput | SupplierUpdate, id?: string) {
    return this.mutate(
      p,
      input.commandId,
      { id, input },
      id ? 'supplier.updated' : 'supplier.created',
      async (tx) => {
        let before;
        if (id) {
          before = await tx.supplier.findFirst({ where: { ...scope(p), id, deletedAt: null } });
          if (!before) throw new NotFoundException('Supplier not found');
          if (!('version' in input) || input.version !== before.version)
            throw new ConflictException('Reload this supplier');
        }
        const { commandId: _c, ...fields } = input;
        const row = id
          ? await tx.supplier.update({
              where: { ...scope(p), id },
              data: { ...fields, version: { increment: 1 } },
            })
          : await tx.supplier.create({ data: { ...scope(p), ...fields } });
        return { id: row.id, supplierId: row.id, before, response: row };
      },
    );
  }
  archiveSupplier(p: Principal, id: string, input: { commandId: string; version: number }) {
    return this.mutate(p, input.commandId, { id, input }, 'supplier.archived', async (tx) => {
      const before = await tx.supplier.findFirst({ where: { ...scope(p), id, deletedAt: null } });
      if (!before) throw new NotFoundException('Supplier not found');
      if (before.version !== input.version) throw new ConflictException('Reload this supplier');
      if (
        await tx.purchaseOrder.count({
          where: {
            ...scope(p),
            supplierId: id,
            status: { in: ['DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED'] },
          },
        })
      )
        throw new ConflictException('Complete or cancel open purchase orders before archiving');
      const row = await tx.supplier.update({
        where: { id, ...scope(p) },
        data: { active: false, deletedAt: new Date(), version: { increment: 1 } },
      });
      return { id, supplierId: id, before, response: row };
    });
  }
  async catalog(p: Principal, q: PurchasingListInput, kind: 'items' | 'warehouses' | 'suppliers') {
    const where = {
      ...scope(p),
      active: true,
      deletedAt: null,
      name: { contains: q.search, mode: 'insensitive' as const },
    };
    if (kind === 'items')
      return page(
        await this.db.client.inventoryItem.findMany({
          where,
          select: { id: true, name: true, sku: true, unitCode: true },
          orderBy: { id: 'asc' },
          ...paging(q),
        }),
        q,
      );
    if (kind === 'warehouses')
      return page(
        await this.db.client.warehouse.findMany({
          where,
          select: { id: true, name: true },
          orderBy: { id: 'asc' },
          ...paging(q),
        }),
        q,
      );
    return page(
      await this.db.client.supplier.findMany({
        where,
        select: { id: true, name: true },
        orderBy: { id: 'asc' },
        ...paging(q),
      }),
      q,
    );
  }
  private async order(tx: Tx, p: Principal, id: string) {
    const row = await tx.purchaseOrder.findFirst({ where: { ...scope(p), id } });
    if (!row) throw new NotFoundException('Purchase order not found');
    return row;
  }
  private async prepared(tx: Tx, p: Principal, input: PurchaseDraftInput) {
    const supplier = await tx.supplier.findFirst({
        where: { ...scope(p), id: input.supplierId, active: true, deletedAt: null },
      }),
      warehouse = await tx.warehouse.findFirst({
        where: { ...scope(p), id: input.warehouseId, active: true, deletedAt: null },
      });
    if (!supplier || !warehouse)
      throw new NotFoundException('Active supplier or warehouse not found');
    const items = [];
    for (const line of input.items) {
      const item = await tx.inventoryItem.findFirst({
        where: { ...scope(p), id: line.itemId, active: true, deletedAt: null },
      });
      if (!item) throw new NotFoundException('Active stock item not found');
      items.push({
        ...line,
        itemName: item.name,
        sku: item.sku,
        stockUnit: item.unitCode,
        stockQuantity: convertQuantity(
          line.quantity,
          line.unitCode,
          item.unitCode as InventoryUnitCode,
        ),
        ...purchaseLine(line.quantity, line.unitPrice, line.taxRate),
      });
    }
    return {
      items,
      header: {
        supplierId: supplier.id,
        warehouseId: warehouse.id,
        warehouseName: warehouse.name,
        supplierSnapshot: json({
          name: supplier.name,
          businessNumber: supplier.businessNumber,
          taxNumber: supplier.taxNumber,
          address: supplier.address,
        }),
        reference: input.reference,
        notes: input.notes,
        expectedDate: date(input.expectedDate),
        ...purchaseTotals(items),
      },
    };
  }
  saveOrder(p: Principal, input: PurchaseDraftInput | PurchaseUpdate, id?: string) {
    return this.mutate(
      p,
      input.commandId,
      { id, input },
      id ? 'purchase.draft_updated' : 'purchase.created',
      async (tx) => {
        let before;
        if (id) {
          const old = await this.order(tx, p, id);
          if (old.status !== 'DRAFT') throw new ConflictException('Only drafts may be edited');
          if (!('version' in input) || input.version !== old.version)
            throw new ConflictException('Reload this purchase order');
          before = await this.orderRecord(tx, p, id);
        }
        await inventoryLock(tx, p);
        const { items, header } = await this.prepared(tx, p, input);
        const branch = await tx.branch.findFirstOrThrow({
          where: { id: p.branchId, organizationId: p.organizationId },
        });
        let row;
        if (id) {
          await tx.purchaseItem.updateMany({
            where: { ...scope(p), purchaseOrderId: id, voidedAt: null },
            data: { voidedAt: new Date() },
          });
          row = await tx.purchaseOrder.update({
            where: { ...scope(p), id },
            data: { ...header, version: { increment: 1 } },
          });
        } else {
          const rev = await tx.purchasingRevision.update({
            where: { branchId: p.branchId },
            data: { nextNumber: { increment: 1 } },
          });
          row = await tx.purchaseOrder.create({
            data: {
              ...scope(p),
              ...header,
              number: rev.nextNumber,
              userId: p.userId,
              currency: branch.currency,
            },
          });
        }
        await tx.purchaseItem.createMany({
          data: items.map((i) => ({ ...i, ...scope(p), purchaseOrderId: row.id })),
        });
        return {
          id: row.id,
          supplierId: row.supplierId,
          purchaseOrderId: row.id,
          before,
          response: await this.orderRecord(tx, p, row.id),
        };
      },
    );
  }
  orderAction(
    p: Principal,
    id: string,
    input: { commandId: string; version: number; reason?: string },
    action: 'order' | 'cancel',
  ) {
    return this.mutate(
      p,
      input.commandId,
      { id, input, action },
      'purchase.' + action,
      async (tx) => {
        const row = await this.order(tx, p, id);
        if (row.version !== input.version)
          throw new ConflictException('Reload this purchase order');
        if (action === 'order' && row.status !== 'DRAFT')
          throw new ConflictException('Only drafts can be ordered');
        if (action === 'cancel' && !['DRAFT', 'ORDERED'].includes(row.status))
          throw new ConflictException('Received purchases cannot be cancelled');
        if (action === 'order') {
          await inventoryLock(tx, p);
          if (
            !(await tx.supplier.findFirst({
              where: { id: row.supplierId, ...scope(p), active: true, deletedAt: null },
            }))
          )
            throw new ConflictException('Supplier is inactive');
          if (
            !(await tx.warehouse.findFirst({
              where: { id: row.warehouseId, ...scope(p), active: true, deletedAt: null },
            }))
          )
            throw new ConflictException('Warehouse is inactive');
          const lines = await tx.purchaseItem.findMany({
            where: { ...scope(p), purchaseOrderId: id, voidedAt: null },
            include: { item: true },
          });
          if (lines.some((l) => !l.item.active || l.item.deletedAt))
            throw new ConflictException('Purchase contains inactive items');
        }
        const before = await this.orderRecord(tx, p, id);
        await tx.purchaseOrder.update({
          where: { ...scope(p), id },
          data: {
            status: action === 'order' ? 'ORDERED' : 'CANCELLED',
            ...(action === 'order'
              ? { orderedAt: new Date() }
              : { cancelledAt: new Date(), cancellationReason: input.reason }),
            version: { increment: 1 },
          },
        });
        return {
          id,
          supplierId: row.supplierId,
          purchaseOrderId: id,
          before,
          response: await this.orderRecord(tx, p, id),
        };
      },
    );
  }
  private async orderRecord(tx: Tx, p: Principal, id: string): Promise<PurchaseRecord> {
    const row = await this.order(tx, p, id);
    const lines = await tx.purchaseItem.findMany({
      where: { ...scope(p), purchaseOrderId: id, voidedAt: null },
      include: { receiptItems: true },
      orderBy: { id: 'asc' },
    });
    return {
      id: row.id,
      number: row.number.toString(),
      cancellationReason: row.cancellationReason,
      status: row.status,
      version: row.version,
      supplierId: row.supplierId,
      supplierName: String((row.supplierSnapshot as Record<string, unknown>).name),
      warehouseId: row.warehouseId,
      warehouseName: row.warehouseName,
      currency: row.currency,
      reference: row.reference,
      notes: row.notes,
      expectedDate: isoDate(row.expectedDate),
      subtotal: row.subtotal.toFixed(2),
      tax: row.tax.toFixed(2),
      total: row.total.toFixed(2),
      createdAt: row.createdAt.toISOString(),
      items: lines.map((l) => {
        const received = l.receiptItems.reduce(
          (sum, r) => sum + quantityMicros(r.quantity.toFixed(6)),
          0n,
        );
        return {
          id: l.id,
          itemId: l.itemId,
          itemName: l.itemName,
          sku: l.sku,
          stockUnit: l.stockUnit as InventoryUnitCode,
          unitCode: l.unitCode as InventoryUnitCode,
          quantity: l.quantity.toFixed(6),
          stockQuantity: l.stockQuantity.toFixed(6),
          unitPrice: l.unitPrice.toFixed(4),
          taxRate: l.taxRate.toFixed(2),
          subtotal: l.subtotal.toFixed(2),
          tax: l.tax.toFixed(2),
          total: l.total.toFixed(2),
          receivedQuantity: quantityText(received),
          remainingQuantity: quantityText(quantityMicros(l.quantity.toFixed(6)) - received),
        };
      }),
    };
  }
  getOrder(p: Principal, id: string) {
    return this.db.client.$transaction((tx) => this.orderRecord(tx, p, id), {
      isolationLevel: 'RepeatableRead',
    });
  }
  listOrders(p: Principal, q: PurchasingListInput) {
    return this.db.client.$transaction(
      async (tx) => {
        const rows = await tx.purchaseOrder.findMany({
          where: {
            ...scope(p),
            supplierId: q.supplierId,
            status: q.status,
            OR: [
              { reference: { contains: q.search, mode: 'insensitive' as const } },
              { supplierSnapshot: { path: ['name'], string_contains: q.search } },
            ],
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...paging(q),
        });
        const results = [];
        for (const r of rows) results.push(await this.orderRecord(tx, p, r.id));
        return page(results, q);
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  receive(p: Principal, id: string, input: GoodsReceiptInput) {
    return this.mutate(p, input.commandId, { id, input }, 'purchase.received', async (tx) => {
      const order = await this.order(tx, p, id);
      if (order.version !== input.version)
        throw new ConflictException('Reload this purchase order');
      if (!['ORDERED', 'PARTIALLY_RECEIVED'].includes(order.status))
        throw new ConflictException('Purchase order is not awaiting goods');
      await inventoryLock(tx, p);
      const warehouse = await tx.warehouse.findFirst({
        where: { ...scope(p), id: order.warehouseId, active: true, deletedAt: null },
      });
      if (!warehouse) throw new ConflictException('Receiving warehouse is inactive');
      const before = await this.orderRecord(tx, p, id);
      const prepared: {
        purchaseItemId: string;
        quantity: string;
        stockQuantity: string;
        subtotal: string;
        tax: string;
        total: string;
        ordered: PurchaseRecord['items'][number];
      }[] = [];
      for (const line of input.items) {
        const ordered = before.items.find((i) => i.id === line.purchaseItemId);
        if (!ordered) throw new NotFoundException('Purchase item not found');
        if (quantityMicros(line.quantity) > quantityMicros(ordered.remainingQuantity))
          throw new ConflictException('Received quantity exceeds remaining order quantity');
        const item = await tx.inventoryItem.findFirst({
          where: { ...scope(p), id: ordered.itemId, active: true, deletedAt: null },
        });
        if (!item) throw new ConflictException('Receiving item is inactive');
        prepared.push({
          ...line,
          stockQuantity: convertQuantity(line.quantity, ordered.unitCode, ordered.stockUnit),
          ...purchaseLine(line.quantity, ordered.unitPrice, ordered.taxRate),
          ordered,
        });
      }
      const totals = purchaseTotals(prepared);
      const receipt = await tx.goodsReceipt.create({
        data: {
          ...scope(p),
          purchaseOrderId: id,
          supplierId: order.supplierId,
          receivedBy: p.userId,
          reference: input.reference,
          invoiceNumber: input.invoiceNumber,
          invoiceDate: date(input.invoiceDate),
          dueDate: date(input.dueDate),
          documentReference: input.documentReference,
          notes: input.notes,
          currency: order.currency,
          ...totals,
        },
      });
      for (const line of prepared) {
        const { ordered, ...fields } = line;
        const r = await tx.goodsReceiptItem.create({
          data: { ...scope(p), ...fields, purchaseOrderId: id, receiptId: receipt.id },
        });
        const position = await inventoryPosition(tx, p, order.warehouseId, ordered.itemId);
        await tx.stockMovement.create({
          data: {
            ...scope(p),
            positionId: position.id,
            userId: p.userId,
            kind: 'PURCHASE',
            quantity: r.stockQuantity,
            reason: 'Goods received: ' + input.reference,
            enteredQuantity: line.quantity,
            enteredUnit: ordered.unitCode,
            receiptItemId: r.id,
            snapshot: json({
              ingredientName: ordered.itemName,
              warehouseName: order.warehouseName,
              unitCode: ordered.stockUnit,
              purchaseOrderId: id,
              purchaseNumber: order.number.toString(),
              receiptId: receipt.id,
              receiptReference: input.reference,
              supplierName: before.supplierName,
            }),
          },
        });
      }
      await tx.supplierEntry.create({
        data: {
          ...scope(p),
          supplierId: order.supplierId,
          receiptId: receipt.id,
          userId: p.userId,
          kind: 'CHARGE',
          amount: receipt.total,
          reason: 'Received goods charge',
        },
      });
      const complete = before.items.every(
        (i) =>
          quantityMicros(i.remainingQuantity) ===
          (prepared.find((l) => l.purchaseItemId === i.id)
            ? quantityMicros(prepared.find((l) => l.purchaseItemId === i.id)!.quantity)
            : 0n),
      );
      await tx.purchaseOrder.update({
        where: { ...scope(p), id },
        data: { status: complete ? 'RECEIVED' : 'PARTIALLY_RECEIVED', version: { increment: 1 } },
      });
      await inventoryEvent(tx, p, {
        commandId: randomUUID(),
        requestHash: '0'.repeat(64),
        action: 'inventory.goods_received',
        entityId: receipt.id,
        response: { receiptId: receipt.id, purchaseOrderId: id, movements: prepared.length },
      });
      return {
        id: receipt.id,
        supplierId: order.supplierId,
        purchaseOrderId: id,
        before,
        response: await this.receiptRecord(tx, p, receipt.id),
      };
    });
  }
  private async receiptRecord(tx: Tx, p: Principal, id: string): Promise<ReceiptRecord> {
    const r = await tx.goodsReceipt.findFirst({
      where: { ...scope(p), id },
      include: {
        order: true,
        actor: { include: { user: true } },
        items: { include: { purchaseItem: true }, orderBy: { id: 'asc' } },
        entries: true,
      },
    });
    if (!r) throw new NotFoundException('Goods receipt not found');
    return {
      id: r.id,
      purchaseOrderId: r.purchaseOrderId,
      purchaseNumber: r.order.number.toString(),
      supplierId: r.supplierId,
      supplierName: String((r.order.supplierSnapshot as Record<string, unknown>).name),
      warehouseName: r.order.warehouseName,
      reference: r.reference,
      invoiceNumber: r.invoiceNumber,
      invoiceDate: isoDate(r.invoiceDate),
      dueDate: isoDate(r.dueDate),
      documentReference: r.documentReference,
      notes: r.notes,
      currency: r.currency,
      subtotal: r.subtotal.toFixed(2),
      tax: r.tax.toFixed(2),
      total: r.total.toFixed(2),
      outstanding: sumMoney(r.entries.map((e) => e.amount.toFixed(2))),
      receivedBy: r.actor.user.name,
      createdAt: r.createdAt.toISOString(),
      items: r.items.map((i) => ({
        id: i.id,
        purchaseItemId: i.purchaseItemId,
        itemName: i.purchaseItem.itemName,
        unitCode: i.purchaseItem.unitCode as InventoryUnitCode,
        stockUnit: i.purchaseItem.stockUnit as InventoryUnitCode,
        quantity: i.quantity.toFixed(6),
        stockQuantity: i.stockQuantity.toFixed(6),
        unitPrice: i.purchaseItem.unitPrice.toFixed(4),
        taxRate: i.purchaseItem.taxRate.toFixed(2),
        subtotal: i.subtotal.toFixed(2),
        tax: i.tax.toFixed(2),
        total: i.total.toFixed(2),
      })),
    };
  }
  getReceipt(p: Principal, id: string) {
    return this.db.client.$transaction((tx) => this.receiptRecord(tx, p, id), {
      isolationLevel: 'RepeatableRead',
    });
  }
  receipts(p: Principal, q: PurchasingListInput) {
    return this.db.client.$transaction(
      async (tx) => {
        const rows = await tx.goodsReceipt.findMany({
          where: {
            ...scope(p),
            supplierId: q.supplierId,
            purchaseOrderId: q.purchaseOrderId,
            OR: [
              { reference: { contains: q.search, mode: 'insensitive' as const } },
              { invoiceNumber: { contains: q.search, mode: 'insensitive' as const } },
            ],
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...paging(q),
        });
        const results = [];
        for (const r of rows) results.push(await this.receiptRecord(tx, p, r.id));
        return page(results, q);
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  account(p: Principal, supplierId: string, q: PurchasingListInput): Promise<SupplierAccount> {
    return this.db.client.$transaction(
      async (tx) => {
        if (!(await tx.supplier.findFirst({ where: { ...scope(p), id: supplierId } })))
          throw new NotFoundException('Supplier not found');
        const branch = await tx.branch.findFirstOrThrow({
          where: { id: p.branchId, organizationId: p.organizationId },
        });
        const sums = await tx.supplierEntry.groupBy({
          by: ['kind'],
          where: { ...scope(p), supplierId },
          _sum: { amount: true },
        });
        const receipts = await tx.goodsReceipt.aggregate({
          where: { ...scope(p), supplierId },
          _count: true,
          _max: { createdAt: true },
        });
        const rows = await tx.supplierEntry.findMany({
          where: { ...scope(p), supplierId },
          include: { actor: { include: { user: true } }, receipt: true, reversal: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...paging(q),
        });
        return {
          supplierId,
          currency: branch.currency,
          receivedValue: sums.find((s) => s.kind === 'CHARGE')?._sum.amount?.toFixed(2) ?? '0.00',
          outstanding: sumMoney(sums.map((s) => s._sum.amount?.toFixed(2) ?? '0.00')),
          receiptCount: receipts._count,
          lastReceiptAt: receipts._max.createdAt?.toISOString() ?? null,
          ...page(
            rows.map((r) => ({
              id: r.id,
              receiptId: r.receiptId,
              receiptReference: r.receipt.reference,
              kind: r.kind,
              amount: r.amount.toFixed(2),
              method: r.method,
              reference: r.reference,
              reason: r.reason,
              reversesId: r.reversesId,
              reversed: !!r.reversal,
              createdAt: r.createdAt.toISOString(),
              userName: r.actor.user.name,
            })),
            q,
          ),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  recordPayment(p: Principal, input: SupplierPaymentInput) {
    return this.mutate(p, input.commandId, input, 'supplier.payment_recorded', async (tx) => {
      const receipt = await this.receiptRecord(tx, p, input.receiptId);
      if (exceedsMoney(input.amount, receipt.outstanding))
        throw new ConflictException('Supplier payment exceeds this receipt balance');
      const row = await tx.supplierEntry.create({
        data: {
          ...scope(p),
          supplierId: receipt.supplierId,
          receiptId: receipt.id,
          userId: p.userId,
          kind: 'PAYMENT',
          amount: negateMoney(input.amount),
          method: input.method,
          reference: input.reference,
          reason: input.reason,
        },
      });
      return {
        id: row.id,
        supplierId: receipt.supplierId,
        purchaseOrderId: receipt.purchaseOrderId,
        response: row,
      };
    });
  }
  reversePayment(p: Principal, id: string, input: { commandId: string; reason: string }) {
    return this.mutate(
      p,
      input.commandId,
      { id, input },
      'supplier.payment_reversed',
      async (tx) => {
        const old = await tx.supplierEntry.findFirst({
          where: { ...scope(p), id, kind: 'PAYMENT' },
          include: { reversal: true, receipt: true },
        });
        if (!old) throw new NotFoundException('Supplier payment not found');
        if (old.reversal) throw new ConflictException('Supplier payment already reversed');
        const row = await tx.supplierEntry.create({
          data: {
            ...scope(p),
            supplierId: old.supplierId,
            receiptId: old.receiptId,
            userId: p.userId,
            kind: 'PAYMENT_REVERSAL',
            amount: negateMoney(old.amount.toFixed(2)),
            reason: input.reason,
            reversesId: id,
          },
        });
        return {
          id: row.id,
          supplierId: old.supplierId,
          purchaseOrderId: old.receipt.purchaseOrderId,
          before: old,
          response: row,
        };
      },
    );
  }
  async events(p: Principal, after: string, limit: number, purchaseOrderId?: string) {
    const rows = await this.db.client.purchasingEvent.findMany({
      where: { ...scope(p), revision: { gt: BigInt(after) }, purchaseOrderId },
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
        ...(purchaseOrderId ? { response: r.response } : {}),
      })),
      cursor: rows.slice(0, limit).at(-1)?.revision.toString() ?? after,
      hasMore: rows.length > limit,
    };
  }
}
