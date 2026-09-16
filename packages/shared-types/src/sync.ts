// Phase 12 local-first and synchronization contracts.
//
// The local restaurant server is authoritative. These types describe the *delivery*
// state of already-committed local records to an optional cloud consumer; they never
// describe a source of truth that can overwrite local business state.

/** The seven durable per-module event logs that act as the local outbox. */
export const SYNC_STREAMS = [
  'layout',
  'orders',
  'kitchen',
  'payments',
  'inventory',
  'purchasing',
  'companies',
] as const;
export type SyncStream = (typeof SYNC_STREAMS)[number];

/**
 * Health of outbound delivery for one branch.
 * - `healthy`: every stream is delivered up to its latest local revision.
 * - `pending`: local records are waiting to be delivered; local operation is unaffected.
 * - `failed`: the last delivery attempt errored. Local operation is still unaffected.
 * - `disabled`: no cloud target is configured, which is the default deployment.
 */
export type SyncHealth = 'healthy' | 'pending' | 'failed' | 'disabled';

/**
 * What the client can reach. Local availability and internet availability are separate
 * failure domains and are never collapsed into a single "offline" state.
 */
export type ConnectivityState = 'local-connected' | 'local-unavailable' | 'internet-unavailable';

export interface SyncStreamStatus {
  stream: SyncStream;
  /** Latest revision committed locally for this branch and stream. */
  localRevision: string;
  /** Latest revision confirmed delivered. Never ahead of `localRevision`. */
  deliveredRevision: string;
  /** Records committed locally but not yet confirmed delivered. */
  pending: number;
  lastDeliveredAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  failedAttempts: number;
}

export interface SyncStatus {
  /** Always true in this phase: the local server owns live operations. */
  localAuthoritative: boolean;
  health: SyncHealth;
  /** False when no cloud target is configured; delivery is then intentionally inert. */
  enabled: boolean;
  branchId: string;
  organizationId: string;
  serverTime: string;
  pendingTotal: number;
  streams: SyncStreamStatus[];
  /** True when at least one stream recorded a delivery failure. */
  degraded: boolean;
}

/** Compact client-facing summary shown in the application header. */
export interface ConnectivitySummary {
  connectivity: ConnectivityState;
  sync: SyncHealth;
  pendingTotal: number;
  checkedAt: string;
}
