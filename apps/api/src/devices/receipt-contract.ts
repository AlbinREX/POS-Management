/**
 * The customer receipt document.
 *
 * Built from records the system already holds: the frozen order item snapshots, the
 * settlement that exists only for a PAID order, and the recorded tenders. Every amount
 * is copied verbatim as the exact decimal string the API stores. Nothing is recomputed,
 * re-rounded or locale-formatted, because the paper must agree with the ledger.
 *
 * This is NOT a fiscal receipt. FastFood Riza does not fiscalize: EnterNet's F-LINK owns
 * fiscal numbering, signing and receipt format. Every document carries a notice saying
 * so, so a printed slip can never be mistaken for a fiscal document.
 */
import { BadRequestException } from '@nestjs/common';
import type { ReceiptPrintContract } from '@restaurant/shared-types';

export const RECEIPT_NOTICE = 'Not a fiscal receipt';

/** The receipt's identity, and therefore its print idempotency key. */
export const receiptDocumentId = (orderId: string) => `receipt:${orderId}`;

export interface ReceiptSource {
  branchName: string;
  order: {
    id: string;
    orderNumber: string | number | bigint;
    status: string;
    type: 'DINE_IN' | 'TAKEAWAY';
    tableName: string | null;
    areaName: string | null;
    subtotal: string;
    discount: string;
    tax: string;
    total: string;
    items: {
      id: string;
      productName: string;
      quantity: number;
      unitPrice: string;
      total: string;
      voidedAt: string | null;
      modifiers: { groupName: string; name: string }[];
    }[];
  };
  settlement: { orderId: string; currency: string; createdAt: string; cashierName: string | null };
  payments: { method: string; amount: string; tendered: string | null; change: string | null }[];
}

export function buildReceipt(source: ReceiptSource): ReceiptPrintContract {
  // A receipt exists only for a settled sale. Printing one for an unpaid order would put
  // a document in a customer's hand that the ledger does not agree with.
  if (source.order.status !== 'PAID')
    throw new BadRequestException('Only a settled order has a receipt');
  if (source.settlement.orderId !== source.order.id)
    throw new BadRequestException('Settlement and order do not correspond');

  // Voided lines were removed before payment and are not part of what was bought.
  // Sorting by id keeps two builds of the same sale byte-identical, so a reprint is
  // provably the same document rather than a new one.
  const lines = source.order.items
    .filter((item) => item.voidedAt === null)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((item) => ({
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      total: item.total,
      modifiers: item.modifiers
        .map((m) => ({ groupName: m.groupName, name: m.name }))
        .sort((a, b) =>
          a.groupName === b.groupName
            ? a.name.localeCompare(b.name)
            : a.groupName.localeCompare(b.groupName),
        ),
    }));

  return {
    schemaVersion: 1,
    kind: 'CUSTOMER_RECEIPT',
    documentId: receiptDocumentId(source.order.id),
    branchName: source.branchName,
    orderNumber: String(source.order.orderNumber),
    orderType: source.order.type,
    tableName: source.order.tableName,
    areaName: source.order.areaName,
    cashierName: source.settlement.cashierName,
    settledAt: source.settlement.createdAt,
    currency: source.settlement.currency,
    lines,
    subtotal: source.order.subtotal,
    discount: source.order.discount,
    tax: source.order.tax,
    total: source.order.total,
    tenders: source.payments
      .map((p) => ({
        method: p.method,
        amount: p.amount,
        tendered: p.tendered,
        change: p.change,
      }))
      .sort((a, b) => (a.method === b.method ? a.amount.localeCompare(b.amount) : a.method.localeCompare(b.method))),
    notice: RECEIPT_NOTICE,
  };
}
