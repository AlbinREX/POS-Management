// Fiscal handoff service.
//
// FastFood Riza does not fiscalize. This service prepares finalized sale data from
// immutable records and tracks whether it has been delivered to EnterNet's F-LINK
// software. It never writes an order, payment, settlement or ledger row, so a provider
// failure cannot revert a PAID sale.
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@restaurant/database';
import type {
  FiscalHandoffRecord,
  FiscalHandoffState,
  FiscalOrderStatus,
  FiscalSalePayload,
  FiscalStatusSummary,
} from '@restaurant/shared-types';
import type { Principal } from '../auth/auth.service';
import { audit } from '../audit';
import { DatabaseService } from '../database.service';
import { inventoryScope as scope } from '../inventory/inventory.transactions';
import { buildFiscalPayload, correlationKeyFor, payloadFingerprint } from './fiscal-payload';
import { createFiscalProvider, type FiscalProvider } from './fiscal-provider';
import { canAttempt, isTerminal, nextState, summarize, unresolvedCount } from './fiscal-state';

type Tx = Prisma.TransactionClient;
const read = { isolationLevel: 'RepeatableRead' as const };
// AuditLog accepts only these context columns; a Principal also carries session and
// permission data that must never be spread into a database row.
const context = (p: Principal) => ({
  ...scope(p),
  userId: p.userId,
  terminalId: p.terminalId,
  requestId: p.requestId,
  ip: p.ip,
});

@Injectable()
export class FiscalService {
  private readonly provider: FiscalProvider = createFiscalProvider();
  constructor(private readonly db: DatabaseService) {}

  /** True only when an operator configured a provider whose transport exists. */
  get enabled() {
    return this.provider.ready;
  }

  /**
   * Build the payload for a settled order from stored snapshots.
   *
   * Read-only and deterministic: the same settlement always yields the same payload, so
   * a retry can be proven identical to the first attempt.
   */
  async payload(p: Principal, orderId: string): Promise<FiscalSalePayload> {
    return this.db.client.$transaction(async (tx) => this.payloadTx(tx, p, orderId), read);
  }

  private async payloadTx(tx: Tx, p: Principal, orderId: string): Promise<FiscalSalePayload> {
    const settlement = await tx.orderSettlement.findFirst({
      where: { ...scope(p), orderId },
      include: {
        cashier: { include: { user: true } },
        order: { include: { items: { include: { modifiers: true } }, payments: true } },
      },
    });
    // A settlement exists only for a PAID order, so its absence means the sale is not
    // eligible for handoff. A foreign branch's settlement is invisible here.
    if (!settlement) throw new NotFoundException('No settled sale for this order');
    const branch = await tx.branch.findFirstOrThrow({
      where: { id: p.branchId, organizationId: p.organizationId },
      include: { organization: true },
    });
    return buildFiscalPayload({
      settlement: {
        orderId: settlement.orderId,
        cashierId: settlement.cashierId,
        createdAt: settlement.createdAt,
        currency: settlement.currency,
      },
      order: {
        id: settlement.order.id,
        orderNumber: settlement.order.orderNumber,
        type: settlement.order.type,
        status: settlement.order.status,
        currency: settlement.order.currency,
        subtotal: settlement.order.subtotal.toFixed(2),
        discount: settlement.order.discount.toFixed(2),
        tax: settlement.order.tax.toFixed(2),
        total: settlement.order.total.toFixed(2),
        tableName: settlement.order.tableName,
        waiterName: settlement.order.waiterName,
      },
      items: settlement.order.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.productName,
        sku: item.sku,
        categoryName: item.categoryName,
        unitPrice: item.unitPrice.toFixed(2),
        taxRate: item.taxRate.toFixed(2),
        taxMode: item.taxMode,
        quantity: item.quantity,
        subtotal: item.subtotal.toFixed(2),
        discount: item.discount.toFixed(2),
        tax: item.tax.toFixed(2),
        total: item.total.toFixed(2),
        voidedAt: item.voidedAt,
        modifiers: item.modifiers.map((m) => ({
          groupName: m.groupName,
          name: m.name,
          priceAdjustment: m.priceAdjustment.toFixed(2),
        })),
      })),
      payments: settlement.order.payments.map((payment) => ({
        method: payment.method,
        amount: payment.amount.toFixed(2),
        transactionReference: payment.transactionReference,
        companyId: payment.companyId,
      })),
      seller: {
        organizationId: branch.organizationId,
        organizationName: branch.organization.name,
        branchId: branch.id,
        branchCode: branch.code,
        branchName: branch.name,
        timezone: branch.timezone,
      },
      cashier: { userId: settlement.cashierId, name: settlement.cashier.user.name },
    });
  }

  private record(row: {
    id: string;
    orderId: string;
    correlationKey: string;
    provider: string;
    state: string;
    attempts: number;
    providerReference: string | null;
    lastError: string | null;
    lastAttemptAt: Date | null;
    confirmedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    settlement: {
      createdAt: Date;
      amount: Prisma.Decimal;
      currency: string;
      order: { orderNumber: bigint };
    };
  }): FiscalHandoffRecord {
    return {
      id: row.id,
      settlementId: row.orderId,
      orderId: row.orderId,
      orderNumber: row.settlement.order.orderNumber.toString(),
      correlationKey: row.correlationKey,
      state: row.state as FiscalHandoffState,
      provider: row.provider,
      attempts: row.attempts,
      lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
      confirmedAt: row.confirmedAt?.toISOString() ?? null,
      providerReference: row.providerReference,
      lastError: row.lastError,
      settledAt: row.settlement.createdAt.toISOString(),
      total: row.settlement.amount.toFixed(2),
      currency: row.settlement.currency,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private readonly include = {
    settlement: { include: { order: { select: { orderNumber: true } } } },
  };

  /** Unresolved and recent handoffs for the operator view, branch-scoped. */
  async list(p: Principal, state?: FiscalHandoffState): Promise<FiscalHandoffRecord[]> {
    const rows = await this.db.client.fiscalHandoff.findMany({
      where: { ...scope(p), state },
      include: this.include,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    return rows.map((row) => this.record(row));
  }

  async summary(p: Principal): Promise<FiscalStatusSummary> {
    const rows = await this.db.client.fiscalHandoff.findMany({
      where: scope(p),
      select: { state: true, createdAt: true },
    });
    const counts = summarize(rows.map((r) => r.state as FiscalHandoffState));
    const unresolved = rows
      .filter((r) => r.state !== 'CONFIRMED' && r.state !== 'SENT')
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return {
      enabled: this.provider.ready,
      provider: this.provider.name === 'unconfigured' ? null : this.provider.name,
      // True until EnterNet supplies the F-LINK specification and a transport exists.
      transportPending: !this.provider.ready,
      counts,
      unresolved: unresolvedCount(counts),
      oldestUnresolvedAt: unresolved.at(0)?.createdAt.toISOString() ?? null,
    };
  }

  /** Compact state for one order, for payment and order detail. */
  async orderStatus(p: Principal, orderId: string): Promise<FiscalOrderStatus> {
    const row = await this.db.client.fiscalHandoff.findFirst({ where: { ...scope(p), orderId } });
    if (!row)
      return {
        settlementId: null,
        state: null,
        providerReference: null,
        attempts: 0,
        lastError: null,
      };
    return {
      settlementId: row.orderId,
      state: row.state as FiscalHandoffState,
      providerReference: row.providerReference,
      attempts: row.attempts,
      lastError: row.lastError,
    };
  }

  /**
   * Register a settled sale for handoff, idempotently.
   *
   * Called after the payment transaction has committed, never inside it: a fiscal row
   * must never be able to roll back a settlement. Registering twice returns the existing
   * row rather than creating a second delivery identity.
   */
  async register(p: Principal, orderId: string): Promise<FiscalHandoffRecord> {
    await this.payload(p, orderId); // Proves the sale is settled and in this branch.
    const correlationKey = correlationKeyFor(orderId);
    const existing = await this.db.client.fiscalHandoff.findFirst({
      where: { ...scope(p), orderId },
      include: this.include,
    });
    if (existing) return this.record(existing);
    const created = await this.db.client.fiscalHandoff.create({
      data: {
        ...scope(p),
        orderId,
        correlationKey,
        provider: this.provider.name,
        state: 'PENDING',
      },
      include: this.include,
    });
    return this.record(created);
  }

  /**
   * Attempt delivery of one settled sale.
   *
   * The provider call happens outside any database transaction, so a slow or unreachable
   * device cannot hold locks on financial tables. A confirmed handoff is never re-sent.
   */
  async attempt(p: Principal, orderId: string, reason: 'automatic' | 'operator') {
    const payload = await this.payload(p, orderId);
    const row =
      (await this.db.client.fiscalHandoff.findFirst({ where: { ...scope(p), orderId } })) ??
      (await this.db.client.fiscalHandoff.create({
        data: {
          ...scope(p),
          orderId,
          correlationKey: payload.correlationKey,
          provider: this.provider.name,
          state: 'PENDING',
        },
      }));
    if (isTerminal(row.state as FiscalHandoffState))
      throw new ConflictException('This sale was already handed off');
    if (!canAttempt(row.state as FiscalHandoffState))
      throw new ConflictException('A handoff attempt is already in progress');

    const fingerprint = payloadFingerprint(payload);
    // A retry must send exactly what the first attempt sent. The payload is rebuilt from
    // immutable snapshots, so a changed fingerprint would mean history moved.
    if (row.payloadFingerprint && row.payloadFingerprint !== fingerprint)
      throw new ConflictException('Sale data changed since the first handoff attempt');

    const result = await this.provider.deliver(payload);
    const state = nextState(result);
    const updated = await this.db.client.fiscalHandoff.update({
      where: { id: row.id },
      data: {
        state,
        attempts: { increment: 1 },
        payloadFingerprint: fingerprint,
        lastAttemptAt: new Date(),
        confirmedAt: state === 'CONFIRMED' ? new Date() : null,
        providerReference: result.status === 'confirmed' ? result.providerReference : null,
        lastError: result.status === 'failed' ? result.error.slice(0, 500) : null,
      },
      include: this.include,
    });
    // Every attempt is audited, including automatic ones, so a delivery history exists
    // independently of the handoff row itself.
    await audit(
      this.db.client,
      context(p),
      reason === 'operator' ? 'fiscal.handoff_retried' : 'fiscal.handoff_attempted',
      'FiscalHandoff',
      updated.id,
      undefined,
      {
        orderId,
        state,
        attempts: updated.attempts,
        provider: updated.provider,
        correlationKey: updated.correlationKey,
      },
    );
    return this.record(updated);
  }
}
