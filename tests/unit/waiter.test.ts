import { describe, it, expect } from 'vitest';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS } from '@restaurant/shared-types';
import type { OrderRecord } from '@restaurant/shared-types';
import { openOrderForTable } from '../../apps/admin/src/components/waiter-app';

const order = (extra: Partial<OrderRecord>): OrderRecord =>
  ({
    paymentStarted: false,
    kitchenSubmitted: false,
    id: 'order-' + (extra.orderNumber ?? '1'),
    orderNumber: '1',
    type: 'DINE_IN',
    status: 'OPEN',
    tableId: null,
    areaId: null,
    tableName: null,
    areaName: null,
    waiterId: null,
    waiterName: null,
    currency: 'EUR',
    subtotal: '0.00',
    discount: '0.00',
    tax: '0.00',
    total: '0.00',
    discountReason: null,
    cancellationReason: null,
    notes: '',
    version: 1,
    createdAt: '2026-09-15T00:00:00.000Z',
    updatedAt: '2026-09-15T00:00:00.000Z',
    items: [],
    ...extra,
  }) as OrderRecord;

describe('waiter table service', () => {
  it('resolves the live order for a table across every active lifecycle state', () => {
    // A table carries no order reference, so the waiter surface maps it by tableId.
    for (const status of [
      'DRAFT',
      'OPEN',
      'SENT_TO_KITCHEN',
      'PREPARING',
      'READY',
      'WAITING_PAYMENT',
    ] as const) {
      const live = order({ status, tableId: 'table-7', orderNumber: '7' });
      expect(openOrderForTable([live], 'table-7')?.id).toBe(live.id);
    }
  });
  it('ignores terminal orders so a settled table reads as available', () => {
    for (const status of ['PAID', 'CANCELLED'] as const)
      expect(openOrderForTable([order({ status, tableId: 'table-7' })], 'table-7')).toBeNull();
    expect(openOrderForTable([], 'table-7')).toBeNull();
  });
  it('never returns another table or a takeaway order', () => {
    const other = order({ status: 'OPEN', tableId: 'table-9', orderNumber: '9' });
    const takeaway = order({ status: 'OPEN', type: 'TAKEAWAY', tableId: null, orderNumber: '3' });
    expect(openOrderForTable([other, takeaway], 'table-7')).toBeNull();
    expect(openOrderForTable([other, takeaway], 'table-9')?.id).toBe(other.id);
  });
  it('grants a waiter exactly the keys the mobile surface needs and nothing more', () => {
    // Phase 10 adds no permission key: it is a client surface over existing grants.
    expect(DEFAULT_ROLE_PERMISSIONS.WAITER).toEqual([
      'menu.read',
      'layout.read',
      'order.read',
      'order.manage',
      'order.submit_kitchen',
    ]);
    // Requesting payment is an order command, so a waiter needs no payment key.
    for (const denied of [
      'payment.read',
      'payment.collect',
      'order.discount',
      'order.cancel',
      'order.assign',
      'kitchen.read',
      'company.charge',
    ] as const) {
      expect(PERMISSIONS).toContain(denied);
      expect(DEFAULT_ROLE_PERMISSIONS.WAITER).not.toContain(denied);
    }
  });
});
