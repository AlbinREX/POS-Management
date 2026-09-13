import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { cents, money, unitCents, cashChange } from '../../apps/api/src/payments/payment-money';
import {
  paymentCollectSchema,
  paymentReverseSchema,
  shiftCommandSchema,
} from '@restaurant/validation';

describe('payment money and command boundaries', () => {
  it('keeps decimal cents exact above floating-point precision', () => {
    expect(money(cents('999999999999.99'))).toBe('999999999999.99');
    expect(money(cents('0.10') + cents('0.20'))).toBe('0.30');
    expect(money(-123n)).toBe('-1.23');
    expect(() => money(100000000000000n)).toThrow();
  });
  it.each(['1e2', '0.1', 'NaN', '1.001', '01.00'])('rejects noncanonical cents %s', (v) =>
    expect(() => cents(v)).toThrow(),
  );
  it('allocates every remainder cent once, including discounted low-value units', () => {
    expect([1, 2, 3].map((i) => unitCents('10.00', 3, i))).toEqual([334n, 333n, 333n]);
    expect([1, 2, 3].map((i) => unitCents('0.01', 3, i))).toEqual([1n, 0n, 0n]);
    for (let qty = 1; qty <= 100; qty++)
      expect(
        Array.from({ length: qty }, (_, i) => unitCents('99.97', qty, i + 1)).reduce(
          (a, b) => a + b,
          0n,
        ),
      ).toBe(9997n);
  });
  it('calculates change from cash received without overpaying the order', () => {
    expect(cashChange('12.35', '20.00')).toBe('7.65');
    expect(() => cashChange('12.35', '12.34')).toThrow();
    expect(() => cashChange('0.00', '10.00')).toThrow();
  });
  it('strictly validates mode, cash fields, card references and amount types', () => {
    const base = {
      commandId: randomUUID(),
      version: 1,
      mode: 'AMOUNT',
      tenders: [{ method: 'CARD', amount: '1.00', transactionReference: 'terminal-123' }],
    };
    expect(paymentCollectSchema.safeParse(base).success).toBe(true);
    for (const extra of [
      { amount: 1 },
      { transactionReference: '4111111111111111' },
      { tendered: '1.00' },
      { cvv: '123' },
      { items: [{ itemId: randomUUID(), quantity: 1 }] },
    ])
      expect(
        paymentCollectSchema.safeParse({ ...base, tenders: [{ ...base.tenders[0], ...extra }] })
          .success,
      ).toBe(false);
    expect(paymentCollectSchema.safeParse({ ...base, branchId: randomUUID() }).success).toBe(false);
    expect(
      paymentCollectSchema.safeParse({
        ...base,
        tenders: [{ method: 'CASH', amount: '1.00', tendered: '2.00' }],
      }).success,
    ).toBe(false);
  });
  it('requires original-transaction reasons and explicit counted cash', () => {
    expect(
      paymentReverseSchema.safeParse({
        commandId: randomUUID(),
        kind: 'REFUND',
        amount: '0.00',
        reason: 'x',
      }).success,
    ).toBe(false);
    expect(
      shiftCommandSchema.safeParse({
        commandId: randomUUID(),
        version: 1,
        action: 'close',
        expectedAmount: '10.00',
        closingAmount: '10.00',
      }).success,
    ).toBe(false);
  });
});
