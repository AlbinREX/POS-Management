import { describe, expect, it } from 'vitest';
import { calculateOrder, type PriceLine } from '../../apps/api/src/orders/money';
import { orderCommandSchema, orderCreateSchema } from '@restaurant/validation';
const line = (extra: Partial<PriceLine> = {}): PriceLine => ({
  id: 'a',
  unitPrice: '10.00',
  quantity: 1,
  taxRate: '20.00',
  taxMode: 'INCLUSIVE',
  adjustments: [],
  ...extra,
});
describe('order money', () => {
  it('extracts included tax with explicit cent rounding', () =>
    expect(calculateOrder([line()], '0.00')).toMatchObject({
      subtotal: '10.00',
      tax: '1.67',
      total: '10.00',
    }));
  it('converts exclusive prices and modifiers before line rounding', () =>
    expect(
      calculateOrder([line({ taxMode: 'EXCLUSIVE', adjustments: ['0.50'], quantity: 2 })], '0.00'),
    ).toMatchObject({ subtotal: '25.20', tax: '4.20', total: '25.20' }));
  it('never loses cents allocating discounts, with deterministic ties', () => {
    const result = calculateOrder(
      [
        line({ id: 'b', unitPrice: '0.01', taxRate: '0.00' }),
        line({ id: 'a', unitPrice: '0.01', taxRate: '0.00' }),
        line({ id: 'c', unitPrice: '0.01', taxRate: '0.00' }),
      ],
      '0.02',
    );
    expect(result.items.map((i) => [i.id, i.discount])).toEqual([
      ['b', '0.01'],
      ['a', '0.01'],
      ['c', '0.00'],
    ]);
    expect(result.total).toBe('0.01');
  });
  it('supports mixed tax rates with gross discounts', () =>
    expect(
      calculateOrder(
        [line({ unitPrice: '12.00' }), line({ id: 'b', unitPrice: '10.00', taxRate: '0.00' })],
        '11.00',
      ),
    ).toMatchObject({ subtotal: '22.00', discount: '11.00', tax: '1.00', total: '11.00' }));
  it('supports a full discount and zero-price products', () => {
    expect(calculateOrder([line()], '10.00').tax).toBe('0.00');
    expect(calculateOrder([line({ unitPrice: '0.00' })], '0.00').total).toBe('0.00');
    expect(calculateOrder([], '0.00').total).toBe('0.00');
  });
  it('handles large decimal amounts without binary float loss', () =>
    expect(
      calculateOrder([line({ unitPrice: '999999999999.99', taxRate: '0.00' })], '0.01').total,
    ).toBe('999999999999.98'));
  it('rejects overflow, negative units and over-discounting', () => {
    expect(() =>
      calculateOrder([line({ unitPrice: '999999999999.99', quantity: 2 })], '0.00'),
    ).toThrow('range');
    expect(() => calculateOrder([line({ adjustments: ['-10.01'] })], '0.00')).toThrow('negative');
    expect(() => calculateOrder([line()], '10.01')).toThrow('Discount');
  });
  it('rounds half up once per gross line', () =>
    expect(
      calculateOrder([line({ unitPrice: '0.05', taxRate: '10.00', taxMode: 'EXCLUSIVE' })], '0.00')
        .total,
    ).toBe('0.06'));
});
describe('order boundaries', () => {
  const commandId = '10000000-0000-4000-8000-000000000001';
  it('requires dine-in table and rejects takeaway table', () => {
    expect(orderCreateSchema.safeParse({ commandId, type: 'DINE_IN' }).success).toBe(false);
    expect(
      orderCreateSchema.safeParse({ commandId, type: 'TAKEAWAY', tableId: commandId }).success,
    ).toBe(false);
    expect(orderCreateSchema.safeParse({ commandId, type: 'TAKEAWAY' }).success).toBe(true);
  });
  it('rejects forged scopes and totals', () => {
    for (const forged of [
      { branchId: commandId },
      { total: '0.00' },
      { organizationId: commandId },
    ])
      expect(orderCreateSchema.safeParse({ commandId, type: 'TAKEAWAY', ...forged }).success).toBe(
        false,
      );
  });
  it('requires reasons, versions and decimal text', () => {
    for (const extra of [
      { amount: 1, reason: 'test' },
      { amount: '1.00', reason: '' },
      { amount: '1e2', reason: 'test' },
    ])
      expect(
        orderCommandSchema.safeParse({ commandId, version: 1, action: 'discount', ...extra })
          .success,
      ).toBe(false);
  });
  it('rejects all kitchen and payment transitions', () => {
    for (const status of ['SENT_TO_KITCHEN', 'PREPARING', 'READY', 'SERVED', 'PAID'])
      expect(
        orderCommandSchema.safeParse({ commandId, version: 1, action: 'status', status }).success,
      ).toBe(false);
  });
  it('rejects duplicate modifiers and nonwhole quantities', () => {
    const value = { commandId, version: 1, action: 'add_item', productId: commandId, quantity: 1 };
    expect(
      orderCommandSchema.safeParse({ ...value, modifierIds: [commandId, commandId] }).success,
    ).toBe(false);
    for (const quantity of [0, -1, 1.5, 1000])
      expect(orderCommandSchema.safeParse({ ...value, quantity }).success).toBe(false);
  });
});
