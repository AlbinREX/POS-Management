import { freezeInventoryPlan, consumeInventoryPlan } from '../inventory/inventory.transactions';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@restaurant/database';
import type { CashShiftRecord, PaymentSummary, PermissionKey } from '@restaurant/shared-types';
import type {
  paymentCollectSchema,
  paymentReverseSchema,
  paymentZeroSchema,
  shiftOpenSchema,
  shiftCommandSchema,
  paymentPageSchema,
  layoutChangesSchema,
} from '@restaurant/validation';
import type { z } from 'zod';
import type { Principal } from '../auth/auth.service';
import { DatabaseService } from '../database.service';
import { OrdersService, hash, record } from '../orders/orders.service';
import { audit } from '../audit';
import { cashChange, cents, money, unitCents } from './payment-money';

const scope = (p: Principal) => ({ branchId: p.branchId, organizationId: p.organizationId });
const options = { isolationLevel: 'Serializable' as const, timeout: 15000 };
const include = {
  reversals: { orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }] },
  allocations: { orderBy: [{ itemId: 'asc' as const }, { unitNumber: 'asc' as const }] },
};
type Tx = Prisma.TransactionClient;
type Page = z.infer<typeof paymentPageSchema>;
const json = (v: unknown): Prisma.InputJsonObject => JSON.parse(JSON.stringify(v));

@Injectable()
export class PaymentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly orders: OrdersService,
  ) {}
  private require(p: Principal, key: PermissionKey) {
    if (!p.permissions.includes(key))
      throw new ForbiddenException('Required payment permission is missing');
  }
  private async replay(tx: Tx, p: Principal, commandId: string, requestHash: string) {
    const event = await tx.paymentEvent.findFirst({ where: { ...scope(p), commandId } });
    if (!event) return null;
    if (event.userId !== p.userId || event.requestHash !== requestHash)
      throw new ConflictException('Payment command ID was already used');
    return event.response;
  }
  private async event(
    tx: Tx,
    p: Principal,
    commandId: string,
    requestHash: string,
    action: string,
    response: Prisma.InputJsonObject,
    target: { orderId?: string; shiftId?: string },
  ) {
    const revision = await tx.paymentRevision.upsert({
      where: { branchId: p.branchId },
      create: { ...scope(p), revision: 1n },
      update: { revision: { increment: 1n } },
    });
    await audit(
      tx,
      { ...scope(p), userId: p.userId, terminalId: p.terminalId, requestId: p.requestId, ip: p.ip },
      action,
      target.orderId ? 'OrderPayment' : 'CashShift',
      target.orderId ?? target.shiftId,
      undefined,
      response,
    );
    await tx.paymentEvent.create({
      data: {
        ...scope(p),
        ...target,
        userId: p.userId,
        commandId,
        requestHash,
        action,
        response,
        revision: revision.revision,
      },
    });
    return response;
  }
  async summary(p: Principal, id: string) {
    return this.db.client.$transaction((tx) => this.summaryTx(tx, p, id), {
      isolationLevel: 'RepeatableRead',
    });
  }
  private async summaryTx(tx: Tx, p: Principal, id: string): Promise<PaymentSummary> {
    const row = await this.orders.row(tx, p, id);
    const payments = await tx.payment.findMany({
      where: { ...scope(p), orderId: id },
      include,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const bill = await tx.orderBill.findFirst({ where: { ...scope(p), orderId: id } });
    const settlement = await tx.orderSettlement.findFirst({ where: { ...scope(p), orderId: id } });
    let collected = 0n,
      cancelled = 0n,
      refunded = 0n;
    const taken = new Set<string>();
    for (const payment of payments) {
      collected += cents(payment.amount.toFixed(2));
      for (const reversal of payment.reversals) {
        if (reversal.kind === 'CANCELLATION') cancelled += cents(reversal.amount.toFixed(2));
        else refunded += cents(reversal.amount.toFixed(2));
      }
      if (!payment.reversals.some((r) => r.kind === 'CANCELLATION'))
        for (const a of payment.allocations) taken.add(`${a.itemId}:${a.unitNumber}`);
    }
    return {
      order: record(row),
      mode: bill?.mode ?? null,
      collected: money(collected),
      cancelled: money(cancelled),
      refunded: money(refunded),
      netReceipts: money(collected - cancelled - refunded),
      due: settlement ? '0.00' : money(cents(row.total.toFixed(2)) - collected + cancelled),
      settledAt: settlement?.createdAt.toISOString() ?? null,
      units: row.items
        .filter((i) => !i.voidedAt)
        .map((i) => {
          let remaining = 0,
            amount = 0n;
          for (let unit = 1; unit <= i.quantity; unit++)
            if (!taken.has(`${i.id}:${unit}`)) {
              remaining++;
              amount += unitCents(i.total.toFixed(2), i.quantity, unit);
            }
          return { itemId: i.id, remaining, remainingAmount: money(amount) };
        }),
      payments: payments.map((r) => ({
        id: r.id,
        orderId: r.orderId,
        cashierId: r.cashierId,
        method: r.method,
        amount: r.amount.toFixed(2),
        tendered: r.tendered?.toFixed(2) ?? null,
        change: r.change?.toFixed(2) ?? null,
        shiftId: r.shiftId,
        transactionReference: r.transactionReference,
        createdAt: r.createdAt.toISOString(),
        allocations: r.allocations.map((a) => ({
          itemId: a.itemId,
          unitNumber: a.unitNumber,
          amount: a.amount.toFixed(2),
        })),
        reversals: r.reversals.map((v) => ({
          id: v.id,
          kind: v.kind,
          amount: v.amount.toFixed(2),
          reason: v.reason,
          cashierId: v.cashierId,
          shiftId: v.shiftId,
          transactionReference: v.transactionReference,
          createdAt: v.createdAt.toISOString(),
        })),
      })),
    };
  }
  private async expected(tx: Tx, p: Principal, shiftId: string) {
    const sum = await tx.cashMovement.aggregate({
      where: { ...scope(p), shiftId },
      _sum: { amount: true },
    });
    return sum._sum.amount?.toFixed(2) ?? '0.00';
  }
  private async shift(tx: Tx, p: Principal, id: string, own = false) {
    const s = await tx.cashShift.findFirst({
      where: { ...scope(p), id },
      include: { terminal: true, cashier: { include: { user: true } } },
    });
    if (!s) throw new NotFoundException('Cash shift not found');
    if (
      own &&
      (s.cashierId !== p.userId ||
        s.status !== 'OPEN' ||
        !s.terminal.active ||
        s.terminal.deletedAt ||
        s.terminal.type !== 'POS' ||
        (p.terminalId && p.terminalId !== s.terminalId))
    )
      throw new ConflictException('Use your own open shift on an active POS terminal');
    return s;
  }
  private async shiftRecord(tx: Tx, p: Principal, id: string): Promise<CashShiftRecord> {
    const s = await this.shift(tx, p, id);
    return {
      id: s.id,
      cashierId: s.cashierId,
      cashierName: s.cashier.user.name,
      terminalId: s.terminalId,
      terminalName: s.terminal.name,
      currency: s.currency,
      status: s.status,
      version: s.version,
      openingAmount: s.openingAmount.toFixed(2),
      closingAmount: s.closingAmount?.toFixed(2) ?? null,
      expectedAmount: s.expectedAmount?.toFixed(2) ?? (await this.expected(tx, p, id)),
      difference: s.difference?.toFixed(2) ?? null,
      closingReason: s.closingReason,
      openedAt: s.openedAt.toISOString(),
      closedAt: s.closedAt?.toISOString() ?? null,
    };
  }
  private async movement(
    tx: Tx,
    p: Principal,
    shiftId: string,
    amount: string,
    kind: 'PAYMENT' | 'REVERSAL' | 'CASH_IN' | 'CASH_OUT',
    reason: string,
    source: { paymentId?: string; reversalId?: string } = {},
  ) {
    const shift = await this.shift(tx, p, shiftId, true);
    const expected = cents(await this.expected(tx, p, shiftId)) + cents(amount);
    if (expected < 0n) throw new ConflictException('Insufficient expected cash in drawer');
    money(expected); // Reject overflow before persisting.
    await tx.cashMovement.create({
      data: { ...scope(p), shiftId, cashierId: p.userId, amount, kind, reason, ...source },
    });
    await tx.cashShift.update({
      where: { ...scope(p), id: shiftId, version: shift.version },
      data: { version: { increment: 1 } },
    });
  }
  private async settle(tx: Tx, p: Principal, id: string) {
    const row = await this.orders.row(tx, p, id);
    await tx.orderSettlement.create({
      data: {
        ...scope(p),
        orderId: id,
        amount: row.total,
        currency: row.currency,
        cashierId: p.userId,
      },
    });
    await consumeInventoryPlan(tx, p, id);
    await tx.order.update({
      where: { ...scope(p), id, version: row.version },
      data: { status: 'PAID', version: { increment: 1 } },
    });
    if (row.tableId) await this.orders.tableStatus(tx, p, row.tableId, 'FREE');
    await this.orders.event(
      tx,
      p,
      randomUUID(),
      hash({ settlement: id }),
      'order.settled',
      record(await this.orders.row(tx, p, id)),
      record(row),
    );
  }
  collect(p: Principal, id: string, input: z.infer<typeof paymentCollectSchema>) {
    const requestHash = hash({ collect: id, input });
    return this.db.client.$transaction(async (tx) => {
      const replay = await this.replay(tx, p, input.commandId, requestHash);
      if (replay) return replay;
      const summary = await this.summaryTx(tx, p, id),
        order = summary.order;
      if (
        order.status !== 'WAITING_PAYMENT' ||
        order.version !== input.version ||
        cents(summary.due) <= 0n ||
        !order.items.some((i) => !i.voidedAt)
      )
        throw new ConflictException('Reload an unsettled order waiting for payment');
      if (summary.payments.length + input.tenders.length > 200)
        throw new ConflictException('Payment history limit reached');
      if (summary.mode && summary.mode !== input.mode)
        throw new ConflictException('Bill split mode is immutable');
      if (
        input.mode === 'ITEMS' &&
        order.items.reduce((n, i) => n + (i.voidedAt ? 0 : i.quantity), 0) > 2000
      )
        throw new ConflictException('Item split supports at most 2000 units per order');
      if (!summary.mode)
        await tx.orderBill.create({ data: { ...scope(p), orderId: id, mode: input.mode } });
      const taken = new Set(
        summary.payments
          .filter((v) => !v.reversals.some((r) => r.kind === 'CANCELLATION'))
          .flatMap((v) => v.allocations.map((a) => `${a.itemId}:${a.unitNumber}`)),
      );
      await freezeInventoryPlan(tx, p, id);
      let collected = 0n;
      const receipts = [];
      for (const tender of input.tenders) {
        const allocations: { itemId: string; unitNumber: number; amount: string }[] = [];
        let amount = input.mode === 'AMOUNT' ? cents(tender.amount!) : 0n;
        if (input.mode === 'ITEMS')
          for (const selected of tender.items!) {
            const item = order.items.find((i) => i.id === selected.itemId && !i.voidedAt);
            if (!item) throw new NotFoundException('Active item not found on this order');
            let assigned = 0;
            for (let unit = 1; unit <= item.quantity && assigned < selected.quantity; unit++) {
              const key = `${item.id}:${unit}`;
              if (taken.has(key)) continue;
              const value = unitCents(item.total, item.quantity, unit);
              allocations.push({ itemId: item.id, unitNumber: unit, amount: money(value) });
              amount += value;
              taken.add(key);
              assigned++;
            }
            if (assigned !== selected.quantity)
              throw new ConflictException('Selected item units are already paid');
          }
        collected += amount;
        if (amount <= 0n || collected > cents(summary.due))
          throw new ConflictException('Payment exceeds remaining balance or is zero');
        let change: string | null = null;
        if (tender.method === 'CASH') {
          const shift = await this.shift(tx, p, tender.shiftId!, true);
          if (shift.currency !== order.currency)
            throw new ConflictException('Cash shift currency does not match order');
          try {
            change = cashChange(money(amount), tender.tendered!);
          } catch {
            throw new ConflictException('Tendered cash is less than payment');
          }
        }
        const receipt = await tx.payment.create({
          data: {
            ...scope(p),
            orderId: id,
            cashierId: p.userId,
            method: tender.method,
            amount: money(amount),
            tendered: tender.tendered,
            change,
            shiftId: tender.shiftId,
            transactionReference: tender.transactionReference,
          },
        });
        if (allocations.length)
          await tx.paymentAllocation.createMany({
            data: allocations.map((a) => ({
              ...scope(p),
              ...a,
              paymentId: receipt.id,
              orderId: id,
            })),
          });
        if (tender.method === 'CASH')
          await this.movement(
            tx,
            p,
            tender.shiftId!,
            money(amount),
            'PAYMENT',
            'Cash payment received',
            { paymentId: receipt.id },
          );
        receipts.push({
          id: receipt.id,
          method: receipt.method,
          amount: receipt.amount.toFixed(2),
          tendered: receipt.tendered?.toFixed(2) ?? null,
          change,
          shiftId: receipt.shiftId,
          transactionReference: receipt.transactionReference,
        });
      }
      const settled = collected === cents(summary.due);
      if (settled) await this.settle(tx, p, id);
      else {
        await tx.order.update({
          where: { ...scope(p), id, version: input.version },
          data: { version: { increment: 1 } },
        });
        await this.orders.event(
          tx,
          p,
          randomUUID(),
          requestHash,
          'order.payment_received',
          record(await this.orders.row(tx, p, id)),
          order,
        );
      }
      return this.event(
        tx,
        p,
        input.commandId,
        requestHash,
        'payment.collected',
        json({
          orderId: id,
          payments: receipts,
          settled,
          due: money(cents(summary.due) - collected),
        }),
        { orderId: id },
      );
    }, options);
  }
  settleZero(p: Principal, id: string, input: z.infer<typeof paymentZeroSchema>) {
    const requestHash = hash({ zero: id, input });
    return this.db.client.$transaction(async (tx) => {
      const replay = await this.replay(tx, p, input.commandId, requestHash);
      if (replay) return replay;
      const s = await this.summaryTx(tx, p, id);
      if (
        s.order.status !== 'WAITING_PAYMENT' ||
        s.order.version !== input.version ||
        s.order.total !== '0.00' ||
        !s.order.items.some((i) => !i.voidedAt) ||
        s.payments.length
      )
        throw new ConflictException(
          'Only a nonempty zero-total waiting order can settle without payment',
        );
      await tx.orderBill.create({ data: { ...scope(p), orderId: id, mode: 'AMOUNT' } });
      await this.settle(tx, p, id);
      return this.event(
        tx,
        p,
        input.commandId,
        requestHash,
        'payment.zero_settled',
        { orderId: id, settled: true, amount: '0.00' },
        { orderId: id },
      );
    }, options);
  }
  reverse(p: Principal, id: string, input: z.infer<typeof paymentReverseSchema>) {
    this.require(p, input.kind === 'CANCELLATION' ? 'payment.cancel' : 'payment.refund');
    const requestHash = hash({ reverse: id, input });
    return this.db.client.$transaction(async (tx) => {
      const replay = await this.replay(tx, p, input.commandId, requestHash);
      if (replay) return replay;
      const payment = await tx.payment.findFirst({ where: { ...scope(p), id }, include });
      if (!payment) throw new NotFoundException('Payment not found');
      const order = await this.orders.row(tx, p, payment.orderId);
      if (
        input.kind === 'CANCELLATION'
          ? order.status !== 'WAITING_PAYMENT' ||
            payment.reversals.length > 0 ||
            input.amount !== payment.amount.toFixed(2)
          : order.status !== 'PAID'
      )
        throw new ConflictException(
          'Cancel an unsettled payment in full, or refund a settled payment',
        );
      const reversed = payment.reversals.reduce((n, r) => n + cents(r.amount.toFixed(2)), 0n);
      if (
        cents(input.amount) + reversed > cents(payment.amount.toFixed(2)) ||
        payment.reversals.length >= 100
      )
        throw new ConflictException('Reversal exceeds original payment or history limit');
      if (
        payment.method === 'CARD'
          ? !input.transactionReference || input.shiftId !== undefined
          : !input.shiftId || input.transactionReference !== undefined
      )
        throw new ConflictException(
          'Use original method: cash needs a shift; card needs external reversal confirmation',
        );
      if (payment.method === 'CASH') {
        const shift = await this.shift(tx, p, input.shiftId!, true);
        if (shift.currency !== order.currency)
          throw new ConflictException('Shift currency does not match payment');
      }
      const reversal = await tx.paymentReversal.create({
        data: {
          ...scope(p),
          paymentId: id,
          cashierId: p.userId,
          kind: input.kind,
          amount: input.amount,
          reason: input.reason,
          shiftId: input.shiftId,
          transactionReference: input.transactionReference,
        },
      });
      if (payment.method === 'CASH')
        await this.movement(
          tx,
          p,
          input.shiftId!,
          money(-cents(input.amount)),
          'REVERSAL',
          input.reason,
          { reversalId: reversal.id },
        );
      if (input.kind === 'CANCELLATION') {
        await tx.order.update({
          where: { ...scope(p), id: order.id, version: order.version },
          data: { version: { increment: 1 } },
        });
        await this.orders.event(
          tx,
          p,
          randomUUID(),
          requestHash,
          'order.payment_cancelled',
          record(await this.orders.row(tx, p, order.id)),
          record(order),
        );
      }
      return this.event(
        tx,
        p,
        input.commandId,
        requestHash,
        input.kind === 'CANCELLATION' ? 'payment.cancelled' : 'payment.refunded',
        json({
          id: reversal.id,
          paymentId: id,
          orderId: order.id,
          kind: input.kind,
          amount: input.amount,
          reason: input.reason,
          shiftId: reversal.shiftId,
          transactionReference: reversal.transactionReference,
        }),
        { orderId: order.id },
      );
    }, options);
  }
  terminals(p: Principal, q: Page) {
    return this.db.client.terminal.findMany({
      where: {
        ...scope(p),
        type: 'POS',
        active: true,
        deletedAt: null,
        ...(p.terminalId ? { id: p.terminalId } : {}),
      },
      select: { id: true, name: true },
      orderBy: { id: 'asc' },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    });
  }
  shifts(p: Principal, q: Page) {
    return this.db.client.$transaction(
      async (tx) => {
        const rows = await tx.cashShift.findMany({
          where: scope(p),
          select: { id: true },
          orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
          skip: (q.page - 1) * q.limit,
          take: q.limit + 1,
        });
        const items = [];
        for (const r of rows.slice(0, q.limit)) items.push(await this.shiftRecord(tx, p, r.id));
        const current = await tx.cashShift.findFirst({
          where: { ...scope(p), cashierId: p.userId, status: 'OPEN' },
          select: { id: true },
        });
        return {
          items,
          current: current ? await this.shiftRecord(tx, p, current.id) : null,
          hasMore: rows.length > q.limit,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  shiftDetail(p: Principal, id: string, q: Page) {
    return this.db.client.$transaction(
      async (tx) => {
        const shift = await this.shiftRecord(tx, p, id);
        const rows = await tx.cashMovement.findMany({
          where: { ...scope(p), shiftId: id },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (q.page - 1) * q.limit,
          take: q.limit + 1,
        });
        return {
          shift,
          movements: rows.slice(0, q.limit).map((m) => ({
            id: m.id,
            kind: m.kind,
            amount: m.amount.toFixed(2),
            reason: m.reason,
            paymentId: m.paymentId,
            reversalId: m.reversalId,
            createdAt: m.createdAt.toISOString(),
          })),
          hasMore: rows.length > q.limit,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  open(p: Principal, input: z.infer<typeof shiftOpenSchema>) {
    const requestHash = hash({ open: input });
    return this.db.client.$transaction(async (tx) => {
      const replay = await this.replay(tx, p, input.commandId, requestHash);
      if (replay) return replay;
      const terminal = await tx.terminal.findFirst({
        where: { ...scope(p), id: input.terminalId, active: true, deletedAt: null, type: 'POS' },
        include: { branch: true },
      });
      if (!terminal || (p.terminalId && p.terminalId !== terminal.id))
        throw new NotFoundException('Available POS terminal not found');
      const shift = await tx.cashShift.create({
        data: {
          ...scope(p),
          terminalId: terminal.id,
          cashierId: p.userId,
          openingAmount: input.openingAmount,
          currency: terminal.branch.currency,
        },
      });
      await tx.cashMovement.create({
        data: {
          ...scope(p),
          shiftId: shift.id,
          cashierId: p.userId,
          kind: 'OPENING',
          amount: input.openingAmount,
          reason: 'Opening cash count',
        },
      });
      return this.event(
        tx,
        p,
        input.commandId,
        requestHash,
        'cash.shift.opened',
        json(await this.shiftRecord(tx, p, shift.id)),
        { shiftId: shift.id },
      );
    }, options);
  }
  shiftCommand(p: Principal, id: string, input: z.infer<typeof shiftCommandSchema>) {
    if (input.action !== 'close') this.require(p, 'cash.movement.manage');
    const requestHash = hash({ shift: id, input });
    return this.db.client.$transaction(async (tx) => {
      const replay = await this.replay(tx, p, input.commandId, requestHash);
      if (replay) return replay;
      const shift = await this.shift(tx, p, id, true);
      if (shift.version !== input.version)
        throw new ConflictException('Shift changed. Reload before saving');
      if (input.action === 'close') {
        const expected = await this.expected(tx, p, id),
          difference = money(cents(input.closingAmount) - cents(expected));
        if (difference !== '0.00' && !input.reason)
          throw new ConflictException('Explain the cash count difference');
        await tx.cashShift.update({
          where: { ...scope(p), id, version: input.version },
          data: {
            status: 'CLOSED',
            closedAt: new Date(),
            closingAmount: input.closingAmount,
            expectedAmount: expected,
            difference,
            closingReason: input.reason,
            version: { increment: 1 },
          },
        });
      } else
        await this.movement(
          tx,
          p,
          id,
          input.action === 'cash_out' ? money(-cents(input.amount)) : input.amount,
          input.action === 'cash_out' ? 'CASH_OUT' : 'CASH_IN',
          input.reason,
        );
      return this.event(
        tx,
        p,
        input.commandId,
        requestHash,
        'cash.shift.' + input.action,
        json(await this.shiftRecord(tx, p, id)),
        { shiftId: id },
      );
    }, options);
  }
  async changes(p: Principal, q: z.infer<typeof layoutChangesSchema>, orderId?: string) {
    if (orderId) await this.orders.get(p, orderId);
    const rows = await this.db.client.paymentEvent.findMany({
      where: {
        ...scope(p),
        orderId,
        revision: { gt: BigInt(q.after) },
        ...(orderId ? {} : { orderId: { not: null } }),
      },
      orderBy: { revision: 'asc' },
      take: q.limit + 1,
    });
    const events = rows.slice(0, q.limit).map((e) => ({
      id: e.id,
      orderId: e.orderId,
      action: e.action,
      revision: e.revision.toString(),
      createdAt: e.createdAt.toISOString(),
      ...(orderId ? { snapshot: e.response } : {}),
    }));
    return { events, cursor: events.at(-1)?.revision ?? q.after, hasMore: rows.length > q.limit };
  }
}
