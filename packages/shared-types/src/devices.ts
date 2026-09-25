/**
 * Phase 15 device management contracts.
 *
 * FastFood Riza runs on one Windows PC: the POS, the local API, PostgreSQL and every
 * hardware integration share that machine. These types describe how a device is
 * configured and how a document is delivered to it; they describe no wire protocol,
 * because the physical printer and NFC models are not yet known. The adapters that will
 * speak those protocols live behind the Device Agent boundary.
 *
 * Nothing here carries a credential. An NFC card is stored only as a hash, and a device
 * address is configuration owned by the server, never a value a client may supply.
 */

/** What a device is for. The kind fixes how it is addressed and what it may print. */
export const DEVICE_KINDS = [
  'RECEIPT_PRINTER',
  'KITCHEN_PRINTER',
  'BAR_PRINTER',
  'NFC_READER',
] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

/** How the Device Agent reaches the hardware. */
export const DEVICE_CONNECTIONS = ['SERIAL', 'USB', 'WINDOWS_PRINTER', 'NETWORK'] as const;
export type DeviceConnection = (typeof DEVICE_CONNECTIONS)[number];

/** Printers are the only kinds a print job may target. */
export const PRINTER_KINDS = ['RECEIPT_PRINTER', 'KITCHEN_PRINTER', 'BAR_PRINTER'] as const;
export type PrinterKind = (typeof PRINTER_KINDS)[number];
export const isPrinterKind = (kind: DeviceKind): kind is PrinterKind =>
  (PRINTER_KINDS as readonly string[]).includes(kind);

/**
 * Delivery state of one document to one device.
 *
 * Deliberately the same vocabulary as the fiscal handoff: an operator who has learned
 * one delivery surface can read the other. CONFIRMED is terminal.
 */
export const PRINT_JOB_STATES = [
  'PENDING',
  'SENT',
  'CONFIRMED',
  'FAILED',
  'RETRY_REQUIRED',
] as const;
export type PrintJobState = (typeof PRINT_JOB_STATES)[number];

/** Live reachability of a device as last observed. Never inferred from configuration. */
export const DEVICE_STATUSES = ['ONLINE', 'OFFLINE', 'UNKNOWN', 'DISABLED'] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

export interface DeviceRecord {
  id: string;
  kind: DeviceKind;
  name: string;
  connection: DeviceConnection;
  /** Serial port name, e.g. COM3. Never defaulted: an unset port means unconfigured. */
  port: string | null;
  baudRate: number | null;
  /** Host or IP for a network printer. Stored only from an authorized configuration. */
  host: string | null;
  tcpPort: number | null;
  /** Windows spooler queue name, when the connection is WINDOWS_PRINTER. */
  windowsPrinterName: string | null;
  /** The workstation this device is physically attached to, when it is a local device. */
  terminalId: string | null;
  terminalName: string | null;
  enabled: boolean;
  status: DeviceStatus;
  lastSeenAt: string | null;
  lastTestAt: string | null;
  /** Operator-facing reason for the last failure. Never a driver or stack trace. */
  lastError: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** A station's printer binding. Several stations may intentionally share one printer. */
export interface StationPrinterRecord {
  stationId: string;
  stationName: string;
  deviceId: string | null;
  deviceName: string | null;
  /** True when the station has no printer bound, so its tickets cannot be delivered. */
  unrouted: boolean;
}

export interface PrintJobRecord {
  id: string;
  /**
   * The document's identity, which is also the idempotency key. For a kitchen ticket
   * this is the existing print contract's documentId, so an original and a cancellation
   * are distinct documents and a reprint of the same document is never a duplicate.
   */
  documentId: string;
  kind: PrinterKind;
  deviceId: string | null;
  deviceName: string | null;
  state: PrintJobState;
  attempts: number;
  lastError: string | null;
  lastAttemptAt: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Operator summary for Settings → Devices. */
export interface DeviceOverview {
  devices: DeviceRecord[];
  stations: StationPrinterRecord[];
  /** Jobs still awaiting delivery, newest first. */
  unresolvedJobs: PrintJobRecord[];
  /** True when the Device Agent has reported in recently enough to be trusted. */
  agentReachable: boolean;
  agentLastSeenAt: string | null;
}

/**
 * A customer receipt.
 *
 * Unlike the kitchen contract, which is deliberately money-free, a receipt exists to
 * show money. Amounts are the exact decimal strings the API already stores; they are
 * never re-derived, re-rounded or locale-formatted here.
 *
 * This is NOT a fiscal document. FastFood Riza does not fiscalize; EnterNet's F-LINK
 * owns fiscal numbering, signing and receipt format. Nothing in this type may be
 * presented as a fiscal receipt.
 */
export interface ReceiptPrintContract {
  schemaVersion: 1;
  kind: 'CUSTOMER_RECEIPT';
  documentId: string;
  branchName: string;
  orderNumber: string;
  orderType: 'DINE_IN' | 'TAKEAWAY';
  tableName: string | null;
  areaName: string | null;
  cashierName: string | null;
  settledAt: string;
  currency: string;
  lines: {
    productName: string;
    quantity: number;
    unitPrice: string;
    total: string;
    modifiers: { groupName: string; name: string }[];
  }[];
  subtotal: string;
  discount: string;
  tax: string;
  total: string;
  tenders: { method: string; amount: string; tendered: string | null; change: string | null }[];
  /** Stated on every receipt so it is never mistaken for a fiscal document. */
  notice: string;
}

/** What the Device Agent reports about itself. Contains no credential and no address. */
export interface DeviceAgentStatus {
  agent: 'riza-device-agent';
  version: string;
  /** Adapters the running agent can actually drive. */
  capabilities: string[];
  serverTime: string;
}

/** A device the agent found on this machine, offered as a configuration choice. */
export interface DiscoveredDevice {
  connection: DeviceConnection;
  /** COM port name or Windows queue name. */
  identifier: string;
  description: string | null;
}
export interface DiscoveryResult {
  serialPorts: DiscoveredDevice[];
  windowsPrinters: DiscoveredDevice[];
  /** Present when discovery could not run, e.g. the agent is not installed. */
  unavailable: string | null;
}
