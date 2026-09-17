import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS } from '@restaurant/shared-types';
import {
  BACKUP_CRITICAL_HOURS,
  BACKUP_WARN_HOURS,
  buildChecks,
  classifyBackup,
  classifyStorage,
  classifySync,
  hoursSince,
  worstSeverity,
} from '../../apps/api/src/ops/ops-state';

const NOW = new Date('2026-09-17T12:00:00.000Z');
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3600000).toISOString();

describe('operational severity aggregation', () => {
  it('surfaces the worst signal so a failure is never hidden by healthy ones', () => {
    expect(worstSeverity(['ok', 'ok'])).toBe('ok');
    expect(worstSeverity(['ok', 'warn', 'ok'])).toBe('warn');
    expect(worstSeverity(['warn', 'critical'])).toBe('critical');
    expect(worstSeverity(['ok', 'unknown'])).toBe('unknown');
    expect(worstSeverity(['unknown', 'warn'])).toBe('warn');
    expect(worstSeverity([])).toBe('ok');
  });
  it('measures age in whole hours and never reports a negative age', () => {
    expect(hoursSince(hoursAgo(5), NOW)).toBe(5);
    expect(hoursSince(hoursAgo(0.5), NOW)).toBe(0);
    // A future timestamp means the clocks disagree, not that the backup is negative-aged.
    expect(hoursSince(new Date(NOW.getTime() + 7200000).toISOString(), NOW)).toBe(0);
    expect(hoursSince(null, NOW)).toBeNull();
    expect(hoursSince('not-a-date', NOW)).toBeNull();
  });
});

describe('backup classification', () => {
  it('treats a recent successful archive as healthy', () => {
    const status = classifyBackup(
      {
        archive: 'restaurant-20260917T020000Z.dump',
        lastSuccessAt: hoursAgo(10),
        outcome: 'success',
        sizeBytes: 1024,
      },
      NOW,
    );
    expect(status.severity).toBe('ok');
    expect(status.ageHours).toBe(10);
    expect(status.archive).toBe('restaurant-20260917T020000Z.dump');
  });
  it('warns when a daily archive has been missed and escalates when two have', () => {
    expect(
      classifyBackup({ lastSuccessAt: hoursAgo(BACKUP_WARN_HOURS), outcome: 'success' }, NOW)
        .severity,
    ).toBe('warn');
    expect(
      classifyBackup({ lastSuccessAt: hoursAgo(BACKUP_CRITICAL_HOURS), outcome: 'success' }, NOW)
        .severity,
    ).toBe('critical');
  });
  it('is critical when the last attempt failed, even with a recent archive', () => {
    // Protection has stopped advancing; a recent archive must not mask that.
    const status = classifyBackup(
      {
        lastSuccessAt: hoursAgo(2),
        lastAttemptAt: hoursAgo(1),
        outcome: 'failed',
        error: 'pg_dump failed',
      },
      NOW,
    );
    expect(status.severity).toBe('critical');
    expect(status.error).toBe('pg_dump failed');
  });
  it('is critical when no backup has ever been recorded', () => {
    const missing = classifyBackup(null, NOW);
    expect(missing.severity).toBe('critical');
    expect(missing.outcome).toBe('unknown');
    expect(missing.ageHours).toBeNull();
    expect(classifyBackup({ outcome: 'success', lastSuccessAt: null }, NOW).severity).toBe(
      'critical',
    );
  });
});

describe('storage classification', () => {
  it('reports headroom and escalates as the volume fills', () => {
    expect(classifyStorage(500, 1000).severity).toBe('ok');
    expect(classifyStorage(500, 1000).freePercent).toBe(50);
    expect(classifyStorage(151, 1000).severity).toBe('ok');
    // The warn threshold is inclusive: exactly 15% free on a database volume already
    // deserves an operator's attention rather than passing as healthy.
    expect(classifyStorage(150, 1000).severity).toBe('warn');
    expect(classifyStorage(150, 1000).freePercent).toBe(15);
    expect(classifyStorage(50, 1000).severity).toBe('critical');
  });
  it('reports unknown rather than guessing when the platform gives no reading', () => {
    expect(classifyStorage(null, null).severity).toBe('unknown');
    expect(classifyStorage(100, 0).severity).toBe('unknown');
    expect(classifyStorage(null, 1000).freePercent).toBeNull();
  });
});

describe('sync backlog classification', () => {
  it('never escalates optional cloud delivery above a warning', () => {
    // Delivery never gates local operation; crying critical would train operators to
    // ignore the signal that does matter.
    expect(classifySync('disabled', 0)).toBe('ok');
    expect(classifySync('disabled', 999)).toBe('ok');
    expect(classifySync('healthy', 0)).toBe('ok');
    expect(classifySync('pending', 5)).toBe('warn');
    expect(classifySync('failed', 0)).toBe('warn');
  });
});

describe('operator-facing checks', () => {
  it('names every signal without leaking a credential or driver error', () => {
    const checks = buildChecks({
      database: 'ok',
      backup: classifyBackup({ lastSuccessAt: hoursAgo(3), outcome: 'success' }, NOW),
      sync: 'ok',
      storage: classifyStorage(800, 1000),
    });
    expect(checks.map((c) => c.id)).toEqual(['database', 'backup', 'sync', 'storage']);
    expect(checks.every((c) => c.summary.length > 0)).toBe(true);
    expect(checks.find((c) => c.id === 'backup')?.summary).toContain('3h ago');
    expect(checks.find((c) => c.id === 'storage')?.summary).toContain('80%');
    const joined = checks.map((c) => c.summary).join(' ');
    expect(joined).not.toMatch(/postgres(ql)?:\/\/|password|secret/i);
  });
  it('states plainly when no backup exists', () => {
    const checks = buildChecks({
      database: 'ok',
      backup: classifyBackup(null, NOW),
      sync: 'ok',
      storage: classifyStorage(null, null),
    });
    expect(checks.find((c) => c.id === 'backup')?.summary).toMatch(/No successful backup/i);
    expect(checks.find((c) => c.id === 'storage')?.summary).toMatch(/not reported/i);
  });
});

describe('operational permission defaults', () => {
  it('registers ops.read and grants it only to owner, admin and manager', () => {
    expect(PERMISSIONS).toContain('ops.read');
    for (const role of ['OWNER', 'ADMIN', 'MANAGER'] as const)
      expect(DEFAULT_ROLE_PERMISSIONS[role]).toContain('ops.read');
    for (const role of ['CASHIER', 'WAITER', 'KITCHEN', 'STOREKEEPER'] as const)
      expect(DEFAULT_ROLE_PERMISSIONS[role]).not.toContain('ops.read');
  });
});
