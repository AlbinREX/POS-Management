import { describe, expect, it } from 'vitest';
import {
  menuInputSchema,
  menuUpdateSchema,
  menuListSchema,
  signedAmountSchema,
  taxRateSchema,
} from '@restaurant/validation';
import { DEFAULT_ROLE_PERMISSIONS } from '@restaurant/shared-types';

const product = {
  kind: 'products',
  name: 'Configured product',
  sku: 'SKU-1',
  categoryId: '77c7f4a3-067d-4ce4-a898-8a28d7b1d171',
  sellingPrice: '999999999999.99',
  taxRate: '18.00',
  taxMode: 'INCLUSIVE',
};
describe('Menu boundaries', () => {
  it('keeps exact product prices and tax percentages as strings', () => {
    const parsed = menuInputSchema.parse(product);
    expect(parsed.kind === 'products' && parsed.sellingPrice).toBe('999999999999.99');
    expect(signedAmountSchema.parse('-0.50')).toBe('-0.50');
  });
  it.each([1.2, '-0.00', '+1.00', '01.00', '1e2', '0.001', '9999999999999.00'])(
    'rejects unsafe modifier amount %s',
    (value) => {
      expect(signedAmountSchema.safeParse(value).success).toBe(false);
    },
  );
  it.each(['100.01', '-1.00', '018.00', '18', 18])('rejects invalid tax %s', (value) => {
    expect(taxRateSchema.safeParse(value).success).toBe(false);
  });
  it('requires explicit tax configuration and canonical money', () => {
    expect(menuInputSchema.safeParse({ ...product, sellingPrice: 2.5 }).success).toBe(false);
    expect(menuInputSchema.safeParse({ ...product, taxMode: undefined }).success).toBe(false);
    expect(menuInputSchema.safeParse({ ...product, taxRate: undefined }).success).toBe(false);
    expect(taxRateSchema.parse('100.00')).toBe('100.00');
  });
  it('rejects scope injection, unknown fields, duplicate links and unsafe images', () => {
    for (const extra of [
      { branchId: product.categoryId },
      { permissions: ['menu.manage'] },
      { imageUrl: 'javascript:alert(1)' },
      { imageUrl: 'not a valid URL' },
      { modifierGroupIds: [product.categoryId, product.categoryId] },
    ])
      expect(menuInputSchema.safeParse({ ...product, ...extra }).success).toBe(false);
  });
  it('validates modifier choice constraints', () => {
    for (const [minSelections, maxSelections] of [
      [2, 1],
      [-1, 1],
      [0, 0],
      [0, 101],
      [0.5, 1],
    ])
      expect(
        menuInputSchema.safeParse({
          kind: 'modifier-groups',
          name: 'Extras',
          minSelections,
          maxSelections,
        }).success,
      ).toBe(false);
  });
  it('requires version on edits and bounds list queries', () => {
    expect(menuUpdateSchema.safeParse({ data: product }).success).toBe(false);
    expect(menuListSchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(menuListSchema.safeParse({ archived: 'anything' }).success).toBe(false);
  });
  it('default menu management is explicit and limited to owner/admin', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.ADMIN).toContain('menu.manage');
    expect(DEFAULT_ROLE_PERMISSIONS.MANAGER).toContain('menu.read');
    expect(DEFAULT_ROLE_PERMISSIONS.MANAGER).not.toContain('menu.manage');
    expect(DEFAULT_ROLE_PERMISSIONS.KITCHEN).not.toContain('menu.read');
  });
});
