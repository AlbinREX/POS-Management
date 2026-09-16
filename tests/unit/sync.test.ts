import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  SYNC_STREAMS,
  type SyncStreamStatus,
} from '@restaurant/shared-types';
import { syncStatusSchema } from '@restaurant/validation';
import {
  backoffMs,
  isDegraded,
  pendingCount,
  pendingTotal,
  syncHealth,
} from '../../apps/api/src/sync/sync-state';

const stream = (extra: Partial<SyncStreamStatus> = {}): SyncStreamStatus => ({
  stream: 'orders',
  localRevision: '10',
  deliveredRevision: '10',
  pending: 0,
  lastDeliveredAt: null,
  lastAttemptAt: null,
  lastError: null,
  failedAttempts: 0,
  ...extra,
});

describe('sync backlog accounting', () => {
  it('counts only records committed locally but not yet delivered', () => {
    expect(pendingCount('10', '10')).toBe(0);
    expect(pendingCount('10', '4')).toBe(6);
    expect(pendingCount('1', '0')).toBe(1);
  });
  it('never reports a negative backlog when a checkpoint is ahead of the local log', () => {
    // A restored or rebuilt database can leave a checkpoint ahead. That is not a backlog
    // and must never cause local history to be reprocessed.
    expect(pendingCount('4', '10')).toBe(0);
    expect(pendingCount('0', '0')).toBe(0);
  });
  it('handles revisions beyond the JavaScript safe integer range', () => {
    expect(pendingCount('9007199254740993', '9007199254740990')).toBe(3);
    expect(pendingCount('99999999999999999999', '0')).toBe(1000000);
  });
  it('sums and clamps the total across streams', () => {
    expect(pendingTotal([stream({ pending: 2 }), stream({ pending: 3 })])).toBe(5);
    expect(pendingTotal([stream({ pending: 1000000 }), stream({ pending: 5 })])).toBe(1000000);
    expect(pendingTotal([])).toBe(0);
  });
});
describe('sync health reporting', () => {
  it('is disabled when no cloud target is configured', () => {
    expect(syncHealth([stream()], false)).toBe('disabled');
    expect(syncHealth([stream({ pending: 9, lastError: 'boom' })], false)).toBe('disabled');
  });
  it('is healthy only when every stream is delivered and error free', () => {
    expect(syncHealth([stream(), stream({ stream: 'payments' })], true)).toBe('healthy');
  });
  it('reports pending work without calling it a failure', () => {
    expect(syncHealth([stream({ pending: 4 })], true)).toBe('pending');
  });
  it('reports a failure even when the backlog is empty', () => {
    // A silent delivery error must never be displayed as healthy.
    expect(syncHealth([stream({ lastError: 'connection refused' })], true)).toBe('failed');
    expect(syncHealth([stream({ pending: 3, lastError: 'timeout' })], true)).toBe('failed');
    expect(isDegraded([stream({ lastError: 'timeout' })])).toBe(true);
    expect(isDegraded([stream()])).toBe(false);
  });
});
describe('delivery backoff', () => {
  it('grows exponentially and is capped so it never hot-loops or starves the pool', () => {
    expect(backoffMs(0)).toBe(5000);
    expect(backoffMs(1)).toBe(10000);
    expect(backoffMs(2)).toBe(20000);
    expect(backoffMs(6)).toBe(300000);
    expect(backoffMs(1000)).toBe(300000);
  });
});
describe('sync contracts and permissions', () => {
  it('covers exactly the seven durable event logs', () => {
    expect([...SYNC_STREAMS].sort()).toEqual([
      'companies',
      'inventory',
      'kitchen',
      'layout',
      'orders',
      'payments',
      'purchasing',
    ]);
  });
  it('accepts an optional stream filter and never client scope', () => {
    expect(syncStatusSchema.parse({}).stream).toBeUndefined();
    expect(syncStatusSchema.parse({ stream: 'orders' }).stream).toBe('orders');
    expect(syncStatusSchema.safeParse({ stream: 'ledger' }).success).toBe(false);
    expect(syncStatusSchema.safeParse({ branchId: 'x' }).success).toBe(false);
    expect(syncStatusSchema.safeParse({ organizationId: 'x' }).success).toBe(false);
  });
  it('grants sync.read to owner, admin and manager only', () => {
    expect(PERMISSIONS).toContain('sync.read');
    for (const role of ['OWNER', 'ADMIN', 'MANAGER'] as const)
      expect(DEFAULT_ROLE_PERMISSIONS[role]).toContain('sync.read');
    for (const role of ['CASHIER', 'WAITER', 'KITCHEN', 'STOREKEEPER'] as const)
      expect(DEFAULT_ROLE_PERMISSIONS[role]).not.toContain('sync.read');
  });
});
