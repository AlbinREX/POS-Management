// Phase 13 operational status contracts.
//
// Read-only operational visibility for owners and administrators: is the database
// reachable, is the backup recent and did it succeed, is Phase 12 delivery backed up,
// and is the machine running out of disk. Nothing here exposes credentials, connection
// strings, archive contents or business data.

/** Severity shared by every operational signal, so one rule renders them all. */
export type OpsSeverity = 'ok' | 'warn' | 'critical' | 'unknown';

export interface OpsCheck {
  /** Stable identifier: `database`, `backup`, `sync` or `storage`. */
  id: string;
  severity: OpsSeverity;
  /** Operator-facing sentence. Never contains a secret or a raw error from the driver. */
  summary: string;
}

export interface BackupStatus {
  severity: OpsSeverity;
  /** Most recent successful archive name, or null when none has ever succeeded. */
  archive: string | null;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  /** Whole hours since the last successful archive; null when there is none. */
  ageHours: number | null;
  sizeBytes: number | null;
  /** Outcome of the most recent attempt as recorded by the backup script. */
  outcome: 'success' | 'failed' | 'unknown';
  /** Failure text from the backup script, already free of credentials. */
  error: string | null;
}

export interface StorageStatus {
  severity: OpsSeverity;
  /** Null when the platform gives the container no usable reading. */
  freeBytes: number | null;
  totalBytes: number | null;
  freePercent: number | null;
}

export interface OpsStatus {
  severity: OpsSeverity;
  serverTime: string;
  /** Always true: the local server owns live operations. */
  localAuthoritative: boolean;
  nodeEnv: string;
  /** Uptime of this API process in whole seconds. */
  uptimeSeconds: number;
  database: { severity: OpsSeverity; reachable: boolean; latencyMs: number | null };
  backup: BackupStatus;
  /** Phase 12 delivery backlog for the session's branch. */
  sync: { severity: OpsSeverity; health: string; pendingTotal: number; degraded: boolean };
  storage: StorageStatus;
  checks: OpsCheck[];
}
