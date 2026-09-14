import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { purchaseLine, purchaseTotals } from '../../apps/api/src/purchasing/purchase-money';
import {
  goodsReceiptSchema,
  purchaseDraftSchema,
  supplierPaymentSchema,
} from '@restaurant/validation';
describe('purchasing precision and contracts', () => {
  it('calculates fractional quantities at four-decimal unit cost', () => {
    expect(purchaseLine('1.250000', '3.1234', '18.00')).toEqual({
      subtotal: '3.90',
      tax: '0.70',
      total: '4.60',
    });
  });
  it('rounds line net then tax half up and sums only exact decimals', () => {
    const line = purchaseLine('0.1', '0.05', '10');
    expect(line).toEqual({ subtotal: '0.01', tax: '0.00', total: '0.01' });
    expect(purchaseTotals([line, line]).total).toBe('0.02');
  });
  it('rejects overflow and negative costs', () => {
    expect(() => purchaseLine('999999999999', '9999999999', '100')).toThrow();
    expect(() => purchaseLine('1', '-1', '0')).toThrow();
  });
  it('rejects duplicate lines and frontend branch or total overrides', () => {
    const line = {
      itemId: randomUUID(),
      quantity: '1',
      unitCode: 'kg',
      unitPrice: '10.00',
      taxRate: '18',
    };
    const input = {
      commandId: randomUUID(),
      supplierId: randomUUID(),
      warehouseId: randomUUID(),
      items: [line],
    };
    expect(purchaseDraftSchema.safeParse(input).success).toBe(true);
    for (const bad of [
      { items: [line, line] },
      { total: '5.00' },
      { branchId: randomUUID() },
      { items: [{ ...line, quantity: 1 }] },
    ])
      expect(purchaseDraftSchema.safeParse({ ...input, ...bad }).success).toBe(false);
  });
  it('requires linked invoice dates and safe document references', () => {
    const input = {
      commandId: randomUUID(),
      version: 1,
      reference: 'DELIVERY-1',
      items: [{ purchaseItemId: randomUUID(), quantity: '1' }],
    };
    expect(goodsReceiptSchema.safeParse(input).success).toBe(true);
    for (const bad of [
      { invoiceNumber: 'INV-1' },
      { invoiceDate: '2026-02-30', invoiceNumber: 'INV-1' },
      { documentReference: 'javascript:alert(1)' },
      { items: [] },
    ])
      expect(goodsReceiptSchema.safeParse({ ...input, ...bad }).success).toBe(false);
  });
  it('supplier payments cannot supply a POS shift or negative amount', () => {
    const input = {
      commandId: randomUUID(),
      receiptId: randomUUID(),
      amount: '1.00',
      method: 'BANK_TRANSFER',
      reference: 'BANK-1',
      reason: 'Invoice payment',
    };
    expect(supplierPaymentSchema.safeParse(input).success).toBe(true);
    for (const bad of [{ shiftId: randomUUID() }, { amount: '-1.00' }, { amount: '1e3' }])
      expect(supplierPaymentSchema.safeParse({ ...input, ...bad }).success).toBe(false);
  });
});
