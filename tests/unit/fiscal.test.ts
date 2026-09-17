import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS } from '@restaurant/shared-types';
import { fiscalListSchema, fiscalRetrySchema } from '@restaurant/validation';
import {
  buildFiscalPayload,
  correlationKeyFor,
  payloadFingerprint,
  type PayloadSource,
} from '../../apps/api/src/fiscal/fiscal-payload';
import {
  SandboxFiscalProvider,
  UnconfiguredFiscalProvider,
  createFiscalProvider,
} from '../../apps/api/src/fiscal/fiscal-provider';
import {
  canAttempt,
  canTransition,
  isTerminal,
  nextState,
  retryDelayMs,
  summarize,
  unresolvedCount,
} from '../../apps/api/src/fiscal/fiscal-state';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const source = (extra: Partial<PayloadSource> = {}): PayloadSource => ({
  settlement: {
    orderId: ORDER_ID,
    cashierId: 'cashier-1',
    createdAt: new Date('2026-09-19T10:30:00.000Z'),
    currency: 'EUR',
  },
  order: {
    id: ORDER_ID,
    orderNumber: 4021n,
    type: 'DINE_IN',
    status: 'PAID',
    currency: 'EUR',
    subtotal: '24.00',
    discount: '2.00',
    tax: '3.05',
    total: '22.00',
    tableName: 'T4',
    waiterName: 'Ada',
  },
  items: [
    {
      id: 'item-b',
      productId: 'product-b',
      productName: 'Soup',
      sku: 'SOUP',
      categoryName: 'Starters',
      unitPrice: '4.00',
      taxRate: '8.00',
      taxMode: 'INCLUSIVE',
      quantity: 1,
      subtotal: '4.00',
      discount: '0.00',
      tax: '0.30',
      total: '4.00',
      voidedAt: null,
      modifiers: [],
    },
    {
      id: 'item-a',
      productId: 'product-a',
      productName: 'Steak',
      sku: 'STEAK',
      categoryName: 'Mains',
      unitPrice: '20.00',
      taxRate: '18.00',
      taxMode: 'INCLUSIVE',
      quantity: 1,
      subtotal: '20.00',
      discount: '2.00',
      tax: '2.75',
      total: '18.00',
      voidedAt: null,
      modifiers: [
        { groupName: 'Sides', name: 'Fries', priceAdjustment: '1.00' },
        { groupName: 'Cooking', name: 'Medium', priceAdjustment: '0.00' },
      ],
    },
  ],
  payments: [{ method: 'CARD', amount: '22.00', transactionReference: 'term-9', companyId: null }],
  seller: {
    organizationId: 'org-1',
    organizationName: 'Riza',
    branchId: 'branch-1',
    branchCode: 'main',
    branchName: 'Main',
    timezone: 'Europe/Belgrade',
  },
  cashier: { userId: 'cashier-1', name: 'Blerim' },
  ...extra,
});

describe('fiscal payload construction', () => {
  it('is deterministic: the same settlement always builds an identical payload', () => {
    const first = buildFiscalPayload(source());
    const second = buildFiscalPayload(source());
    expect(second).toEqual(first);
    expect(payloadFingerprint(second)).toBe(payloadFingerprint(first));
  });
  it('orders lines and modifiers stably regardless of input order', () => {
    const reversed = source();
    reversed.items.reverse();
    const payload = buildFiscalPayload(reversed);
    expect(payload.lines.map((l) => l.lineId)).toEqual(['item-a', 'item-b']);
    expect(payload.lines[0].modifiers.map((m) => m.name)).toEqual(['Medium', 'Fries']);
  });
  it('carries the stored sale figures without recomputing any tax', () => {
    const payload = buildFiscalPayload(source());
    expect(payload.total).toBe('22.00');
    expect(payload.tax).toBe('3.05');
    expect(payload.discount).toBe('2.00');
    expect(payload.orderNumber).toBe('4021');
    expect(payload.currency).toBe('EUR');
    // Line figures are the frozen snapshots, not derived values.
    expect(payload.lines.map((l) => l.total)).toEqual(['18.00', '4.00']);
  });
  it('groups the tax breakdown by the recorded rate and mode', () => {
    const payload = buildFiscalPayload(source());
    expect(payload.taxBreakdown).toEqual([
      { taxRate: '18.00', taxMode: 'INCLUSIVE', net: '15.25', tax: '2.75', gross: '18.00' },
      { taxRate: '8.00', taxMode: 'INCLUSIVE', net: '3.70', tax: '0.30', gross: '4.00' },
    ]);
    // The breakdown reproduces the order's recorded tax exactly: an order's tax is the
    // sum of its line taxes, so the grouping must not invent or lose a cent.
    const totalTax = payload.taxBreakdown.reduce((n, t) => n + Number(t.tax) * 100, 0);
    expect(Math.round(totalTax)).toBe(Math.round(Number(payload.tax) * 100));
    expect(Math.round(totalTax)).toBe(305);
  });
  it('excludes voided lines, which were never sold', () => {
    const withVoid = source();
    withVoid.items[0].voidedAt = new Date('2026-09-19T10:00:00.000Z');
    const payload = buildFiscalPayload(withVoid);
    expect(payload.lines.map((l) => l.lineId)).toEqual(['item-a']);
    expect(payload.taxBreakdown).toHaveLength(1);
  });
  it('refuses any order that is not settled', () => {
    // Eligibility is the whole safety rule: an unsettled sale must never be handed off.
    for (const status of ['DRAFT', 'OPEN', 'WAITING_PAYMENT', 'CANCELLED'])
      expect(() => buildFiscalPayload(source({ order: { ...source().order, status } }))).toThrow(
        /settled/i,
      );
  });
  it('refuses a settlement that does not correspond to its order', () => {
    const mismatched = source();
    mismatched.settlement.orderId = '22222222-2222-4222-8222-222222222222';
    expect(() => buildFiscalPayload(mismatched)).toThrow(/correspond/i);
  });
  it('derives a stable correlation key from the settlement identity', () => {
    expect(correlationKeyFor(ORDER_ID)).toBe(`riza-settlement:${ORDER_ID}`);
    expect(buildFiscalPayload(source()).correlationKey).toBe(correlationKeyFor(ORDER_ID));
  });
  it('contains no fiscal identifier, because this POS issues none', () => {
    const payload = JSON.stringify(buildFiscalPayload(source()));
    expect(payload).not.toMatch(/fiscalNumber|fiscalReceipt|signature|atk/i);
  });
});

describe('fiscal handoff state rules', () => {
  it('allows an attempt only from an unresolved state', () => {
    expect(canAttempt('PENDING')).toBe(true);
    expect(canAttempt('FAILED')).toBe(true);
    expect(canAttempt('RETRY_REQUIRED')).toBe(true);
    // A delivered sale is never re-sent, and an in-flight attempt is not duplicated.
    expect(canAttempt('CONFIRMED')).toBe(false);
    expect(canAttempt('SENT')).toBe(false);
  });
  it('treats confirmation as terminal and immutable', () => {
    expect(isTerminal('CONFIRMED')).toBe(true);
    expect(isTerminal('FAILED')).toBe(false);
    for (const to of ['PENDING', 'SENT', 'FAILED', 'RETRY_REQUIRED'] as const)
      expect(canTransition('CONFIRMED', to)).toBe(false);
    expect(canTransition('PENDING', 'SENT')).toBe(true);
  });
  it('maps a provider result to the right next state', () => {
    expect(nextState({ status: 'confirmed', providerReference: 'x' })).toBe('CONFIRMED');
    expect(nextState({ status: 'failed', retryable: true, error: 'offline' })).toBe(
      'RETRY_REQUIRED',
    );
    // A permanent rejection stays visible for a human rather than retrying forever.
    expect(nextState({ status: 'failed', retryable: false, error: 'rejected' })).toBe('FAILED');
  });
  it('backs off exponentially within a bound', () => {
    expect(retryDelayMs(0)).toBe(30000);
    expect(retryDelayMs(1)).toBe(60000);
    expect(retryDelayMs(100)).toBe(900000);
  });
  it('summarizes counts with every state present and counts only unresolved work', () => {
    const counts = summarize(['PENDING', 'CONFIRMED', 'CONFIRMED', 'FAILED']);
    expect(counts).toEqual({ PENDING: 1, SENT: 0, CONFIRMED: 2, FAILED: 1, RETRY_REQUIRED: 0 });
    expect(unresolvedCount(counts)).toBe(2);
    expect(unresolvedCount(summarize(['CONFIRMED', 'SENT']))).toBe(0);
  });
});

describe('fiscal provider boundary', () => {
  it('never claims success when no transport is implemented', () => {
    const provider = new UnconfiguredFiscalProvider('enternet-flink');
    expect(provider.ready).toBe(false);
    return provider.deliver().then((result) => {
      expect(result.status).toBe('failed');
      if (result.status === 'failed') {
        expect(result.retryable).toBe(true);
        expect(result.error).toMatch(/specification/i);
      }
    });
  });
  it('resolves enternet-flink to the unconfigured adapter until its transport exists', () => {
    // Naming a provider must not conjure a transport that has not been specified.
    const provider = createFiscalProvider({
      FISCAL_PROVIDER: 'enternet-flink',
      FLINK_ENABLED: 'true',
      NODE_ENV: 'development',
    } as NodeJS.ProcessEnv);
    expect(provider.ready).toBe(false);
    expect(provider.name).toBe('enternet-flink');
  });
  it('stays disabled when configuration is absent or switched off', () => {
    expect(createFiscalProvider({} as NodeJS.ProcessEnv).ready).toBe(false);
    expect(
      createFiscalProvider({
        FISCAL_PROVIDER: 'sandbox',
        FLINK_ENABLED: 'false',
      } as NodeJS.ProcessEnv).ready,
    ).toBe(false);
  });
  it('refuses to construct the sandbox adapter in production', () => {
    expect(() => new SandboxFiscalProvider('confirm', 'production')).toThrow(/production/i);
    expect(
      createFiscalProvider({
        FISCAL_PROVIDER: 'sandbox',
        FLINK_ENABLED: 'true',
        NODE_ENV: 'production',
      } as NodeJS.ProcessEnv).ready,
    ).toBe(false);
  });
  it('is idempotent by correlation key, so one sale yields one delivery', async () => {
    const provider = new SandboxFiscalProvider('confirm', 'test');
    const payload = buildFiscalPayload(source());
    const first = await provider.deliver(payload);
    const second = await provider.deliver(payload);
    expect(second).toEqual(first);
    if (first.status === 'confirmed') expect(first.providerReference).toContain(ORDER_ID);
  });
  it('surfaces retryable and permanent failures distinctly', async () => {
    const retryable = await new SandboxFiscalProvider('retryable', 'test').deliver(
      buildFiscalPayload(source()),
    );
    const permanent = await new SandboxFiscalProvider('permanent', 'test').deliver(
      buildFiscalPayload(source()),
    );
    expect(retryable.status === 'failed' && retryable.retryable).toBe(true);
    expect(permanent.status === 'failed' && permanent.retryable).toBe(false);
  });
});

describe('fiscal inputs and permissions', () => {
  it('accepts only a state filter and never a client-supplied identifier', () => {
    expect(fiscalListSchema.parse({}).state).toBeUndefined();
    expect(fiscalListSchema.parse({ state: 'FAILED' }).state).toBe('FAILED');
    expect(fiscalListSchema.safeParse({ state: 'ISSUED' }).success).toBe(false);
    expect(fiscalListSchema.safeParse({ branchId: 'x' }).success).toBe(false);
    // A retry carries no body: the payload is rebuilt from immutable records.
    expect(fiscalRetrySchema.safeParse({}).success).toBe(true);
    expect(fiscalRetrySchema.safeParse({ providerReference: 'forged' }).success).toBe(false);
    expect(fiscalRetrySchema.safeParse({ fiscalNumber: '123' }).success).toBe(false);
  });
  it('grants fiscal permissions to owner, admin and manager only', () => {
    expect(PERMISSIONS).toContain('fiscal.read');
    expect(PERMISSIONS).toContain('fiscal.retry');
    for (const role of ['OWNER', 'ADMIN', 'MANAGER'] as const) {
      expect(DEFAULT_ROLE_PERMISSIONS[role]).toContain('fiscal.read');
      expect(DEFAULT_ROLE_PERMISSIONS[role]).toContain('fiscal.retry');
    }
    for (const role of ['CASHIER', 'WAITER', 'KITCHEN', 'STOREKEEPER'] as const) {
      expect(DEFAULT_ROLE_PERMISSIONS[role]).not.toContain('fiscal.read');
      expect(DEFAULT_ROLE_PERMISSIONS[role]).not.toContain('fiscal.retry');
    }
  });
});
