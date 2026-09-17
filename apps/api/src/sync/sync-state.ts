// Pure sync-state derivation. No database, no clock, no I/O, so the rules that decide
// what an operator is told are unit-testable in isolation.
import type { SyncHealth, SyncStreamStatus } from '@restaurant/shared-types';

/** Records committed locally but not yet confirmed delivered. Never negative. */
export function pendingCount(localRevision: string, deliveredRevision: string): number {
  const local = BigInt(localRevision);
  const delivered = BigInt(deliveredRevision);
  // A checkpoint ahead of the local log means a restored or rebuilt database. Report
  // zero pending rather than a negative backlog, and never treat it as a reason to
  // reprocess local history.
  if (delivered >= local) return 0;
  const behind = local - delivered;
  // Clamp to a safe integer: the exact figure beyond this is not operationally useful.
  return behind > 1000000n ? 1000000 : Number(behind);
}

/**
 * Health is deliberately conservative: a failure is reported even when the backlog is
 * empty, because a silent delivery error must never look healthy. Delivery state never
 * affects whether local operations may proceed.
 */
export function syncHealth(streams: SyncStreamStatus[], enabled: boolean): SyncHealth {
  if (!enabled) return 'disabled';
  if (streams.some((s) => s.lastError !== null)) return 'failed';
  return streams.some((s) => s.pending > 0) ? 'pending' : 'healthy';
}

/** True when any stream recorded a delivery failure on its last attempt. */
export const isDegraded = (streams: SyncStreamStatus[]) =>
  streams.some((s) => s.lastError !== null);

/** Total backlog across streams, clamped the same way as a single stream. */
export const pendingTotal = (streams: SyncStreamStatus[]) =>
  Math.min(
    streams.reduce((total, s) => total + s.pending, 0),
    1000000,
  );

/**
 * Exponential backoff for a failing cloud target, in milliseconds. Delivery is optional
 * and must never hot-loop against an unreachable endpoint or starve the local database
 * connection pool.
 */
export function backoffMs(failedAttempts: number, baseMs = 5000, capMs = 300000): number {
  if (failedAttempts <= 0) return baseMs;
  const exponent = Math.min(failedAttempts, 20);
  const delay = baseMs * 2 ** exponent;
  return Math.min(delay, capMs);
}
