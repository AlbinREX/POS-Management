// Read-only reporting over the authoritative Phase 1-10 tables. Nothing here writes:
// every method runs a RepeatableRead transaction so each report is a single consistent
// snapshot, every query carries the session's branch and organization, and every figure
// is derived from immutable order, payment, ledger and movement rows rather than from
// current mutable prices or a second balance table.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@restaurant/database';
import type {
  CashReport,
  CashShiftRow,
  CompaniesReport,
  CompanyReportRow,
  DailySalesRow,
  DashboardOverview,
  InventoryMovementRow,
  InventoryReport,
  InventoryStockRow,
  InventoryUnitCode,
  MethodMix,
  OrdersReport,
  ProductSalesRow,
  ProductsReport,
  PurchasingReport,
  ReportKind,
  ReportRange,
  SalesSummary,
  StaffReport,
  StaffRow,
  SupplierReportRow,
} from '@restaurant/shared-types';
import type { ReportRangeInput } from '@restaurant/validation';
import type { Principal } from '../auth/auth.service';
import { availableCredit, sumMoney } from '../companies/company-money';
import { DatabaseService } from '../database.service';
import { inventoryScope as scope } from '../inventory/inventory.transactions';
import { quantityMicros } from '../inventory/quantity';
import { csvDocument, csvFilename } from './report-csv';
import {
  averageMoney,
  cents,
  compareMoney,
  maxMoney,
  minusMoney,
  money,
  moneyText,
} from './report-money';
import { dayRange, eachDay, localDate, localHour, presetRange, type UtcRange } from './report-time';

type Tx = Prisma.TransactionClient;
interface Resolved {
  utc: UtcRange;
  range: ReportRange;
  branch: { name: string; currency: string; timezone: string };
}
const read = { isolationLevel: 'RepeatableRead' as const };
const between = (utc: UtcRange) => ({ gte: utc.from, lt: utc.to });
const METHODS = ['CASH', 'CARD', 'COMPANY_ACCOUNT'] as const;
const EXPORT_LIMIT = 50000;
const dateText = (v: Date) => v.toISOString().slice(0, 10);
const quantityOf = (v: Prisma.Decimal | null | undefined) => v?.toFixed(6) ?? '0.000000';
const addDays = (from: Date, days: number) => new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
type Sums = Map<string, bigint>;
const add = (sums: Sums, key: string, value: string) =>
  sums.set(key, (sums.get(key) ?? 0n) + cents(value));
const total = (sums: Sums, key: string) => money(sums.get(key) ?? 0n);
// The label used on most settled orders wins when a snapshot name changed over time.
const commonName = (names: Map<string, number>) =>
  [...names].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? '';

@Injectable()
export class ReportingService {
  constructor(private readonly db: DatabaseService) {}
  private run<T>(fn: (tx: Tx) => Promise<T>) {
    return this.db.client.$transaction(fn, read);
  }
  // The principal binds one branch; its timezone decides every day boundary below.
  private async resolve(tx: Tx, p: Principal, q: ReportRangeInput): Promise<Resolved> {
    const branch = await tx.branch.findFirst({
      where: { id: p.branchId, organizationId: p.organizationId },
      select: { name: true, currency: true, timezone: true },
    });
    if (!branch) throw new NotFoundException('Branch not found');
    const utc =
      q.preset === 'custom'
        ? dayRange(q.from ?? '', q.to ?? '', branch.timezone)
        : presetRange(q.preset, branch.timezone);
    return {
      utc,
      branch,
      range: {
        preset: q.preset,
        fromDate: utc.fromDate,
        toDate: utc.toDate,
        timezone: branch.timezone,
        from: utc.from.toISOString(),
        to: utc.to.toISOString(),
      },
    };
  }
  // Revenue is recognized when an order is settled PAID. Cancelled orders keep their
  // totals, so status is filtered explicitly rather than by amount.
  private settled(p: Principal, r: Resolved) {
    return { ...scope(p), status: 'PAID' as const, settlement: { createdAt: between(r.utc) } };
  }
  // Tender mix by payment time; reversals are attributed to the original tender's method.
  private async methodMixTx(tx: Tx, p: Principal, r: Resolved): Promise<MethodMix[]> {
    const payments = await tx.payment.groupBy({
      by: ['method'],
      where: { ...scope(p), createdAt: between(r.utc) },
      _count: true,
      _sum: { amount: true },
    });
    const reversals = await tx.paymentReversal.findMany({
      where: { ...scope(p), createdAt: between(r.utc) },
      select: { kind: true, amount: true, payment: { select: { method: true } } },
    });
    return METHODS.map((method) => {
      const paid = payments.find((x) => x.method === method);
      const of = (kind: 'CANCELLATION' | 'REFUND') =>
        sumMoney(
          reversals
            .filter((v) => v.payment.method === method && v.kind === kind)
            .map((v) => v.amount.toFixed(2)),
        );
      const collected = moneyText(paid?._sum.amount),
        cancelled = of('CANCELLATION'),
        refunded = of('REFUND');
      return {
        method,
        count: paid?._count ?? 0,
        collected,
        cancelled,
        refunded,
        net: minusMoney(minusMoney(collected, cancelled), refunded),
      };
    });
  }
  private async salesTx(tx: Tx, p: Principal, r: Resolved): Promise<SalesSummary> {
    const where = this.settled(p, r);
    const totals = await tx.order.aggregate({
      where,
      _count: true,
      _sum: { subtotal: true, discount: true, tax: true, total: true },
    });
    const byType = await tx.order.groupBy({
      by: ['type'],
      where,
      _count: true,
      _sum: { total: true },
    });
    const byMethod = await this.methodMixTx(tx, p, r);
    const type = (t: 'DINE_IN' | 'TAKEAWAY') => {
      const x = byType.find((b) => b.type === t);
      return { count: x?._count ?? 0, total: moneyText(x?._sum.total) };
    };
    const salesAfterDiscount = moneyText(totals._sum.total),
      tax = moneyText(totals._sum.tax);
    const company = byMethod.find((m) => m.method === 'COMPANY_ACCOUNT');
    return {
      range: r.range,
      currency: r.branch.currency,
      orderCount: totals._count,
      grossSales: moneyText(totals._sum.subtotal),
      discounts: moneyText(totals._sum.discount),
      salesAfterDiscount,
      tax,
      // Order_valid guarantees total = subtotal - discount with tax included in total.
      netSales: minusMoney(salesAfterDiscount, tax),
      averageOrderValue: averageMoney(salesAfterDiscount, totals._count),
      collected: sumMoney(byMethod.map((m) => m.collected)),
      cancellations: sumMoney(byMethod.map((m) => m.cancelled)),
      refunds: sumMoney(byMethod.map((m) => m.refunded)),
      netReceipts: sumMoney(byMethod.map((m) => m.net)),
      dineIn: type('DINE_IN'),
      takeaway: type('TAKEAWAY'),
      byMethod,
      companyAccount: { count: company?.count ?? 0, charged: company?.collected ?? '0.00' },
    };
  }
  private async ordersTx(tx: Tx, p: Principal, r: Resolved): Promise<OrdersReport> {
    const where = this.settled(p, r);
    const settlements = await tx.orderSettlement.findMany({
      where: { ...scope(p), createdAt: between(r.utc) },
      select: {
        createdAt: true,
        order: { select: { subtotal: true, discount: true, tax: true, total: true } },
      },
      orderBy: [{ createdAt: 'asc' }, { orderId: 'asc' }],
    });
    type Day = { orderCount: number; gross: bigint; discounts: bigint; tax: bigint; total: bigint };
    const days = new Map<string, Day>();
    for (const d of eachDay(r.utc))
      days.set(d, { orderCount: 0, gross: 0n, discounts: 0n, tax: 0n, total: 0n });
    const hours = Array.from({ length: 24 }, () => ({ orderCount: 0, total: 0n }));
    for (const s of settlements) {
      const day = days.get(localDate(s.createdAt, r.branch.timezone));
      const hour = hours[localHour(s.createdAt, r.branch.timezone)];
      const amount = cents(s.order.total.toFixed(2));
      if (day) {
        day.orderCount++;
        day.gross += cents(s.order.subtotal.toFixed(2));
        day.discounts += cents(s.order.discount.toFixed(2));
        day.tax += cents(s.order.tax.toFixed(2));
        day.total += amount;
      }
      if (hour) {
        hour.orderCount++;
        hour.total += amount;
      }
    }
    const byDay: DailySalesRow[] = [...days].map(([date, d]) => ({
      date,
      orderCount: d.orderCount,
      grossSales: money(d.gross),
      discounts: money(d.discounts),
      tax: money(d.tax),
      total: money(d.total),
      netSales: money(d.total - d.tax),
    }));
    const byStatus = await tx.order.groupBy({
      by: ['status'],
      where: { ...scope(p), createdAt: between(r.utc) },
      _count: true,
    });
    const byType = await tx.order.groupBy({
      by: ['type'],
      where,
      _count: true,
      _sum: { total: true },
    });
    const voidedItems = await tx.orderItem.count({
      where: { ...scope(p), voidedAt: between(r.utc) },
    });
    const tables = await tx.order.groupBy({
      by: ['tableId', 'tableName'],
      where: { ...where, tableId: { not: null } },
      _count: true,
      _sum: { total: true },
    });
    // Table names are order snapshots; a renamed table keeps the name it served under most.
    const usage = new Map<string, { names: Map<string, number>; orders: number; total: bigint }>();
    for (const t of tables) {
      if (!t.tableId) continue;
      const row = usage.get(t.tableId) ?? { names: new Map(), orders: 0, total: 0n };
      row.names.set(t.tableName ?? '', (row.names.get(t.tableName ?? '') ?? 0) + t._count);
      row.orders += t._count;
      row.total += cents(moneyText(t._sum.total));
      usage.set(t.tableId, row);
    }
    const tableUsage = [...usage]
      .map(([tableId, row]) => ({
        tableId,
        tableName: commonName(row.names),
        orders: row.orders,
        total: money(row.total),
      }))
      .sort((a, b) => b.orders - a.orders || a.tableName.localeCompare(b.tableName))
      .slice(0, 20);
    const top = await tx.order.findMany({
      where,
      select: {
        id: true,
        orderNumber: true,
        type: true,
        tableName: true,
        waiterName: true,
        total: true,
        settlement: { select: { createdAt: true } },
      },
      orderBy: [{ total: 'desc' }, { id: 'asc' }],
      take: 10,
    });
    return {
      range: r.range,
      currency: r.branch.currency,
      byDay,
      byHour: hours.map((h, hour) => ({ hour, orderCount: h.orderCount, total: money(h.total) })),
      byStatus: byStatus
        .map((s) => ({ status: s.status, count: s._count }))
        .sort((a, b) => a.status.localeCompare(b.status)),
      byType: byType
        .map((t) => ({ type: t.type, count: t._count, total: moneyText(t._sum.total) }))
        .sort((a, b) => a.type.localeCompare(b.type)),
      voidedItems,
      tableUsage,
      topOrders: top.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber.toString(),
        type: o.type,
        tableName: o.tableName,
        waiterName: o.waiterName,
        total: o.total.toFixed(2),
        settledAt: o.settlement?.createdAt.toISOString() ?? '',
      })),
    };
  }
  // Product revenue comes from the frozen OrderItem snapshots. Modifier price adjustments
  // are already folded into each line total and are counted, never summed again.
  private async productRowsTx(tx: Tx, p: Principal, r: Resolved) {
    const groups = await tx.orderItem.groupBy({
      by: ['productId', 'productName', 'categoryName'],
      where: { ...scope(p), voidedAt: null, order: this.settled(p, r) },
      _count: true,
      _sum: { quantity: true, total: true },
    });
    return groups
      .map<ProductSalesRow>((g) => ({
        productId: g.productId,
        productName: g.productName,
        categoryName: g.categoryName,
        quantity: g._sum.quantity ?? 0,
        lines: g._count,
        sales: moneyText(g._sum.total),
      }))
      .sort(
        (a, b) =>
          compareMoney(b.sales, a.sales) ||
          b.quantity - a.quantity ||
          a.productName.localeCompare(b.productName),
      );
  }
  private async productsTx(tx: Tx, p: Principal, r: Resolved): Promise<ProductsReport> {
    const rows = await this.productRowsTx(tx, p, r);
    const categories = new Map<string, { quantity: number; sales: bigint }>();
    let quantity = 0,
      sales = 0n;
    for (const row of rows) {
      const c = categories.get(row.categoryName) ?? { quantity: 0, sales: 0n };
      c.quantity += row.quantity;
      c.sales += cents(row.sales);
      categories.set(row.categoryName, c);
      quantity += row.quantity;
      sales += cents(row.sales);
    }
    const modifiers = await tx.orderItemModifier.groupBy({
      by: ['groupName', 'name'],
      where: { ...scope(p), item: { voidedAt: null, order: this.settled(p, r) } },
      _count: { name: true },
      orderBy: [{ _count: { name: 'desc' } }, { groupName: 'asc' }, { name: 'asc' }],
      take: 20,
    });
    return {
      range: r.range,
      currency: r.branch.currency,
      productCount: rows.length,
      quantity,
      sales: money(sales),
      top: rows.slice(0, 20),
      low: [...rows].reverse().slice(0, 20),
      byCategory: [...categories]
        .map(([categoryName, c]) => ({ categoryName, quantity: c.quantity, sales: money(c.sales) }))
        .sort(
          (a, b) => compareMoney(b.sales, a.sales) || a.categoryName.localeCompare(b.categoryName),
        ),
      modifiers: modifiers.map((m) => ({
        groupName: m.groupName,
        name: m.name,
        lines: m._count.name,
      })),
    };
  }
  // Staff figures are limited to what the schema records: settled orders attributed to a
  // waiter snapshot and settlements performed by a cashier. No timing or speed metric exists.
  private async staffTx(tx: Tx, p: Principal, r: Resolved): Promise<StaffReport> {
    const waiters = await tx.order.groupBy({
      by: ['waiterId', 'waiterName', 'type'],
      where: this.settled(p, r),
      _count: true,
      _sum: { total: true },
    });
    const cashiers = await tx.orderSettlement.groupBy({
      by: ['cashierId'],
      where: { ...scope(p), createdAt: between(r.utc) },
      _count: true,
      _sum: { amount: true },
    });
    const members = await tx.branchMembership.findMany({
      where: { ...scope(p), userId: { in: cashiers.map((c) => c.cashierId) } },
      select: { userId: true, user: { select: { name: true } } },
    });
    type Acc = {
      names: Map<string, number>;
      orders: number;
      sales: bigint;
      dineIn: number;
      takeaway: number;
    };
    const byWaiter = new Map<string, Acc>();
    for (const w of waiters) {
      const key = w.waiterId ?? '';
      const acc = byWaiter.get(key) ?? {
        names: new Map(),
        orders: 0,
        sales: 0n,
        dineIn: 0,
        takeaway: 0,
      };
      const name = w.waiterName ?? 'Unassigned';
      acc.names.set(name, (acc.names.get(name) ?? 0) + w._count);
      acc.orders += w._count;
      acc.sales += cents(moneyText(w._sum.total));
      if (w.type === 'DINE_IN') acc.dineIn += w._count;
      else acc.takeaway += w._count;
      byWaiter.set(key, acc);
    }
    const row = (
      role: StaffRow['role'],
      userId: string | null,
      name: string,
      orders: number,
      sales: bigint,
      dineIn: number,
      takeaway: number,
    ): StaffRow => ({
      role,
      userId,
      name,
      orders,
      sales: money(sales),
      averageTicket: averageMoney(money(sales), orders),
      dineIn,
      takeaway,
    });
    const sort = (a: StaffRow, b: StaffRow) =>
      compareMoney(b.sales, a.sales) || b.orders - a.orders || a.name.localeCompare(b.name);
    return {
      range: r.range,
      currency: r.branch.currency,
      waiters: [...byWaiter]
        .map(([id, a]) =>
          row('WAITER', id || null, commonName(a.names), a.orders, a.sales, a.dineIn, a.takeaway),
        )
        .sort(sort),
      cashiers: cashiers
        .map((c) =>
          row(
            'CASHIER',
            c.cashierId,
            members.find((m) => m.userId === c.cashierId)?.user.name ?? 'Unknown',
            c._count,
            cents(moneyText(c._sum.amount)),
            0,
            0,
          ),
        )
        .sort(sort),
    };
  }
  // Cash movements are stored signed (cash out and reversals negative), so the expected
  // drawer is a plain sum. Closed shifts report their stored count and difference.
  private async cashTx(tx: Tx, p: Principal, r: Resolved): Promise<CashReport> {
    const shifts = await tx.cashShift.findMany({
      where: {
        ...scope(p),
        openedAt: { lt: r.utc.to },
        OR: [{ closedAt: null }, { closedAt: { gte: r.utc.from } }],
      },
      include: {
        terminal: { select: { name: true } },
        cashier: { select: { user: { select: { name: true } } } },
      },
      orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
    });
    const sums = await tx.cashMovement.groupBy({
      by: ['shiftId', 'kind'],
      where: { ...scope(p), shiftId: { in: shifts.map((s) => s.id) } },
      _sum: { amount: true },
    });
    const kind = (shiftId: string, k: string) =>
      moneyText(sums.find((s) => s.shiftId === shiftId && s.kind === k)?._sum.amount);
    const totals: Sums = new Map();
    let discrepancies = 0,
      openShifts = 0;
    const rows = shifts.map<CashShiftRow>((s) => {
      const opening = kind(s.id, 'OPENING'),
        cashIn = kind(s.id, 'CASH_IN'),
        cashOut = kind(s.id, 'CASH_OUT'),
        cashPayments = kind(s.id, 'PAYMENT'),
        cashReversals = kind(s.id, 'REVERSAL');
      const expectedAmount =
        s.expectedAmount?.toFixed(2) ??
        sumMoney([opening, cashIn, cashOut, cashPayments, cashReversals]);
      const difference = s.difference?.toFixed(2) ?? null;
      add(totals, 'opening', opening);
      add(totals, 'cashIn', cashIn);
      add(totals, 'cashOut', cashOut);
      add(totals, 'cashPayments', cashPayments);
      add(totals, 'cashReversals', cashReversals);
      add(totals, 'expected', expectedAmount);
      if (s.closingAmount) add(totals, 'counted', s.closingAmount.toFixed(2));
      if (difference) {
        add(totals, 'difference', difference);
        if (difference !== '0.00') discrepancies++;
      }
      if (s.status === 'OPEN') openShifts++;
      return {
        id: s.id,
        cashierName: s.cashier.user.name,
        terminalName: s.terminal.name,
        status: s.status,
        openedAt: s.openedAt.toISOString(),
        closedAt: s.closedAt?.toISOString() ?? null,
        openingAmount: s.openingAmount.toFixed(2),
        cashIn,
        cashOut,
        cashPayments,
        cashReversals,
        expectedAmount,
        closingAmount: s.closingAmount?.toFixed(2) ?? null,
        difference,
        closingReason: s.closingReason,
      };
    });
    const byMethod = await this.methodMixTx(tx, p, r);
    return {
      range: r.range,
      currency: r.branch.currency,
      byMethod,
      collected: sumMoney(byMethod.map((m) => m.collected)),
      cancellations: sumMoney(byMethod.map((m) => m.cancelled)),
      refunds: sumMoney(byMethod.map((m) => m.refunded)),
      netReceipts: sumMoney(byMethod.map((m) => m.net)),
      companyAccountSettled: byMethod.find((m) => m.method === 'COMPANY_ACCOUNT')?.net ?? '0.00',
      shifts: rows,
      totals: {
        shifts: rows.length,
        openShifts,
        openingFloat: total(totals, 'opening'),
        cashIn: total(totals, 'cashIn'),
        cashOut: total(totals, 'cashOut'),
        cashPayments: total(totals, 'cashPayments'),
        cashReversals: total(totals, 'cashReversals'),
        expected: total(totals, 'expected'),
        counted: total(totals, 'counted'),
        difference: total(totals, 'difference'),
        discrepancies,
      },
    };
  }
  // Stock is the sum of StockMovement per position, exactly as the inventory module
  // computes it. There is no second balance table; negative stock is derived here.
  private async stockRowsTx(tx: Tx, p: Principal, q: { warehouseId?: string; search: string }) {
    const positions = await tx.stockPosition.findMany({
      where: {
        ...scope(p),
        warehouseId: q.warehouseId,
        item: { deletedAt: null, name: { contains: q.search, mode: 'insensitive' } },
        warehouse: { deletedAt: null },
      },
      include: { item: true, warehouse: true },
      orderBy: { id: 'asc' },
    });
    const sums = await tx.stockMovement.groupBy({
      by: ['positionId'],
      where: { ...scope(p), positionId: { in: positions.map((r) => r.id) } },
      _sum: { quantity: true },
    });
    const quantities = new Map(sums.map((s) => [s.positionId, quantityOf(s._sum.quantity)]));
    return positions
      .map<InventoryStockRow>((r) => {
        const quantity = quantities.get(r.id) ?? '0.000000';
        const micros = quantityMicros(quantity);
        return {
          positionId: r.id,
          itemId: r.itemId,
          itemName: r.item.name,
          sku: r.item.sku,
          warehouseId: r.warehouseId,
          warehouseName: r.warehouse.name,
          unitCode: r.item.unitCode as InventoryUnitCode,
          quantity,
          lowStockThreshold: r.lowStockThreshold.toFixed(6),
          lowStock: micros <= quantityMicros(r.lowStockThreshold.toFixed(6)),
          negative: micros < 0n,
        };
      })
      .sort(
        (a, b) =>
          Number(b.negative) - Number(a.negative) ||
          Number(b.lowStock) - Number(a.lowStock) ||
          a.itemName.localeCompare(b.itemName) ||
          a.warehouseName.localeCompare(b.warehouseName) ||
          a.positionId.localeCompare(b.positionId),
      );
  }
  private async inventoryTx(
    tx: Tx,
    p: Principal,
    r: Resolved,
    q: ReportRangeInput,
  ): Promise<InventoryReport> {
    const rows = await this.stockRowsTx(tx, p, q);
    const ids = rows.map((x) => x.positionId);
    const movements = await tx.stockMovement.groupBy({
      by: ['kind'],
      where: { ...scope(p), positionId: { in: ids }, createdAt: between(r.utc) },
      _count: true,
    });
    // Quantities are only summed within one position: units differ across items.
    const perItem = await tx.stockMovement.groupBy({
      by: ['positionId', 'kind'],
      where: { ...scope(p), positionId: { in: ids }, createdAt: between(r.utc) },
      _count: true,
      _sum: { quantity: true },
    });
    const byItem = perItem
      .map<InventoryMovementRow | null>((m) => {
        const row = rows.find((x) => x.positionId === m.positionId);
        return row
          ? {
              positionId: m.positionId,
              itemName: row.itemName,
              warehouseName: row.warehouseName,
              unitCode: row.unitCode,
              kind: m.kind,
              count: m._count,
              quantity: quantityOf(m._sum.quantity),
            }
          : null;
      })
      .filter((m): m is InventoryMovementRow => m !== null)
      .sort(
        (a, b) =>
          a.kind.localeCompare(b.kind) ||
          a.itemName.localeCompare(b.itemName) ||
          a.warehouseName.localeCompare(b.warehouseName),
      );
    const start = (q.page - 1) * q.limit;
    return {
      range: r.range,
      positions: rows.length,
      lowStock: rows.filter((x) => x.lowStock).length,
      negativeStock: rows.filter((x) => x.negative).length,
      stock: {
        items: rows.slice(start, start + q.limit),
        hasMore: rows.length > start + q.limit,
        page: q.page,
      },
      movements: movements
        .map((m) => ({ kind: m.kind, count: m._count }))
        .sort((a, b) => a.kind.localeCompare(b.kind)),
      byItem,
    };
  }
  // Supplier balances are the signed SupplierEntry ledger: charges positive, payments
  // negative, reversals positive. Figures match the purchasing account endpoint exactly.
  private async purchasingTx(
    tx: Tx,
    p: Principal,
    r: Resolved,
    q: ReportRangeInput,
  ): Promise<PurchasingReport> {
    const suppliers = await tx.supplier.findMany({
      where: { ...scope(p), deletedAt: null, id: q.supplierId },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    const ids = suppliers.map((s) => s.id);
    const sums = await tx.supplierEntry.groupBy({
      by: ['supplierId', 'kind'],
      where: { ...scope(p), supplierId: { in: ids } },
      _sum: { amount: true },
    });
    const receipts = await tx.goodsReceipt.groupBy({
      by: ['supplierId'],
      where: { ...scope(p), supplierId: { in: ids } },
      _count: true,
    });
    const received = await tx.goodsReceipt.groupBy({
      by: ['supplierId'],
      where: { ...scope(p), supplierId: { in: ids }, createdAt: between(r.utc) },
      _count: true,
      _sum: { total: true },
    });
    const paid = await tx.supplierEntry.aggregate({
      where: {
        ...scope(p),
        supplierId: { in: ids },
        kind: { in: ['PAYMENT', 'PAYMENT_REVERSAL'] },
        createdAt: between(r.utc),
      },
      _sum: { amount: true },
    });
    const orders = await tx.purchaseOrder.groupBy({
      by: ['status'],
      where: { ...scope(p), supplierId: { in: ids }, createdAt: between(r.utc) },
      _count: true,
    });
    const recent = await tx.goodsReceipt.findMany({
      where: { ...scope(p), supplierId: { in: ids }, createdAt: between(r.utc) },
      include: { entries: { select: { amount: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 25,
    });
    const name = new Map(suppliers.map((s) => [s.id, s.name]));
    const rows = suppliers
      .map<SupplierReportRow>((s) => {
        const mine = sums.filter((x) => x.supplierId === s.id);
        const amounts = mine.map((x) => moneyText(x._sum.amount));
        return {
          supplierId: s.id,
          supplierName: s.name,
          receipts: receipts.find((x) => x.supplierId === s.id)?._count ?? 0,
          receivedValue: moneyText(mine.find((x) => x.kind === 'CHARGE')?._sum.amount),
          payments: sumMoney(
            mine.filter((x) => x.kind !== 'CHARGE').map((x) => moneyText(x._sum.amount)),
          ),
          outstanding: sumMoney(amounts),
          receivedInRange: moneyText(received.find((x) => x.supplierId === s.id)?._sum.total),
        };
      })
      .sort(
        (a, b) =>
          compareMoney(b.outstanding, a.outstanding) ||
          a.supplierName.localeCompare(b.supplierName),
      );
    return {
      range: r.range,
      currency: r.branch.currency,
      suppliers: rows,
      ordersByStatus: orders
        .map((o) => ({ status: o.status, count: o._count }))
        .sort((a, b) => a.status.localeCompare(b.status)),
      receiptsInRange: received.reduce((n, x) => n + x._count, 0),
      receivedInRange: sumMoney(received.map((x) => moneyText(x._sum.total))),
      paidInRange: moneyText(paid._sum.amount),
      outstanding: sumMoney(rows.map((x) => x.outstanding)),
      recentReceipts: recent.map((g) => ({
        id: g.id,
        supplierName: name.get(g.supplierId) ?? '',
        reference: g.reference,
        invoiceNumber: g.invoiceNumber,
        total: g.total.toFixed(2),
        outstanding: sumMoney(g.entries.map((e) => e.amount.toFixed(2))),
        createdAt: g.createdAt.toISOString(),
      })),
    };
  }
  // Company exposure is the signed CompanyLedgerEntry balance, the same figure the
  // companies module enforces credit against. Overdue amounts come from immutable
  // statements: the latest past-due statement's closing balance less payments recorded
  // after its period, never recomputed from current contract terms.
  private async companiesTx(
    tx: Tx,
    p: Principal,
    r: Resolved,
    q: ReportRangeInput,
  ): Promise<CompaniesReport> {
    const companies = await tx.company.findMany({
      where: { ...scope(p), deletedAt: null, id: q.companyId },
      include: {
        contracts: {
          where: { status: 'ACTIVE' },
          orderBy: [{ startDate: 'desc' }, { id: 'asc' }],
          take: 1,
        },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    const ids = companies.map((c) => c.id);
    const sums = await tx.companyLedgerEntry.groupBy({
      by: ['companyId', 'kind'],
      where: { ...scope(p), companyId: { in: ids } },
      _sum: { amount: true },
    });
    const inRange = await tx.companyLedgerEntry.groupBy({
      by: ['companyId'],
      where: { ...scope(p), companyId: { in: ids }, kind: 'CHARGE', createdAt: between(r.utc) },
      _count: true,
      _sum: { amount: true },
    });
    const today = new Date(localDate(new Date(), r.branch.timezone) + 'T00:00:00.000Z');
    const pastDue = await tx.companyStatement.findMany({
      where: { ...scope(p), companyId: { in: ids }, dueDate: { lt: today } },
      orderBy: [{ periodEnd: 'desc' }, { id: 'desc' }],
    });
    const overdue = new Map<string, string>();
    for (const s of pastDue) {
      if (overdue.has(s.companyId)) continue;
      const since = await tx.companyLedgerEntry.aggregate({
        where: {
          ...scope(p),
          companyId: s.companyId,
          kind: { not: 'CHARGE' },
          createdAt: { gte: addDays(s.periodEnd, 1) },
        },
        _sum: { amount: true },
      });
      overdue.set(
        s.companyId,
        maxMoney('0.00', sumMoney([s.closingBalance.toFixed(2), moneyText(since._sum.amount)])),
      );
    }
    const rows = companies
      .map<CompanyReportRow>((c) => {
        const mine = sums.filter((x) => x.companyId === c.id);
        const contract = c.contracts.at(0);
        const creditLimit = contract?.creditLimit.toFixed(2) ?? '0.00';
        const balance = sumMoney(mine.map((x) => moneyText(x._sum.amount)));
        const charged = inRange.find((x) => x.companyId === c.id);
        return {
          companyId: c.id,
          companyName: c.name,
          contractStatus: contract?.status ?? null,
          creditLimit,
          charged: moneyText(mine.find((x) => x.kind === 'CHARGE')?._sum.amount),
          paid: sumMoney(
            mine.filter((x) => x.kind !== 'CHARGE').map((x) => moneyText(x._sum.amount)),
          ),
          balance,
          available: availableCredit(creditLimit, balance),
          chargedInRange: moneyText(charged?._sum.amount),
          ordersInRange: charged?._count ?? 0,
          overdue: overdue.get(c.id) ?? '0.00',
        };
      })
      .sort(
        (a, b) => compareMoney(b.balance, a.balance) || a.companyName.localeCompare(b.companyName),
      );
    const statements = await tx.companyStatement.findMany({
      where: {
        ...scope(p),
        companyId: { in: ids },
        OR: [{ createdAt: between(r.utc) }, { dueDate: { lt: today } }],
      },
      include: { company: { select: { name: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
    });
    return {
      range: r.range,
      currency: r.branch.currency,
      companies: rows,
      totals: {
        companies: rows.length,
        exposure: sumMoney(rows.map((x) => x.balance)),
        creditLimit: sumMoney(rows.map((x) => x.creditLimit)),
        available: sumMoney(rows.map((x) => x.available)),
        overdue: sumMoney(rows.map((x) => x.overdue)),
        chargedInRange: sumMoney(rows.map((x) => x.chargedInRange)),
      },
      statements: statements.map((s) => ({
        id: s.id,
        companyName: s.company.name,
        number: s.number.toString(),
        periodStart: dateText(s.periodStart),
        periodEnd: dateText(s.periodEnd),
        dueDate: dateText(s.dueDate),
        closingBalance: s.closingBalance.toFixed(2),
        overdue: s.dueDate < today && (overdue.get(s.companyId) ?? '0.00') !== '0.00',
      })),
    };
  }
  overview(p: Principal, q: ReportRangeInput): Promise<DashboardOverview> {
    return this.run(async (tx) => {
      const r = await this.resolve(tx, p, q);
      const sales = await this.salesTx(tx, p, r);
      const stock = await this.stockRowsTx(tx, p, { search: '' });
      const openShifts = await tx.cashShift.count({ where: { ...scope(p), status: 'OPEN' } });
      const exposure = await tx.companyLedgerEntry.aggregate({
        where: scope(p),
        _sum: { amount: true },
      });
      const supplier = await tx.supplierEntry.aggregate({
        where: scope(p),
        _sum: { amount: true },
      });
      return {
        range: r.range,
        branchName: r.branch.name,
        currency: r.branch.currency,
        timezone: r.branch.timezone,
        sales,
        positions: stock.length,
        lowStock: stock.filter((x) => x.lowStock).length,
        negativeStock: stock.filter((x) => x.negative).length,
        openShifts,
        companyExposure: moneyText(exposure._sum.amount),
        supplierOutstanding: moneyText(supplier._sum.amount),
      };
    });
  }
  sales(p: Principal, q: ReportRangeInput) {
    return this.run(async (tx) => this.salesTx(tx, p, await this.resolve(tx, p, q)));
  }
  orders(p: Principal, q: ReportRangeInput) {
    return this.run(async (tx) => this.ordersTx(tx, p, await this.resolve(tx, p, q)));
  }
  products(p: Principal, q: ReportRangeInput) {
    return this.run(async (tx) => this.productsTx(tx, p, await this.resolve(tx, p, q)));
  }
  staff(p: Principal, q: ReportRangeInput) {
    return this.run(async (tx) => this.staffTx(tx, p, await this.resolve(tx, p, q)));
  }
  cash(p: Principal, q: ReportRangeInput) {
    return this.run(async (tx) => this.cashTx(tx, p, await this.resolve(tx, p, q)));
  }
  inventory(p: Principal, q: ReportRangeInput) {
    return this.run(async (tx) => this.inventoryTx(tx, p, await this.resolve(tx, p, q), q));
  }
  purchasing(p: Principal, q: ReportRangeInput) {
    return this.run(async (tx) => this.purchasingTx(tx, p, await this.resolve(tx, p, q), q));
  }
  companies(p: Principal, q: ReportRangeInput) {
    return this.run(async (tx) => this.companiesTx(tx, p, await this.resolve(tx, p, q), q));
  }
  // CSV exports serialize the same figures the JSON reports return, as text, unchanged.
  // An export that would exceed the row limit is refused rather than silently truncated.
  export(p: Principal, kind: ReportKind, q: ReportRangeInput) {
    return this.run(async (tx) => {
      const r = await this.resolve(tx, p, q);
      const col = (key: string, header = key) => ({ key, header });
      let columns: { key: string; header: string }[] = [];
      let rows: Record<string, unknown>[] = [];
      if (kind === 'sales') {
        columns = ['date', 'orderCount', 'grossSales', 'discounts', 'tax', 'total', 'netSales'].map(
          (k) => col(k),
        );
        rows = (await this.ordersTx(tx, p, r)).byDay as unknown as Record<string, unknown>[];
      } else if (kind === 'orders') {
        const where = this.settled(p, r);
        if ((await tx.order.count({ where })) > EXPORT_LIMIT)
          throw new BadRequestException(
            `Export exceeds ${EXPORT_LIMIT} rows; narrow the date range`,
          );
        const orders = await tx.order.findMany({
          where,
          select: {
            id: true,
            orderNumber: true,
            type: true,
            status: true,
            tableName: true,
            waiterName: true,
            subtotal: true,
            discount: true,
            tax: true,
            total: true,
            currency: true,
            createdAt: true,
            settlement: { select: { createdAt: true } },
          },
          orderBy: [{ settlement: { createdAt: 'asc' } }, { id: 'asc' }],
        });
        columns = [
          'id',
          'orderNumber',
          'type',
          'status',
          'tableName',
          'waiterName',
          'subtotal',
          'discount',
          'tax',
          'total',
          'currency',
          'createdAt',
          'settledAt',
        ].map((k) => col(k));
        rows = orders.map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber.toString(),
          type: o.type,
          status: o.status,
          tableName: o.tableName,
          waiterName: o.waiterName,
          subtotal: o.subtotal.toFixed(2),
          discount: o.discount.toFixed(2),
          tax: o.tax.toFixed(2),
          total: o.total.toFixed(2),
          currency: o.currency,
          createdAt: o.createdAt.toISOString(),
          settledAt: o.settlement?.createdAt.toISOString() ?? '',
        }));
      } else if (kind === 'products') {
        columns = ['productId', 'productName', 'categoryName', 'quantity', 'lines', 'sales'].map(
          (k) => col(k),
        );
        rows = (await this.productRowsTx(tx, p, r)) as unknown as Record<string, unknown>[];
      } else if (kind === 'staff') {
        const staff = await this.staffTx(tx, p, r);
        columns = [
          'role',
          'userId',
          'name',
          'orders',
          'sales',
          'averageTicket',
          'dineIn',
          'takeaway',
        ].map((k) => col(k));
        rows = [...staff.waiters, ...staff.cashiers] as unknown as Record<string, unknown>[];
      } else if (kind === 'cash') {
        columns = [
          'id',
          'cashierName',
          'terminalName',
          'status',
          'openedAt',
          'closedAt',
          'openingAmount',
          'cashIn',
          'cashOut',
          'cashPayments',
          'cashReversals',
          'expectedAmount',
          'closingAmount',
          'difference',
          'closingReason',
        ].map((k) => col(k));
        rows = (await this.cashTx(tx, p, r)).shifts as unknown as Record<string, unknown>[];
      } else if (kind === 'inventory') {
        columns = [
          'positionId',
          'itemId',
          'itemName',
          'sku',
          'warehouseId',
          'warehouseName',
          'unitCode',
          'quantity',
          'lowStockThreshold',
          'lowStock',
          'negative',
        ].map((k) => col(k));
        rows = (await this.stockRowsTx(tx, p, q)) as unknown as Record<string, unknown>[];
      } else if (kind === 'purchasing') {
        columns = [
          'supplierId',
          'supplierName',
          'receipts',
          'receivedValue',
          'payments',
          'outstanding',
          'receivedInRange',
        ].map((k) => col(k));
        rows = (await this.purchasingTx(tx, p, r, q)).suppliers as unknown as Record<
          string,
          unknown
        >[];
      } else {
        columns = [
          'companyId',
          'companyName',
          'contractStatus',
          'creditLimit',
          'charged',
          'paid',
          'balance',
          'available',
          'chargedInRange',
          'ordersInRange',
          'overdue',
        ].map((k) => col(k));
        rows = (await this.companiesTx(tx, p, r, q)).companies as unknown as Record<
          string,
          unknown
        >[];
      }
      return {
        filename: csvFilename(kind, r.range.fromDate, r.range.toDate),
        csv: csvDocument(columns, rows),
      };
    });
  }
}
