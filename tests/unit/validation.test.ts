import { describe, expect, it } from 'vitest';
import {
  createUserSchema,
  decimalAmountSchema,
  loginSchema,
  rolePermissionsSchema,
  terminalSchema,
} from '@restaurant/validation';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS } from '@restaurant/shared-types';
describe('Boundary validation', () => {
  it('rejects client-provided permissions and branch scope on registration', () => {
    expect(
      terminalSchema.safeParse({ name: 'Till', type: 'POS', branchId: 'forged' }).success,
    ).toBe(false);
    expect(
      createUserSchema.safeParse({
        name: 'A',
        email: 'a@example.test',
        password: 'long-password-123',
        roleIds: ['77c7f4a3-067d-4ce4-a898-8a28d7b1d171'],
        permissions: ['all'],
      }).success,
    ).toBe(false);
  });
  it('normalizes email and bounds password length', () => {
    expect(
      loginSchema.parse({
        organization: 'restaurant',
        branch: 'main',
        email: 'OWNER@example.test',
        password: 'secret',
      }).email,
    ).toBe('owner@example.test');
    expect(
      loginSchema.safeParse({
        organization: 'restaurant',
        branch: 'main',
        email: 'a@example.test',
        password: 'a'.repeat(129),
      }).success,
    ).toBe(false);
  });
  it('requires a strong initial password and valid role IDs', () => {
    expect(
      createUserSchema.safeParse({
        name: 'A',
        email: 'a@example.test',
        password: 'short',
        roleIds: ['invalid'],
      }).success,
    ).toBe(false);
  });
  it('rejects unknown permissions and terminal types', () => {
    expect(rolePermissionsSchema.safeParse({ permissions: ['superuser'] }).success).toBe(false);
    expect(terminalSchema.safeParse({ name: 'Till', type: 'UNKNOWN' }).success).toBe(false);
  });
  it.each([1.2, '1.234', '-1.00', '01.00', '1e2', 'Infinity', '9999999999999.00'])(
    'rejects non-canonical money input %s',
    (value) => {
      expect(decimalAmountSchema.safeParse(value).success).toBe(false);
    },
  );
  it('preserves decimal amounts as strings', () => {
    expect(decimalAmountSchema.parse('999999999999.99')).toBe('999999999999.99');
  });
  it('grants owner explicit permissions and keeps operational roles out of administration', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.OWNER).toEqual(PERMISSIONS);
    for (const role of ['STOREKEEPER'] as const) expect(DEFAULT_ROLE_PERMISSIONS[role]).toEqual([]);
    expect(DEFAULT_ROLE_PERMISSIONS.CASHIER).toContain('payment.collect');
    expect(DEFAULT_ROLE_PERMISSIONS.CASHIER).not.toContain('payment.refund');
    expect(DEFAULT_ROLE_PERMISSIONS.CASHIER).not.toContain('payment.cancel');
    expect(DEFAULT_ROLE_PERMISSIONS.WAITER).toEqual([
      'menu.read',
      'layout.read',
      'order.read',
      'order.manage',
      'order.submit_kitchen',
    ]);
    expect(DEFAULT_ROLE_PERMISSIONS.KITCHEN).toEqual(['kitchen.read', 'kitchen.manage']);
  });
});
