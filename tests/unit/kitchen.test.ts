import { describe, it, expect } from 'vitest';
import {
  aggregateKitchen,
  kitchenNext,
  printContract,
} from '../../apps/api/src/kitchen/kitchen.transactions';
import { kitchenListSchema, kitchenStateSchema, kitchenSubmitSchema } from '@restaurant/validation';
import type { KitchenTicketRecord } from '@restaurant/shared-types';
describe('kitchen contracts', () => {
  it('requires every station to be ready before the order is ready', () => {
    expect(aggregateKitchen(['NEW', 'NEW'])).toBe('SENT_TO_KITCHEN');
    expect(aggregateKitchen(['NEW', 'READY'])).toBe('PREPARING');
    expect(aggregateKitchen(['PREPARING', 'COMPLETED'])).toBe('PREPARING');
    expect(aggregateKitchen(['READY', 'COMPLETED'])).toBe('READY');
    expect(aggregateKitchen(['COMPLETED'])).toBe('READY');
    expect(() => aggregateKitchen([])).toThrow();
  });
  it('only allows forward ticket states and never payment or served semantics', () => {
    expect(kitchenNext).toEqual({ NEW: 'PREPARING', PREPARING: 'READY', READY: 'COMPLETED' });
  });
  it('rejects forged scope, content, invalid state and missing concurrency fields', () => {
    const base = { commandId: '10000000-0000-4000-8000-000000000001', version: 1 };
    expect(kitchenSubmitSchema.safeParse(base).success).toBe(true);
    expect(kitchenSubmitSchema.safeParse({ ...base, branchId: base.commandId }).success).toBe(
      false,
    );
    for (const status of ['NEW', 'PAID', 'CANCELLED', 'SERVED'])
      expect(kitchenStateSchema.safeParse({ ...base, status }).success).toBe(false);
    expect(kitchenStateSchema.safeParse({ ...base, status: 'READY', content: {} }).success).toBe(
      false,
    );
    expect(kitchenStateSchema.safeParse({ status: 'PREPARING' }).success).toBe(false);
  });
  it('bounds board queries and rejects foreign scope filters', () => {
    expect(kitchenListSchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(kitchenListSchema.safeParse({ organizationId: 'fake' }).success).toBe(false);
    expect(kitchenListSchema.parse({})).toEqual({ page: 1, limit: 50, view: 'active' });
  });
  it('keeps original print identity stable across progress and cancellation distinct', () => {
    const ticket = {
      id: 'ticket',
      version: 1,
      cancelledAt: null,
      content: { schemaVersion: 1 },
    } as KitchenTicketRecord;
    expect(printContract(ticket).documentId).toBe(
      printContract({ ...ticket, version: 4 }).documentId,
    );
    const cancelled = printContract({
      ...ticket,
      cancelledAt: '2026-09-12T00:00:00.000Z',
      cancellationReason: 'Stop',
    });
    expect(cancelled.kind).toBe('KITCHEN_CANCELLATION');
    expect(cancelled.documentId).not.toBe(printContract(ticket).documentId);
    expect(cancelled.cancellation?.reason).toBe('Stop');
  });
});
