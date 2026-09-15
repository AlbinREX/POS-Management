import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  availableCredit,
  contractDiscount,
  exceedsMoney,
  negateMoney,
  sumMoney,
  withinCredit,
} from '../../apps/api/src/companies/company-money';
import {
  companySchema,
  contractSchema,
  companyEmployeeSchema,
  companyPaymentSchema,
  statementSchema,
  paymentCollectSchema,
} from '@restaurant/validation';

describe('company accounts', () => {
  it('applies a contract discount with half-up rounding and exact decimal strings', () => {
    expect(contractDiscount('100.00', '12.50')).toEqual({
      discount: '12.50',
      payable: '87.50',
    });
    // 33.33 * 7.5% = 2.49975 -> 2.50 half-up, never floating point drift.
    expect(contractDiscount('33.33', '7.50')).toEqual({ discount: '2.50', payable: '30.83' });
    expect(contractDiscount('0.01', '50.00')).toEqual({ discount: '0.01', payable: '0.00' });
    expect(contractDiscount('10.00', '0.00')).toEqual({ discount: '0.00', payable: '10.00' });
  });
  it('rejects invalid discount inputs and overflow', () => {
    expect(() => contractDiscount('-1.00', '10.00')).toThrow();
    expect(() => contractDiscount('10.00', '-1.00')).toThrow();
    expect(() => contractDiscount('10.00', '101.00')).toThrow();
    expect(() => sumMoney(['999999999999.99', '1.00'])).toThrow();
  });
  it('sums a signed ledger and reports credit headroom without negatives', () => {
    // CHARGE +24.00, CHARGE +11.50, PAYMENT -35.50 settles both.
    expect(sumMoney(['24.00', '11.50', '-35.50'])).toBe('0.00');
    expect(sumMoney([])).toBe('0.00');
    expect(negateMoney('35.50')).toBe('-35.50');
    expect(negateMoney('-35.50')).toBe('35.50');
    expect(availableCredit('500.00', '120.00')).toBe('380.00');
    // An over-limit account reports zero available, never a negative figure.
    expect(availableCredit('100.00', '150.00')).toBe('0.00');
    expect(availableCredit('0.00', '0.00')).toBe('0.00');
  });
  it('enforces the credit limit at its exact boundary', () => {
    expect(withinCredit('100.00', '90.00', '10.00')).toBe(true);
    expect(withinCredit('100.00', '90.00', '10.01')).toBe(false);
    // A zero credit limit means no credit, never unlimited.
    expect(withinCredit('0.00', '0.00', '0.01')).toBe(false);
    expect(exceedsMoney('10.01', '10.00')).toBe(true);
    expect(exceedsMoney('10.00', '10.00')).toBe(false);
  });
  it('accepts valid company, contract, employee, payment and statement commands', () => {
    const companyId = randomUUID();
    expect(
      companySchema.safeParse({ commandId: randomUUID(), name: 'Acme Ltd' }).success,
    ).toBe(true);
    expect(
      contractSchema.safeParse({
        commandId: randomUUID(),
        companyId,
        contractNumber: 'C-2026-001',
        startDate: '2026-09-01',
        endDate: '2026-12-31',
        creditLimit: '500.00',
        discountPercentage: '10.00',
        paymentTermsDays: 30,
        billingCycle: 'MONTHLY',
      }).success,
    ).toBe(true);
    expect(
      companyEmployeeSchema.safeParse({ commandId: randomUUID(), companyId, name: 'A. Employee' })
        .success,
    ).toBe(true);
    expect(
      companyPaymentSchema.safeParse({
        commandId: randomUUID(),
        companyId,
        amount: '35.50',
        method: 'BANK_TRANSFER',
        reference: 'WIRE-1',
        reason: 'Monthly settlement',
      }).success,
    ).toBe(true);
    expect(
      statementSchema.safeParse({
        commandId: randomUUID(),
        companyId,
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30',
      }).success,
    ).toBe(true);
  });
  it('rejects client-supplied scope, bad money and impossible periods', () => {
    const companyId = randomUUID();
    const contract = {
      commandId: randomUUID(),
      companyId,
      contractNumber: 'C-1',
      startDate: '2026-09-01',
      endDate: null,
      creditLimit: '500.00',
      discountPercentage: '10.00',
      paymentTermsDays: 30,
      billingCycle: 'MONTHLY' as const,
    };
    expect(contractSchema.safeParse(contract).success).toBe(true);
    for (const bad of [
      { branchId: randomUUID() }, // client-supplied scope
      { organizationId: randomUUID() },
      { creditLimit: 500 }, // number instead of decimal string
      { creditLimit: '1e3' }, // exponent notation
      { creditLimit: '500' }, // missing fixed scale
      { discountPercentage: '101.00' },
      { paymentTermsDays: 400 },
      { paymentTermsDays: -1 },
      { billingCycle: 'YEARLY' },
      { endDate: '2026-08-31' }, // end precedes start
      { contractNumber: '' },
    ])
      expect(contractSchema.safeParse({ ...contract, ...bad }).success).toBe(false);
    for (const bad of [
      { amount: '0.00' },
      { amount: '-5.00' },
      { amount: '1e3' },
      { method: 'CRYPTO' },
      { reference: '' },
      { balance: '10.00' }, // client-supplied balance
    ])
      expect(
        companyPaymentSchema.safeParse({
          commandId: randomUUID(),
          companyId,
          amount: '5.00',
          method: 'BANK_TRANSFER',
          reference: 'W-1',
          reason: 'x',
          ...bad,
        }).success,
      ).toBe(false);
    expect(
      statementSchema.safeParse({
        commandId: randomUUID(),
        companyId,
        periodStart: '2026-09-30',
        periodEnd: '2026-09-01',
      }).success,
    ).toBe(false);
  });
  it('validates a COMPANY_ACCOUNT tender exhaustively against cash and card shapes', () => {
    const companyId = randomUUID();
    const collect = (tender: Record<string, unknown>) =>
      paymentCollectSchema.safeParse({
        commandId: randomUUID(),
        version: 1,
        mode: 'AMOUNT',
        tenders: [{ amount: '10.00', ...tender }],
      }).success;
    expect(collect({ method: 'COMPANY_ACCOUNT', companyId })).toBe(true);
    expect(collect({ method: 'COMPANY_ACCOUNT', companyId, companyEmployeeId: randomUUID() })).toBe(
      true,
    );
    // A house account carries no drawer, no tendered cash and no card reference.
    expect(collect({ method: 'COMPANY_ACCOUNT' })).toBe(false);
    expect(collect({ method: 'COMPANY_ACCOUNT', companyId, shiftId: randomUUID() })).toBe(false);
    expect(collect({ method: 'COMPANY_ACCOUNT', companyId, tendered: '10.00' })).toBe(false);
    expect(collect({ method: 'COMPANY_ACCOUNT', companyId, transactionReference: 'REF-1' })).toBe(
      false,
    );
    // Existing methods keep their contracts and cannot borrow company fields.
    expect(collect({ method: 'CASH', tendered: '10.00', shiftId: randomUUID() })).toBe(true);
    expect(collect({ method: 'CASH', tendered: '10.00', shiftId: randomUUID(), companyId })).toBe(
      false,
    );
    expect(collect({ method: 'CARD', transactionReference: 'TERMINAL-1' })).toBe(true);
    expect(collect({ method: 'CARD', transactionReference: 'TERMINAL-1', companyId })).toBe(false);
  });
});
