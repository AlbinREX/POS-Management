// Phase 12 connectivity and retry standardization for the browser clients.
//
// Local server availability and public internet availability are separate failure
// domains and are never collapsed into a single "offline" state. Losing the internet
// does not affect restaurant operation; losing the local server pauses writes with an
// explicit message. Nothing here queues a write: a command is either sent to the
// authoritative local server or it is not sent at all.
import type { ConnectivityState, ConnectivitySummary, SyncHealth } from '@restaurant/shared-types';
import { ApiFailure } from './api';

/**
 * Classify a failed read. A rejected request that never reached the server (a network
 * error, so no `ApiFailure` status) means the local server is unreachable. An HTTP
 * status means the server answered, so the local link is fine even if the call failed.
 */
export function classifyFailure(error: unknown): ConnectivityState {
  if (error instanceof ApiFailure) return 'local-connected';
  return 'local-unavailable';
}

/**
 * The browser's own view of the public internet. `navigator.onLine` reports link-layer
 * connectivity only, so it can claim online behind a captive portal; it is therefore
 * used to report internet loss, never to decide whether local operation may proceed.
 */
export function internetState(online = typeof navigator === 'undefined' || navigator.onLine) {
  return online ? null : ('internet-unavailable' as const);
}

/**
 * Resolve the single state to display. Local availability always wins: an unreachable
 * restaurant server is the operationally important condition, and internet loss is
 * reported only while the local server is reachable.
 */
export function connectivityState(
  localReachable: boolean,
  online = typeof navigator === 'undefined' || navigator.onLine,
): ConnectivityState {
  if (!localReachable) return 'local-unavailable';
  return online ? 'local-connected' : 'internet-unavailable';
}

/** Compact operator-facing wording. Kept short enough for the application header. */
export function connectivityLabel(state: ConnectivityState): string {
  if (state === 'local-connected') return 'Restaurant server connected';
  if (state === 'local-unavailable') return 'Restaurant server unavailable';
  return 'No internet. Restaurant operation continues';
}

export function syncLabel(health: SyncHealth, pendingTotal: number): string {
  if (health === 'disabled') return 'Cloud sync not configured';
  if (health === 'failed') return 'Cloud sync failed. Local operation is unaffected';
  if (health === 'pending')
    return `Cloud sync pending: ${pendingTotal} record${pendingTotal === 1 ? '' : 's'}`;
  return 'Cloud sync healthy';
}

/** Severity drives the indicator colour; local loss is the only operational blocker. */
export function connectivityTone(state: ConnectivityState): 'ok' | 'warn' | 'bad' {
  if (state === 'local-unavailable') return 'bad';
  return state === 'internet-unavailable' ? 'warn' : 'ok';
}

export function syncTone(health: SyncHealth): 'ok' | 'warn' | 'bad' | 'idle' {
  if (health === 'disabled') return 'idle';
  if (health === 'failed') return 'bad';
  return health === 'pending' ? 'warn' : 'ok';
}

export const summary = (
  state: ConnectivityState,
  health: SyncHealth,
  pendingTotal: number,
): ConnectivitySummary => ({
  connectivity: state,
  sync: health,
  pendingTotal,
  checkedAt: new Date().toISOString(),
});
