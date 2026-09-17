// Pure operational-state classification. No I/O, no clock beyond an injected instant, so
// the thresholds an operator is judged by are unit-testable in isolation.
import type { BackupStatus, OpsCheck, OpsSeverity, StorageStatus } from '@restaurant/shared-types';

/** A backup older than this is stale; a daily schedule leaves ample margin. */
export const BACKUP_WARN_HOURS = 26;
export const BACKUP_CRITICAL_HOURS = 50;
/** Disk headroom below these fractions threatens writes and the next archive. */
export const STORAGE_WARN_PERCENT = 15;
export const STORAGE_CRITICAL_PERCENT = 5;

const SEVERITY_ORDER: Record<OpsSeverity, number> = { ok: 0, unknown: 1, warn: 2, critical: 3 };

/** The worst severity present, so one bad signal is never hidden by healthy ones. */
export function worstSeverity(values: OpsSeverity[]): OpsSeverity {
  return values.reduce<OpsSeverity>(
    (worst, value) => (SEVERITY_ORDER[value] > SEVERITY_ORDER[worst] ? value : worst),
    'ok',
  );
}

export function hoursSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  // A timestamp in the future means a clock disagreement, not negative age.
  return Math.max(0, Math.floor((now.getTime() - then) / 3600000));
}

/**
 * Classify the backup signal.
 *
 * A failed last attempt is critical even when a recent archive exists, because the
 * operator must know that protection has stopped advancing. Never having produced an
 * archive is also critical: an unbacked-up restaurant is the worst state in this system.
 */
export function classifyBackup(
  raw: {
    archive?: string | null;
    lastSuccessAt?: string | null;
    lastAttemptAt?: string | null;
    sizeBytes?: number | null;
    outcome?: string | null;
    error?: string | null;
  } | null,
  now: Date,
): BackupStatus {
  if (!raw)
    return {
      severity: 'critical',
      archive: null,
      lastSuccessAt: null,
      lastAttemptAt: null,
      ageHours: null,
      sizeBytes: null,
      outcome: 'unknown',
      error: 'No backup has been recorded. Run scripts/backup.ps1 and schedule it.',
    };
  const outcome =
    raw.outcome === 'success' ? 'success' : raw.outcome === 'failed' ? 'failed' : 'unknown';
  const ageHours = hoursSince(raw.lastSuccessAt ?? null, now);
  let severity: OpsSeverity = 'ok';
  if (outcome === 'failed') severity = 'critical';
  else if (ageHours === null) severity = 'critical';
  else if (ageHours >= BACKUP_CRITICAL_HOURS) severity = 'critical';
  else if (ageHours >= BACKUP_WARN_HOURS) severity = 'warn';
  else if (outcome === 'unknown') severity = 'unknown';
  return {
    severity,
    archive: raw.archive ?? null,
    lastSuccessAt: raw.lastSuccessAt ?? null,
    lastAttemptAt: raw.lastAttemptAt ?? null,
    ageHours,
    sizeBytes: typeof raw.sizeBytes === 'number' ? raw.sizeBytes : null,
    outcome,
    error: raw.error ?? null,
  };
}

export function classifyStorage(free: number | null, total: number | null): StorageStatus {
  if (free === null || total === null || total <= 0)
    return { severity: 'unknown', freeBytes: free, totalBytes: total, freePercent: null };
  const freePercent = Math.round((free / total) * 1000) / 10;
  const severity: OpsSeverity =
    freePercent <= STORAGE_CRITICAL_PERCENT
      ? 'critical'
      : freePercent <= STORAGE_WARN_PERCENT
        ? 'warn'
        : 'ok';
  return { severity, freeBytes: free, totalBytes: total, freePercent };
}

/**
 * Delivery backlog severity. Cloud delivery is optional and never gates local operation,
 * so a backlog is at most a warning: reporting it as critical would train operators to
 * ignore the signal that actually matters.
 */
export function classifySync(health: string, pendingTotal: number): OpsSeverity {
  if (health === 'disabled') return 'ok';
  if (health === 'failed') return 'warn';
  return pendingTotal > 0 ? 'warn' : 'ok';
}

export function buildChecks(parts: {
  database: OpsSeverity;
  backup: BackupStatus;
  sync: OpsSeverity;
  storage: StorageStatus;
}): OpsCheck[] {
  const backupSummary =
    parts.backup.outcome === 'failed'
      ? 'The last backup attempt failed. Protection is not advancing.'
      : parts.backup.ageHours === null
        ? 'No successful backup has been recorded.'
        : `Last successful backup ${parts.backup.ageHours}h ago.`;
  const storageSummary =
    parts.storage.freePercent === null
      ? 'Storage headroom is not reported on this platform.'
      : `${parts.storage.freePercent}% of the data volume is free.`;
  return [
    {
      id: 'database',
      severity: parts.database,
      summary:
        parts.database === 'ok' ? 'Local database reachable.' : 'Local database is not reachable.',
    },
    { id: 'backup', severity: parts.backup.severity, summary: backupSummary },
    {
      id: 'sync',
      severity: parts.sync,
      summary:
        parts.sync === 'ok'
          ? 'Cloud delivery is healthy or intentionally disabled.'
          : 'Cloud delivery is pending or failing. Local operation is unaffected.',
    },
    { id: 'storage', severity: parts.storage.severity, summary: storageSummary },
  ];
}
