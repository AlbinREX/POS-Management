import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, REPORT_KINDS } from '@restaurant/shared-types';
import { reportKindSchema, reportRangeSchema } from '@restaurant/validation';
import {
  dayRange,
  eachDay,
  localDate,
  localHour,
  localMidnightUtc,
  presetRange,
} from '../../apps/api/src/reporting/report-time';
import { csvCell, csvDocument, csvFilename } from '../../apps/api/src/reporting/report-csv';
import {
  averageMoney,
  compareMoney,
  maxMoney,
  minusMoney,
} from '../../apps/api/src/reporting/report-money';

const tz = 'Europe/Belgrade';
describe('branch-local report boundaries', () => {
  it('resolves local midnight to the correct UTC instant on both sides of DST', () => {
    expect(localMidnightUtc('2026-01-15', tz).toISOString()).toBe('2026-01-14T23:00:00.000Z');
    expect(localMidnightUtc('2026-07-15', tz).toISOString()).toBe('2026-07-14T22:00:00.000Z');
    expect(localMidnightUtc('2026-03-29', 'UTC').toISOString()).toBe('2026-03-29T00:00:00.000Z');
  });
  it('gives the spring-forward day 23 hours and the fall-back day 25 hours', () => {
    const spring = dayRange('2026-03-29', '2026-03-29', tz);
    expect((spring.to.getTime() - spring.from.getTime()) / 3600000).toBe(23);
    const fall = dayRange('2026-10-25', '2026-10-25', tz);
    expect((fall.to.getTime() - fall.from.getTime()) / 3600000).toBe(25);
  });
  it('uses a half-open interval so an instant belongs to exactly one day', () => {
    const range = dayRange('2026-06-01', '2026-06-02', tz);
    expect(range.from.toISOString()).toBe('2026-05-31T22:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-06-02T22:00:00.000Z');
    expect(localDate(new Date('2026-06-01T21:59:59.999Z'), tz)).toBe('2026-06-01');
    expect(localDate(new Date('2026-06-01T22:00:00.000Z'), tz)).toBe('2026-06-02');
    expect(localHour(new Date('2026-06-01T22:30:00.000Z'), tz)).toBe(0);
    expect(eachDay(range)).toEqual(['2026-06-01', '2026-06-02']);
  });
  it('anchors presets on the branch calendar, not the server clock', () => {
    // 23:30 UTC on a Sunday is already Monday in Belgrade.
    const now = new Date('2026-09-13T23:30:00.000Z');
    expect(presetRange('today', tz, now).fromDate).toBe('2026-09-14');
    expect(presetRange('today', 'UTC', now).fromDate).toBe('2026-09-13');
    expect(presetRange('yesterday', tz, now).fromDate).toBe('2026-09-13');
    const week = presetRange('week', tz, now);
    expect([week.fromDate, week.toDate]).toEqual(['2026-09-14', '2026-09-14']);
    const utcWeek = presetRange('week', 'UTC', now);
    expect([utcWeek.fromDate, utcWeek.toDate]).toEqual(['2026-09-07', '2026-09-13']);
    const month = presetRange('month', tz, now);
    expect([month.fromDate, month.toDate]).toEqual(['2026-09-01', '2026-09-14']);
  });
  it('rejects malformed dates, inverted ranges and unknown zones', () => {
    expect(() => localMidnightUtc('2026-13-01', tz)).toThrow();
    expect(() => localMidnightUtc('20260101', tz)).toThrow();
    expect(() => dayRange('2026-02-02', '2026-02-01', tz)).toThrow();
    expect(() => localMidnightUtc('2026-01-01', 'Mars/Olympus')).toThrow();
  });
});
describe('csv export', () => {
  it('quotes delimiters, quotes and newlines and neutralizes formula prefixes', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell(null)).toBe('');
    expect(csvCell(true)).toBe('true');
  });
  it('keeps decimal text exactly and negative money readable', () => {
    // A signed ledger figure starts with "-", which a spreadsheet would treat as a formula.
    expect(csvCell('1234.50')).toBe('1234.50');
    expect(csvCell('-20.00')).toBe("'-20.00");
    const csv = csvDocument(
      [
        { key: 'name', header: 'Name' },
        { key: 'total', header: 'Total' },
      ],
      [{ name: 'Burger, large', total: '0.10' }],
    );
    expect(csv).toBe('Name,Total\r\n"Burger, large",0.10\r\n');
  });
  it('builds a safe filename from the kind and range', () => {
    expect(csvFilename('sales', '2026-09-01', '2026-09-14')).toBe(
      'sales-2026-09-01-to-2026-09-14.csv',
    );
    expect(csvFilename('a/b c', '2026-01-01', '2026-01-01')).toBe(
      'a-b-c-2026-01-01-to-2026-01-01.csv',
    );
  });
});
describe('report money', () => {
  it('derives net sales, averages and comparisons without floating point', () => {
    expect(minusMoney('0.30', '0.10')).toBe('0.20');
    expect(minusMoney('100.00', '120.50')).toBe('-20.50');
    expect(averageMoney('10.00', 3)).toBe('3.33');
    expect(averageMoney('10.01', 2)).toBe('5.01');
    expect(averageMoney('10.00', 0)).toBe('0.00');
    expect(compareMoney('9.99', '10.00')).toBe(-1);
    expect(compareMoney('1000.00', '999.99')).toBe(1);
    expect(maxMoney('0.00', '-5.00')).toBe('0.00');
    expect(() => minusMoney('999999999999.99', '-1.00')).toThrow();
  });
});
describe('report inputs and permissions', () => {
  it('accepts presets and custom ranges but never client scope', () => {
    expect(reportRangeSchema.parse({}).preset).toBe('today');
    expect(
      reportRangeSchema.parse({ preset: 'custom', from: '2026-01-01', to: '2026-01-31' }).to,
    ).toBe('2026-01-31');
    expect(reportRangeSchema.safeParse({ branchId: 'x' }).success).toBe(false);
    expect(reportRangeSchema.safeParse({ organizationId: 'x' }).success).toBe(false);
    expect(reportRangeSchema.safeParse({ preset: 'custom' }).success).toBe(false);
    expect(
      reportRangeSchema.safeParse({ preset: 'today', from: '2026-01-01', to: '2026-01-02' })
        .success,
    ).toBe(false);
    expect(
      reportRangeSchema.safeParse({ preset: 'custom', from: '2026-01-02', to: '2026-01-01' })
        .success,
    ).toBe(false);
    expect(
      reportRangeSchema.safeParse({ preset: 'custom', from: '2026-02-30', to: '2026-03-01' })
        .success,
    ).toBe(false);
    expect(
      reportRangeSchema.safeParse({ preset: 'custom', from: '2025-01-01', to: '2026-01-03' })
        .success,
    ).toBe(false);
    expect(reportRangeSchema.safeParse({ limit: 1000 }).success).toBe(false);
    expect(reportKindSchema.safeParse('ledger').success).toBe(false);
    expect(REPORT_KINDS).toContain('companies');
  });
  it('grants report.read to owner, admin and manager only', () => {
    expect(PERMISSIONS).toContain('report.read');
    for (const role of ['OWNER', 'ADMIN', 'MANAGER'] as const)
      expect(DEFAULT_ROLE_PERMISSIONS[role]).toContain('report.read');
    for (const role of ['CASHIER', 'WAITER', 'KITCHEN', 'STOREKEEPER'] as const)
      expect(DEFAULT_ROLE_PERMISSIONS[role] ?? []).not.toContain('report.read');
  });
});
