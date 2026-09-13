import { describe, expect, it } from 'vitest';
import {
  areaInputSchema,
  tableInputSchema,
  tableGeometrySchema,
  tableStatusSchema,
  layoutChangesSchema,
} from '@restaurant/validation';
import { DEFAULT_ROLE_PERMISSIONS, TABLE_STATUSES } from '@restaurant/shared-types';
const table = {
  areaId: '77c7f4a3-067d-4ce4-a898-8a28d7b1d171',
  name: 'Table',
  number: 1,
  capacity: 4,
  positionX: 10,
  positionY: 20,
  width: 100,
  height: 100,
  shape: 'CIRCLE',
};
describe('Layout validation', () => {
  it('supports arbitrary area names, including configurable Indoor/Terrace examples', () => {
    for (const name of ['Indoor', 'Terrace', 'Garden', 'Floor 2'])
      expect(areaInputSchema.parse({ name }).name).toBe(name);
  });
  it.each([
    { width: 43 },
    { positionX: -1 },
    { positionY: 0.5 },
    { width: 1001 },
    { height: 90 },
    { number: 0 },
    { capacity: 101 },
    { positionX: 9999 },
    { shape: 'TRIANGLE' },
    { active: false },
    { status: 'OCCUPIED' },
    { branchId: table.areaId },
  ])('rejects invalid or injected table configuration %j', (extra) => {
    expect(tableInputSchema.safeParse({ ...table, ...extra }).success).toBe(false);
  });
  it('requires bounded canvas dimensions and versions', () => {
    expect(areaInputSchema.safeParse({ name: 'Area', canvasWidth: 199 }).success).toBe(false);
    expect(
      tableGeometrySchema.safeParse({
        positionX: 0,
        positionY: 0,
        width: 100,
        height: 100,
        shape: 'SQUARE',
        version: 2147483648,
      }).success,
    ).toBe(false);
  });
  it('reserves operational statuses for later phases', () => {
    expect(TABLE_STATUSES).toHaveLength(6);
    for (const status of ['OCCUPIED', 'ORDER_SENT', 'WAITING_PAYMENT'])
      expect(tableStatusSchema.safeParse({ version: 1, status }).success).toBe(false);
    expect(tableStatusSchema.parse({ version: 1, status: 'RESERVED' }).status).toBe('RESERVED');
  });
  it.each(['abc', '-1', '01', '1e2', '9223372036854775808', '9999999999999999999999'])(
    'safely rejects invalid event cursor %s',
    (after) => {
      expect(layoutChangesSchema.safeParse({ after }).success).toBe(false);
    },
  );
  it('preserves BIGINT cursor precision across JSON boundaries', () => {
    expect(layoutChangesSchema.parse({ after: '9007199254740993' }).after).toBe('9007199254740993');
  });
  it('separates configuration permission from status permission', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.ADMIN).toContain('layout.manage');
    expect(DEFAULT_ROLE_PERMISSIONS.MANAGER).toContain('layout.status.manage');
    expect(DEFAULT_ROLE_PERMISSIONS.MANAGER).not.toContain('layout.manage');
    expect(DEFAULT_ROLE_PERMISSIONS.WAITER).not.toContain('layout.manage');
  });
});
