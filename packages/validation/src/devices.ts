import { z } from 'zod';
import { DEVICE_KINDS, PRINT_JOB_STATES } from '@restaurant/shared-types';

/**
 * Device configuration input.
 *
 * Every address a device may be reached at is entered here, by an operator holding
 * device.manage, and is then owned by the server. No other route accepts a COM port, a
 * host or a TCP port: a print or test request names a saved device by id, and the server
 * supplies the address. That is what stops a client pointing the restaurant's printer at
 * an arbitrary machine.
 *
 * Branch and organization are never accepted from a client; they come from the session.
 */

/**
 * A Windows serial port name. Deliberately narrow: COM1-COM256 only, so nothing that
 * could be read as a path, a device namespace escape or a shell argument is storable.
 */
const serialPort = z
  .string()
  .trim()
  .regex(/^COM([1-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-6])$/, 'Use a COM port name such as COM3');

/** Standard serial rates. An arbitrary integer is rejected rather than coerced. */
const baudRate = z.union([
  z.literal(9600),
  z.literal(19200),
  z.literal(38400),
  z.literal(57600),
  z.literal(115200),
]);

/**
 * A private-network host for a LAN printer.
 *
 * Only a literal IPv4 address in a private range, or a plain hostname label, is allowed.
 * A public address, a URL, credentials, a port suffix or a path are all rejected, so a
 * saved destination cannot be used to reach the internet or to smuggle a scheme.
 */
const privateIpv4 = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,3}){3}$/, 'Use an IPv4 address such as 192.168.1.50')
  .refine((value) => {
    const parts = value.split('.').map(Number);
    if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    const [a, b] = parts as [number, number, number, number];
    // RFC1918 and link-local only. A restaurant printer is never on a public address,
    // and refusing one here means a misconfiguration cannot become an egress channel.
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }, 'Use a private LAN address (10.x, 172.16-31.x, 192.168.x or 169.254.x)');

const hostname = z
  .string()
  .trim()
  .min(1)
  .max(63)
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i, 'Use a plain hostname label without dots or scheme');

const networkHost = z.union([privateIpv4, hostname]);

/** Raw printing is conventionally 9100; the range is bounded and never privileged. */
const tcpPort = z.coerce.number().int().min(1024).max(65535);

/** A Windows spooler queue name. No path separators, so it cannot name a file. */
const windowsPrinterName = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[^\\/:*?"<>|]+$/, 'Use the Windows printer queue name');

const base = {
  name: z.string().trim().min(1).max(100),
  kind: z.enum(DEVICE_KINDS),
  terminalId: z.uuid().nullable().default(null),
  enabled: z.boolean().default(true),
};

/**
 * Connection-specific fields are required together and forbidden apart, so a device row
 * can never be half-addressed: a SERIAL device always has a port, a NETWORK device
 * always has a host and port, and neither carries the other's fields.
 */
export const deviceInputSchema = z
  .discriminatedUnion('connection', [
    z
      .object({
        ...base,
        connection: z.literal('SERIAL'),
        port: serialPort,
        baudRate: baudRate.default(9600),
      })
      .strict(),
    z
      .object({
        ...base,
        connection: z.literal('USB'),
        // A USB printer is presented to Windows either as a virtual COM port or as a
        // spooler queue; whichever it is, it is named explicitly.
        port: serialPort.nullable().default(null),
        windowsPrinterName: windowsPrinterName.nullable().default(null),
      })
      .strict()
      .refine(
        (v) => Boolean(v.port) !== Boolean(v.windowsPrinterName),
        'Give either a COM port or a Windows printer name, not both',
      ),
    z
      .object({ ...base, connection: z.literal('WINDOWS_PRINTER'), windowsPrinterName })
      .strict(),
    z
      .object({
        ...base,
        connection: z.literal('NETWORK'),
        host: networkHost,
        tcpPort: tcpPort.default(9100),
      })
      .strict(),
  ])
  .refine(
    (v) => v.connection !== 'NETWORK' || v.kind !== 'NFC_READER',
    'An NFC reader is a local device, not a network device',
  );

export const deviceUpdateSchema = z
  .object({ version: z.number().int().min(1).max(2147483647), data: deviceInputSchema })
  .strict();

export const deviceListSchema = z
  .object({ kind: z.enum(DEVICE_KINDS).optional(), enabled: z.enum(['true', 'false']).optional() })
  .strict();

/**
 * The outcome of a Test press, as observed by the Device Agent.
 *
 * A test names no address: the operator pressed Test on a saved device, the agent probed
 * the address the server holds for it, and this reports what happened.
 */
export const deviceTestSchema = z
  .object({ ok: z.boolean(), error: z.string().trim().max(500).optional() })
  .strict();

/** Binding a station to a saved printer, or clearing the binding with null. */
export const stationPrinterSchema = z
  .object({ stationId: z.uuid(), deviceId: z.uuid().nullable() })
  .strict();

export const printJobListSchema = z
  .object({ state: z.enum(PRINT_JOB_STATES).optional() })
  .strict();

/** A reprint names an existing job; the document is rebuilt from immutable records. */
export const printRetrySchema = z.object({ commandId: z.uuid() }).strict();

/**
 * Result the Device Agent reports for one delivery attempt.
 *
 * The agent is trusted to report only what happened; it cannot name a different job or
 * invent a document. `retryable` separates a transient condition, such as a printer that
 * is switched off, from a permanent one a human must resolve.
 */
export const printResultSchema = z
  .object({
    jobId: z.uuid(),
    delivered: z.boolean(),
    retryable: z.boolean().default(true),
    error: z.string().trim().max(500).optional(),
  })
  .strict();

/**
 * NFC enrolment. The agent sends the credential it read; the server hashes it and binds
 * it to the named user. The raw value is never stored and never returned.
 */
export const nfcEnrollSchema = z
  .object({
    commandId: z.uuid(),
    userId: z.uuid(),
    credential: z.string().trim().min(4).max(256),
    label: z.string().trim().min(1).max(60).default('Staff card'),
  })
  .strict();

/**
 * NFC sign-in. The client supplies the card and the branch it is standing in, never a
 * user, a role or a permission: the server resolves identity from the credential.
 */
export const nfcLoginSchema = z
  .object({
    organization: z.string().trim().min(1).max(80),
    branch: z.string().trim().min(1).max(40),
    credential: z.string().trim().min(4).max(256),
    terminalId: z.uuid().optional(),
  })
  .strict();

/**
 * A manager override. The card alone is not enough: a PIN is required, so a cloned UID
 * cannot authorise a sensitive action on its own.
 */
export const managerOverrideSchema = z
  .object({
    credential: z.string().trim().min(4).max(256),
    pin: z.string().trim().min(4).max(32),
    action: z.string().trim().min(1).max(100),
  })
  .strict();

/** Setting or clearing a manager PIN for an enrolled card. */
export const managerPinSchema = z
  .object({ commandId: z.uuid(), userId: z.uuid(), pin: z.string().trim().min(4).max(32) })
  .strict();

export type DeviceInput = z.infer<typeof deviceInputSchema>;
export type StationPrinterInput = z.infer<typeof stationPrinterSchema>;
export type PrintResultInput = z.infer<typeof printResultSchema>;
export type NfcEnrollInput = z.infer<typeof nfcEnrollSchema>;
export type NfcLoginInput = z.infer<typeof nfcLoginSchema>;
export type ManagerOverrideInput = z.infer<typeof managerOverrideSchema>;
