import { describe, expect, it } from 'vitest';
import {
  convertQuantity,
  quantityMicros,
  quantityText,
} from '../../apps/api/src/inventory/quantity';
import { recipeSchema, stockMovementSchema } from '@restaurant/validation';
import { randomUUID } from 'node:crypto';

describe('exact stock quantities', () => {
  it('converts mass and volume without floating point', () => {
    expect(convertQuantity('0.150', 'kg', 'g')).toBe('150.000000');
    expect(convertQuantity('150', 'g', 'kg')).toBe('0.150000');
    expect(convertQuantity('1.234567', 'l', 'ml')).toBe('1234.567000');
    expect(convertQuantity('-0.000001', 'kg', 'g')).toBe('-0.001000');
  });
  it('multiplies recipe quantities exactly across many products', () => {
    expect(quantityText(quantityMicros('0.150000') * 999n)).toBe('149.850000');
    expect(quantityText(quantityMicros('0.100001') * 3n)).toBe('0.300003');
  });
  it('rejects incompatible dimensions, rounding, exponent notation and overflow', () => {
    expect(() => convertQuantity('1', 'kg', 'l')).toThrow();
    expect(() => convertQuantity('1', 'pcs', 'g')).toThrow();
    expect(() => convertQuantity('0.000001', 'g', 'kg')).toThrow();
    expect(() => quantityMicros('1e3')).toThrow();
    expect(() => quantityText(10n ** 20n)).toThrow();
  });
  it('validates movement direction, reasons and strict inputs', () => {
    const input = {
      commandId: randomUUID(),
      warehouseId: randomUUID(),
      itemId: randomUUID(),
      kind: 'WASTE',
      quantity: '1',
      unitCode: 'kg',
      reason: 'Spoiled',
    };
    expect(stockMovementSchema.safeParse(input).success).toBe(true);
    for (const bad of [
      { quantity: '-1' },
      { quantity: '0' },
      { quantity: '1.1234567' },
      { reason: '' },
      { branchId: randomUUID() },
      { quantity: 1 },
    ])
      expect(stockMovementSchema.safeParse({ ...input, ...bad }).success).toBe(false);
  });
  it('requires nonempty unique recipe ingredients', () => {
    const line = { itemId: randomUUID(), quantity: '0.15', unitCode: 'kg' };
    const input = {
      commandId: randomUUID(),
      productId: randomUUID(),
      warehouseId: randomUUID(),
      version: 0,
      items: [line],
    };
    expect(recipeSchema.safeParse(input).success).toBe(true);
    expect(recipeSchema.safeParse({ ...input, items: [line, line] }).success).toBe(false);
    expect(recipeSchema.safeParse({ ...input, items: [] }).success).toBe(false);
  });
});
