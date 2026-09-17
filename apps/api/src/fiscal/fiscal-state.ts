// Fiscal handoff state rules. Pure: no database, no clock, no I/O.
//
// This state describes delivery of a sale to an external fiscal provider. It never
// describes financial truth. A settlement is PAID because the payment transaction
// committed, and nothing in this file can change that.
import type { FiscalDeliveryResult } from './fiscal-provider';
import type { FiscalHandoffState } from '@restaurant/shared-types';

/** States an operator still has to resolve. CONFIRMED and SENT are not actionable. */
export const UNRESOLVED_STATES: FiscalHandoffState[] = ['PENDING', 'FAILED', 'RETRY_REQUIRED'];

/** A confirmed handoff is terminal: it is never re-sent and never reopened. */
export const isTerminal = (state: FiscalHandoffState) => state === 'CONFIRMED';

/**
 * Whether a handoff may be attempted now.
 *
 * CONFIRMED is excluded so a delivered sale can never be handed off twice. SENT is
 * excluded because an attempt is already in flight; resolving it requires a provider
 * answer, not a second concurrent send.
 */
export function canAttempt(state: FiscalHandoffState): boolean {
  return state === 'PENDING' || state === 'FAILED' || state === 'RETRY_REQUIRED';
}

/**
 * Next state after a delivery attempt.
 *
 * A retryable failure becomes RETRY_REQUIRED, which an operator or a later attempt can
 * act on. A permanent rejection becomes FAILED and stays visible until a human resolves
 * it; it is never silently dropped and never marks the sale as anything other than what
 * it is, which is paid.
 */
export function nextState(result: FiscalDeliveryResult): FiscalHandoffState {
  if (result.status === 'confirmed') return 'CONFIRMED';
  return result.retryable ? 'RETRY_REQUIRED' : 'FAILED';
}

/**
 * Guard for a transition. A confirmed handoff is immutable, so any attempt to move it is
 * refused rather than overwritten: a provider that answers twice must not be able to
 * erase the first confirmation.
 */
export function canTransition(from: FiscalHandoffState, to: FiscalHandoffState): boolean {
  if (from === 'CONFIRMED') return false;
  return FISCAL_ORDER.includes(to);
}

const FISCAL_ORDER: FiscalHandoffState[] = [
  'PENDING',
  'SENT',
  'CONFIRMED',
  'FAILED',
  'RETRY_REQUIRED',
];

/**
 * Exponential backoff before another automatic attempt, in milliseconds. Bounded so an
 * unreachable device is not hammered and the local API is never starved by retries.
 */
export function retryDelayMs(attempts: number, baseMs = 30000, capMs = 900000): number {
  if (attempts <= 0) return baseMs;
  return Math.min(baseMs * 2 ** Math.min(attempts, 20), capMs);
}

/** Summary counts for the operator view, with every state always present. */
export function summarize(states: FiscalHandoffState[]): Record<FiscalHandoffState, number> {
  const counts: Record<FiscalHandoffState, number> = {
    PENDING: 0,
    SENT: 0,
    CONFIRMED: 0,
    FAILED: 0,
    RETRY_REQUIRED: 0,
  };
  for (const state of states) counts[state] += 1;
  return counts;
}

export const unresolvedCount = (counts: Record<FiscalHandoffState, number>) =>
  UNRESOLVED_STATES.reduce((total, state) => total + counts[state], 0);
