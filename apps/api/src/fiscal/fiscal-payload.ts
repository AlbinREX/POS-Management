// Deterministic fiscal sale payload construction.
//
// Pure: no database, no clock, no I/O. Given the immutable settlement, order, line and
// payment snapshots this POS already stores, it produces the same payload every time,
// which is what makes a retry safe to compare against an earlier attempt.
//
// This builds *our* payload, not an F-LINK payload. The provider format is unknown, so
// the adapter translates this into whatever EnterNet specifies once that specification
// exists. No field here is invented for fiscal purposes, and nothing is recomputed: tax
// figures are the ones the POS already recorded at sale time.
import { BadRequestException } from '@nestjs/common';
import type {
  FiscalSaleLine,
  FiscalSalePayload,
  FiscalSaleTender,
  FiscalTaxLine,
} from '@restaurant/shared-types';
import { cents, money } from '../payments/payment-money';

/** Source shapes, mirroring the stored columns rather than any provider contract. */
export interface PayloadSource {
  settlement: { orderId: string; cashierId: string; createdAt: Date; currency: string };
  order: {
    id: string;
    orderNumber: bigint;
    type: 'DINE_IN' | 'TAKEAWAY';
    status: string;
    currency: string;
    subtotal: string;
    discount: string;
    tax: string;
    total: string;
    tableName: string | null;
    waiterName: string | null;
  };
  items: {
    id: string;
    productId: string;
    productName: string;
    sku: string;
    categoryName: string;
    unitPrice: string;
    taxRate: string;
    taxMode: 'INCLUSIVE' | 'EXCLUSIVE';
    quantity: number;
    subtotal: string;
    discount: string;
    tax: string;
    total: string;
    voidedAt: Date | null;
    modifiers: { groupName: string; name: string; priceAdjustment: string }[];
  }[];
  payments: {
    method: 'CASH' | 'CARD' | 'COMPANY_ACCOUNT';
    amount: string;
    transactionReference: string | null;
    companyId: string | null;
  }[];
  seller: {
    organizationId: string;
    organizationName: string;
    branchId: string;
    branchCode: string;
    branchName: string;
    timezone: string;
  };
  cashier: { userId: string; name: string };
}

/**
 * Correlation key for one settlement.
 *
 * A settlement has exactly one order, and `OrderSettlement.orderId` is its primary key,
 * so the order id is already a natural idempotency key. Prefixing it keeps the value
 * self-describing in provider logs and makes accidental reuse across systems obvious.
 */
export const correlationKeyFor = (orderId: string) => `riza-settlement:${orderId}`;

/**
 * Tax breakdown grouped by the rate and mode recorded on each line.
 *
 * This aggregates figures the POS already stored; it does not apply any tax rule. Kosovo
 * tax treatment is EnterNet's responsibility, and if their specification requires a
 * different grouping the adapter maps it from these same source figures.
 */
function taxBreakdown(lines: FiscalSaleLine[]): FiscalTaxLine[] {
  const groups = new Map<
    string,
    { rate: string; mode: FiscalTaxLine['taxMode']; net: bigint; tax: bigint; gross: bigint }
  >();
  for (const line of lines) {
    const key = `${line.taxRate}:${line.taxMode}`;
    const group = groups.get(key) ?? {
      rate: line.taxRate,
      mode: line.taxMode,
      net: 0n,
      tax: 0n,
      gross: 0n,
    };
    const total = cents(line.total);
    const tax = cents(line.tax);
    group.tax += tax;
    group.gross += total;
    // Net is the recorded total less the recorded tax for an inclusive price, and the
    // recorded total itself when tax sits on top.
    group.net += line.taxMode === 'INCLUSIVE' ? total - tax : total;
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((g) => ({
      taxRate: g.rate,
      taxMode: g.mode,
      net: money(g.net),
      tax: money(g.tax),
      gross: money(g.gross),
    }))
    .sort((a, b) => a.taxRate.localeCompare(b.taxRate) || a.taxMode.localeCompare(b.taxMode));
}

/**
 * Build the payload for one settled sale.
 *
 * Only a settled order is eligible. A settlement row exists if and only if the order is
 * PAID, which the database enforces, but the status is checked explicitly so a caller
 * cannot hand off an order that never completed.
 */
export function buildFiscalPayload(source: PayloadSource): FiscalSalePayload {
  if (source.order.status !== 'PAID')
    throw new BadRequestException('Only a settled order can be handed off');
  if (source.settlement.orderId !== source.order.id)
    throw new BadRequestException('Settlement and order do not correspond');

  // Voided lines were never sold and must not appear. Ordering is stable by line id so
  // two builds of the same settlement are byte-identical.
  const lines = source.items
    .filter((item) => item.voidedAt === null)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map<FiscalSaleLine>((item) => ({
      lineId: item.id,
      productId: item.productId,
      productName: item.productName,
      sku: item.sku,
      categoryName: item.categoryName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      taxRate: item.taxRate,
      taxMode: item.taxMode,
      subtotal: item.subtotal,
      discount: item.discount,
      tax: item.tax,
      total: item.total,
      // Modifier adjustments are already folded into the line totals; they are listed
      // for provider context and must never be summed into the sale again.
      modifiers: [...item.modifiers]
        .sort((a, b) => a.groupName.localeCompare(b.groupName) || a.name.localeCompare(b.name))
        .map((m) => ({
          groupName: m.groupName,
          name: m.name,
          priceAdjustment: m.priceAdjustment,
        })),
    }));

  const tenders = [...source.payments]
    .sort((a, b) => a.method.localeCompare(b.method) || a.amount.localeCompare(b.amount))
    .map<FiscalSaleTender>((p) => ({
      method: p.method,
      amount: p.amount,
      transactionReference: p.transactionReference,
      companyId: p.companyId,
    }));

  return {
    payloadVersion: 1,
    settlementId: source.settlement.orderId,
    orderId: source.order.id,
    orderNumber: source.order.orderNumber.toString(),
    correlationKey: correlationKeyFor(source.order.id),
    settledAt: source.settlement.createdAt.toISOString(),
    orderType: source.order.type,
    currency: source.order.currency,
    subtotal: source.order.subtotal,
    discount: source.order.discount,
    tax: source.order.tax,
    total: source.order.total,
    lines,
    taxBreakdown: taxBreakdown(lines),
    tenders,
    seller: source.seller,
    cashier: source.cashier,
    service: { tableName: source.order.tableName, waiterName: source.order.waiterName },
  };
}

/**
 * Stable fingerprint of a payload, for proving that a retry sends exactly what the first
 * attempt sent. Keys are sorted so serialization order cannot change the digest.
 */
export function payloadFingerprint(payload: FiscalSalePayload): string {
  const canonical = JSON.stringify(payload, Object.keys(flatten(payload)).sort());
  let hash = 0n;
  for (const char of canonical) hash = (hash * 31n + BigInt(char.charCodeAt(0))) % 2n ** 64n;
  return hash.toString(16).padStart(16, '0');
}

function flatten(
  value: unknown,
  prefix = '',
  out: Record<string, true> = {},
): Record<string, true> {
  if (Array.isArray(value)) {
    for (const entry of value) flatten(entry, prefix, out);
  } else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      out[key] = true;
      flatten(nested, `${prefix}${key}.`, out);
    }
  }
  return out;
}
