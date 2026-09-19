/**
 * Pure device and print-delivery logic.
 *
 * No I/O, no Nest, no database: everything here is a decision that can be reasoned about
 * and tested directly. The service applies these decisions inside its transactions.
 */
import type {
  DeviceConnection,
  DeviceKind,
  DeviceStatus,
  PrintJobState,
  PrinterKind,
} from '@restaurant/shared-types';

/** A device is considered present if it reported in within this window. */
export const DEVICE_STALE_MS = 2 * 60 * 1000;
/** The agent is considered reachable if it reported in within this window. */
export const AGENT_STALE_MS = 60 * 1000;

/** A job may be attempted only from a state that is not already settled. */
export const canAttempt = (state: PrintJobState) =>
  state === 'PENDING' || state === 'FAILED' || state === 'RETRY_REQUIRED';

/** CONFIRMED is terminal: a delivered document is never re-delivered automatically. */
export const isTerminal = (state: PrintJobState) => state === 'CONFIRMED';

/**
 * The state one delivery attempt produces.
 *
 * A retryable failure stays actionable; a permanent one stops, so an operator is not
 * invited to retry something that will never succeed.
 */
export function nextJobState(delivered: boolean, retryable: boolean): PrintJobState {
  if (delivered) return 'CONFIRMED';
  return retryable ? 'RETRY_REQUIRED' : 'FAILED';
}

/** Exponential backoff between automatic attempts, capped so it stays responsive. */
export function retryDelayMs(attempts: number): number {
  const base = 5_000;
  const capped = Math.min(attempts, 6);
  return Math.min(base * 2 ** Math.max(0, capped - 1), 300_000);
}

/**
 * How a device is presented to an operator.
 *
 * Disabled is a configuration fact and outranks reachability: a switched-off device is
 * not "offline", it is deliberately not in use. Otherwise status reflects what was last
 * observed, and a device that has never reported is UNKNOWN rather than assumed good.
 */
export function deviceStatus(
  device: { enabled: boolean; lastSeenAt: Date | string | null; lastError: string | null },
  now: Date = new Date(),
): DeviceStatus {
  if (!device.enabled) return 'DISABLED';
  if (!device.lastSeenAt) return 'UNKNOWN';
  const seen = device.lastSeenAt instanceof Date ? device.lastSeenAt : new Date(device.lastSeenAt);
  if (Number.isNaN(seen.getTime())) return 'UNKNOWN';
  if (now.getTime() - seen.getTime() > DEVICE_STALE_MS) return 'OFFLINE';
  return device.lastError ? 'OFFLINE' : 'ONLINE';
}

/** Human-readable address for the operator list, e.g. "COM3" or "192.168.1.50:9100". */
export function deviceAddress(device: {
  connection: DeviceConnection;
  port: string | null;
  host: string | null;
  tcpPort: number | null;
  windowsPrinterName: string | null;
}): string {
  switch (device.connection) {
    case 'SERIAL':
      return device.port ?? '';
    case 'USB':
      return device.port ?? device.windowsPrinterName ?? '';
    case 'WINDOWS_PRINTER':
      return device.windowsPrinterName ?? '';
    case 'NETWORK':
      return device.host ? `${device.host}:${device.tcpPort ?? 9100}` : '';
  }
}

/** Only a printer kind may receive a print job; an NFC reader never can. */
export function printerKindFor(kind: DeviceKind): PrinterKind | null {
  return kind === 'NFC_READER' ? null : kind;
}

/**
 * Why a device cannot accept a job right now, or null when it can.
 *
 * Returned as a sentence an operator can act on, naming the device, because "print
 * failed" on a busy service tells nobody which machine to go and look at.
 */
export function deviceUnavailableReason(device: {
  name: string;
  /** Widened to string because the column is a checked VARCHAR, not a database enum. */
  kind: string;
  enabled: boolean;
  deletedAt: Date | null;
}): string | null {
  if (device.deletedAt) return `${device.name} has been removed`;
  if (!device.enabled) return `${device.name} is disabled`;
  if (device.kind === 'NFC_READER') return `${device.name} is a card reader, not a printer`;
  return null;
}

/** Summary counters for the operator overview. */
export function summarizeJobs(states: PrintJobState[]) {
  const counts = { pending: 0, failed: 0, confirmed: 0 };
  for (const state of states) {
    if (state === 'CONFIRMED') counts.confirmed += 1;
    else if (state === 'FAILED') counts.failed += 1;
    else counts.pending += 1;
  }
  return counts;
}

/**
 * Operational severity of the device estate, in the vocabulary Phase 13 ops already uses.
 *
 * An unrouted station or a failed job is a warning rather than critical: printing is
 * downstream of the sale, and reporting it as critical would train staff to ignore the
 * signal that actually matters.
 */
export function deviceSeverity(input: {
  offlineDevices: number;
  unroutedStations: number;
  failedJobs: number;
}): 'ok' | 'warn' | 'critical' {
  if (input.offlineDevices || input.unroutedStations || input.failedJobs) return 'warn';
  return 'ok';
}
