/**
 * The FastFood Riza Device Agent.
 *
 * A small service on the restaurant's Windows PC that owns every piece of hardware: the
 * receipt printer, the NFC reader and the kitchen and bar printers on the LAN. The API
 * runs in a container with no outbound network access and deliberately keeps it that
 * way, so this process is the only thing that ever opens a port or a COM handle.
 *
 * Security posture, in order of importance:
 *
 *  1. It binds 127.0.0.1 only. Never 0.0.0.0, so nothing on the restaurant LAN or the
 *     internet can reach it even if the PC's firewall is open.
 *  2. Every request carries a shared token, compared in constant time.
 *  3. Only the origin the POS is served from may call it, enforced on the preflight and
 *     on the request itself.
 *  4. Commands are an allowlist of five. There is no shell, no file path, no arbitrary
 *     COM port and no arbitrary network destination in any request body.
 *  5. A target address is never taken from the caller. The caller names a device id; the
 *     agent asks the API for that device's saved address and uses what it is given.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { adapterFor, NetworkPrinterAdapter, NfcReaderAdapter, type DeviceTarget } from './adapters';

export interface AgentOptions {
  /** Fixed loopback port the POS is configured to call. */
  port: number;
  /** Shared secret, provisioned alongside the agent on the same machine. */
  token: string;
  /** The exact POS origin permitted to call this agent. */
  allowedOrigin: string;
  /** Where the agent fetches device addresses and reports results. */
  apiBaseUrl: string;
  version?: string;
}

/** The complete set of things this agent will do. Anything else is a 404. */
export const COMMANDS = ['status', 'discover', 'test', 'print', 'nfc.read'] as const;
export type Command = (typeof COMMANDS)[number];
export const isCommand = (value: string): value is Command =>
  (COMMANDS as readonly string[]).includes(value);

/** Constant-time token comparison, so a wrong token leaks nothing through timing. */
export function tokenMatches(provided: string | undefined, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // Compare equal-length buffers only; timingSafeEqual throws on a length mismatch, and
  // the length itself is not a secret.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      // A device command is tiny. Anything larger is refused rather than buffered.
      if (body.length > 64_000) reject(new Error('Request too large'));
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });

export function createAgent(options: AgentOptions) {
  const version = options.version ?? '0.1.0';
  const network = new NetworkPrinterAdapter();
  const nfc = new NfcReaderAdapter();

  /** Ask the API for a device's saved address. The agent never trusts a caller's one. */
  async function targetFor(deviceId: string, bearer: string): Promise<DeviceTarget | null> {
    const response = await fetch(`${options.apiBaseUrl}/api/devices/${deviceId}/target`, {
      headers: { Authorization: bearer, Origin: options.allowedOrigin },
    });
    return response.ok ? ((await response.json()) as DeviceTarget) : null;
  }

  const server = createServer((req, res) => {
    void handle(req, res).catch(() => send(res, 500, { error: 'Device agent failure' }));
  });

  function send(res: ServerResponse, status: number, body: unknown) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(payload),
      // The agent answers one origin only; a second POS install cannot borrow it.
      'access-control-allow-origin': options.allowedOrigin,
      'access-control-allow-headers': 'authorization,content-type',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    res.end(payload);
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const origin = req.headers.origin;
    if (origin && origin !== options.allowedOrigin)
      return send(res, 403, { error: 'Origin not permitted' });
    if (req.method === 'OPTIONS') return send(res, 204, {});

    const command = (req.url ?? '').replace(/^\/+/, '').split('?')[0] ?? '';
    if (!isCommand(command)) return send(res, 404, { error: 'Unknown command' });

    const header = req.headers.authorization ?? '';
    if (!tokenMatches(header.replace(/^Bearer\s+/i, ''), options.token))
      return send(res, 401, { error: 'Device agent authentication required' });

    if (command === 'status')
      return send(res, 200, {
        agent: 'riza-device-agent',
        version,
        // Only adapters that can really drive hardware are advertised, so the operator
        // view never implies a capability the agent does not have.
        capabilities: [network.name],
        serverTime: new Date().toISOString(),
      });

    if (command === 'discover') return send(res, 200, await discover());

    const raw = await readBody(req);
    let body: Record<string, unknown>;
    try {
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      return send(res, 400, { error: 'Malformed request' });
    }

    // A caller may name a device and nothing else. There is no field in any command that
    // carries a port, a host or a path, so there is nothing to smuggle.
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId : '';
    if (!/^[0-9a-f-]{36}$/i.test(deviceId)) return send(res, 400, { error: 'A device id is required' });
    const target = await targetFor(deviceId, header);
    if (!target) return send(res, 404, { error: 'Unknown device' });

    if (command === 'nfc.read') {
      if (target.kind !== 'NFC_READER') return send(res, 400, { error: 'Not a card reader' });
      return send(res, 200, await nfc.read());
    }

    const adapter = adapterFor(target);
    if (command === 'test') {
      // A test proves reachability, which is what an operator actually wants to know.
      const result =
        target.connection === 'NETWORK' && target.host && target.tcpPort
          ? await network.probe(target.host, target.tcpPort)
          : await adapter.deliver(target, { test: true });
      return send(res, 200, result);
    }

    // print
    return send(res, 200, await adapter.deliver(target, body.document ?? null));
  }

  async function discover() {
    // Discovery lists what this machine offers so an operator picks from real choices
    // instead of typing a port name. Enumerating COM ports and spooler queues needs a
    // platform binding that is not installed yet, so it says so rather than inventing
    // entries that would not work when selected.
    return {
      serialPorts: [],
      windowsPrinters: [],
      unavailable:
        'Device discovery needs the serial-port and Windows-spooler bindings installed on ' +
        'the restaurant PC. Until then, enter the COM port or printer queue name manually.',
    };
  }

  return {
    server,
    listen: () =>
      new Promise<void>((resolve) => {
        // Loopback only. This is the single most important line in the agent.
        server.listen(options.port, '127.0.0.1', resolve);
      }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
