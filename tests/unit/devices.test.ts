import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS } from '@restaurant/shared-types';
import {
  deviceInputSchema,
  deviceTestSchema,
  managerOverrideSchema,
  nfcEnrollSchema,
  nfcLoginSchema,
  printResultSchema,
  stationPrinterSchema,
} from '@restaurant/validation';
import {
  canAttempt,
  deviceAddress,
  deviceSeverity,
  deviceStatus,
  deviceUnavailableReason,
  isTerminal,
  nextJobState,
  printerKindFor,
  retryDelayMs,
  summarizeJobs,
} from '../../apps/api/src/devices/devices-state';
import {
  buildReceipt,
  receiptDocumentId,
  RECEIPT_NOTICE,
  type ReceiptSource,
} from '../../apps/api/src/devices/receipt-contract';
import { COMMANDS, isCommand, tokenMatches } from '../../apps/device-agent/src/agent';
import { readFileSync, readdirSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { translate } from '../../apps/admin/src/lib/i18n/provider';
import { serverMessage } from '../../apps/admin/src/lib/i18n/server-messages';
import {
  adapterFor,
  NetworkPrinterAdapter,
  NfcReaderAdapter,
  SerialPrinterAdapter,
  WindowsPrinterAdapter,
  type DeviceTarget,
} from '../../apps/device-agent/src/adapters';

const serial = { name: 'Receipt', kind: 'RECEIPT_PRINTER', connection: 'SERIAL' } as const;
const network = { name: 'Kitchen', kind: 'KITCHEN_PRINTER', connection: 'NETWORK' } as const;

describe('Device address configuration', () => {
  it('accepts the addresses a restaurant actually uses', () => {
    for (const input of [
      { ...serial, port: 'COM3' },
      { ...serial, port: 'COM256', baudRate: 115200 },
      { ...network, host: '192.168.1.50', tcpPort: 9100 },
      { ...network, host: '10.0.0.5' },
      { ...network, host: '172.16.4.9' },
      { name: 'Till', kind: 'RECEIPT_PRINTER', connection: 'WINDOWS_PRINTER', windowsPrinterName: 'EPSON TM-T20' },
    ])
      expect(deviceInputSchema.safeParse(input).success, JSON.stringify(input)).toBe(true);
  });

  it('refuses a COM port that is really a path, a device escape or a shell fragment', () => {
    for (const port of ['COM0', 'COM257', '../../dev/ttyS0', 'COM3; shutdown', '\\\\.\\COM3', 'LPT1'])
      expect(deviceInputSchema.safeParse({ ...serial, port }).success, port).toBe(false);
  });

  it('refuses any printer destination outside the local network', () => {
    // A restaurant printer is never on a public address. Refusing one here means a
    // mistyped or malicious configuration cannot become an outbound channel.
    for (const host of [
      '8.8.8.8',
      '1.1.1.1',
      '203.0.113.5',
      'http://evil.example',
      'evil.example.com',
      'user:pass@192.168.1.5',
      '192.168.1.5:9100',
      '../../etc',
      '0.0.0.0',
    ])
      expect(deviceInputSchema.safeParse({ ...network, host }).success, host).toBe(false);
  });

  it('refuses a privileged or out-of-range TCP port', () => {
    for (const tcpPort of [22, 80, 443, 1023, 0, 70000])
      expect(
        deviceInputSchema.safeParse({ ...network, host: '192.168.1.5', tcpPort }).success,
        String(tcpPort),
      ).toBe(false);
  });

  it('refuses a half-addressed device', () => {
    // A device missing its address would fail at print time on a busy service rather
    // than at configuration time, which is the wrong moment to discover it.
    expect(deviceInputSchema.safeParse(serial).success).toBe(false);
    expect(deviceInputSchema.safeParse(network).success).toBe(false);
    expect(
      deviceInputSchema.safeParse({ name: 'U', kind: 'RECEIPT_PRINTER', connection: 'USB' }).success,
    ).toBe(false);
    expect(
      deviceInputSchema.safeParse({
        name: 'U',
        kind: 'RECEIPT_PRINTER',
        connection: 'USB',
        port: 'COM3',
        windowsPrinterName: 'Queue',
      }).success,
    ).toBe(false);
  });

  it('refuses branch or organization from a client, and any unknown field', () => {
    for (const extra of [
      { branchId: '2f1d0d1e-0000-4000-8000-000000000000' },
      { organizationId: 'x' },
      { version: 2 },
      { status: 'ONLINE' },
      { lastSeenAt: '2026-01-01' },
    ])
      expect(
        deviceInputSchema.safeParse({ ...serial, port: 'COM3', ...extra }).success,
        JSON.stringify(extra),
      ).toBe(false);
  });

  it('keeps a card reader off the network', () => {
    expect(
      deviceInputSchema.safeParse({
        name: 'Reader',
        kind: 'NFC_READER',
        connection: 'NETWORK',
        host: '192.168.1.9',
      }).success,
    ).toBe(false);
    expect(
      deviceInputSchema.safeParse({
        name: 'Reader',
        kind: 'NFC_READER',
        connection: 'SERIAL',
        port: 'COM4',
      }).success,
    ).toBe(true);
  });
});

describe('Device presentation', () => {
  const now = new Date('2026-09-20T12:00:00.000Z');
  const base = { enabled: true, lastError: null };
  it('shows a disabled device as disabled, not as offline', () => {
    // Disabled is a decision somebody made; offline is a fault. Conflating them would
    // send staff looking for a broken printer that was switched off on purpose.
    expect(deviceStatus({ ...base, enabled: false, lastSeenAt: now }, now)).toBe('DISABLED');
  });
  it('never assumes a device that has not reported is working', () => {
    expect(deviceStatus({ ...base, lastSeenAt: null }, now)).toBe('UNKNOWN');
  });
  it('treats a stale or failing device as offline', () => {
    expect(deviceStatus({ ...base, lastSeenAt: new Date(now.getTime() - 10 * 60_000) }, now)).toBe(
      'OFFLINE',
    );
    expect(deviceStatus({ ...base, lastSeenAt: now, lastError: 'refused' }, now)).toBe('OFFLINE');
    expect(deviceStatus({ ...base, lastSeenAt: now }, now)).toBe('ONLINE');
  });
  it('renders the address an operator recognises', () => {
    expect(
      deviceAddress({ connection: 'SERIAL', port: 'COM3', host: null, tcpPort: null, windowsPrinterName: null }),
    ).toBe('COM3');
    expect(
      deviceAddress({ connection: 'NETWORK', port: null, host: '192.168.1.50', tcpPort: 9100, windowsPrinterName: null }),
    ).toBe('192.168.1.50:9100');
  });
  it('explains why a device cannot take a job, naming it', () => {
    const device = { name: 'Bar printer', kind: 'BAR_PRINTER', enabled: true, deletedAt: null };
    expect(deviceUnavailableReason(device)).toBeNull();
    expect(deviceUnavailableReason({ ...device, enabled: false })).toContain('Bar printer');
    expect(deviceUnavailableReason({ ...device, deletedAt: new Date() })).toContain('Bar printer');
    expect(deviceUnavailableReason({ ...device, kind: 'NFC_READER' })).toContain('not a printer');
  });
  it('never routes a print job to a card reader', () => {
    expect(printerKindFor('NFC_READER')).toBeNull();
    expect(printerKindFor('KITCHEN_PRINTER')).toBe('KITCHEN_PRINTER');
  });
});

describe('Print delivery state', () => {
  it('confirms a delivered document and makes it terminal', () => {
    expect(nextJobState(true, true)).toBe('CONFIRMED');
    expect(isTerminal('CONFIRMED')).toBe(true);
    expect(canAttempt('CONFIRMED')).toBe(false);
  });
  it('separates a printer that is off from one that will never work', () => {
    expect(nextJobState(false, true)).toBe('RETRY_REQUIRED');
    expect(nextJobState(false, false)).toBe('FAILED');
    expect(canAttempt('RETRY_REQUIRED')).toBe(true);
    expect(canAttempt('FAILED')).toBe(true);
    // A job already handed to the agent is not re-sent underneath it.
    expect(canAttempt('SENT')).toBe(false);
  });
  it('backs off between attempts without becoming unresponsive', () => {
    expect(retryDelayMs(1)).toBe(5_000);
    expect(retryDelayMs(2)).toBeGreaterThan(retryDelayMs(1));
    expect(retryDelayMs(50)).toBeLessThanOrEqual(300_000);
  });
  it('summarises what an operator must act on', () => {
    expect(summarizeJobs(['CONFIRMED', 'FAILED', 'PENDING', 'RETRY_REQUIRED'])).toEqual({
      confirmed: 1,
      failed: 1,
      pending: 2,
    });
  });
  it('reports printing problems as a warning, never as critical', () => {
    // Printing is downstream of the sale. Reporting a paper problem as critical would
    // train staff to ignore the signal that actually matters.
    expect(deviceSeverity({ offlineDevices: 0, unroutedStations: 0, failedJobs: 0 })).toBe('ok');
    expect(deviceSeverity({ offlineDevices: 2, unroutedStations: 1, failedJobs: 9 })).toBe('warn');
  });
});

describe('Customer receipt document', () => {
  const source = (extra: Partial<ReceiptSource['order']> = {}): ReceiptSource => ({
    branchName: 'Downtown',
    order: {
      id: '6f1c2f1e-0000-4000-8000-000000000001',
      orderNumber: 1008,
      status: 'PAID',
      type: 'DINE_IN',
      tableName: 'Table 5',
      areaName: 'Dine-in area',
      subtotal: '12.00',
      discount: '2.00',
      tax: '1.67',
      total: '10.00',
      items: [
        {
          id: 'b',
          productName: 'Chicken Classic',
          quantity: 1,
          unitPrice: '6.00',
          total: '6.00',
          voidedAt: null,
          modifiers: [{ groupName: 'Extras', name: 'Extra mayo' }],
        },
        {
          id: 'a',
          productName: 'Riza Burger',
          quantity: 1,
          unitPrice: '6.00',
          total: '6.00',
          voidedAt: null,
          modifiers: [],
        },
        {
          id: 'c',
          productName: 'Removed item',
          quantity: 1,
          unitPrice: '3.00',
          total: '3.00',
          voidedAt: '2026-09-20T11:00:00.000Z',
          modifiers: [],
        },
      ],
      ...extra,
    },
    settlement: {
      orderId: '6f1c2f1e-0000-4000-8000-000000000001',
      currency: 'EUR',
      createdAt: '2026-09-20T12:00:00.000Z',
      cashierName: 'John Doe',
    },
    payments: [{ method: 'CASH', amount: '10.00', tendered: '20.00', change: '10.00' }],
  });

  it('copies every amount exactly as the ledger stores it', () => {
    const receipt = buildReceipt(source());
    expect(receipt.subtotal).toBe('12.00');
    expect(receipt.discount).toBe('2.00');
    expect(receipt.tax).toBe('1.67');
    expect(receipt.total).toBe('10.00');
    expect(receipt.tenders[0]).toEqual({
      method: 'CASH',
      amount: '10.00',
      tendered: '20.00',
      change: '10.00',
    });
  });
  it('leaves out voided lines, which the customer did not buy', () => {
    const receipt = buildReceipt(source());
    expect(receipt.lines).toHaveLength(2);
    expect(receipt.lines.map((l) => l.productName)).not.toContain('Removed item');
  });
  it('is deterministic, so a reprint is provably the same document', () => {
    expect(buildReceipt(source())).toEqual(buildReceipt(source()));
    expect(buildReceipt(source()).documentId).toBe(
      receiptDocumentId('6f1c2f1e-0000-4000-8000-000000000001'),
    );
  });
  it('refuses to print a receipt for a sale that is not settled', () => {
    // A receipt in a customer's hand that the ledger does not agree with is worse than
    // no receipt at all.
    expect(() => buildReceipt(source({ status: 'OPEN' }))).toThrow(/settled/i);
  });
  it('states on its face that it is not a fiscal document', () => {
    // FastFood Riza does not fiscalize; EnterNet owns fiscal receipts. A printed slip
    // must never be mistakable for one.
    const receipt = buildReceipt(source());
    expect(receipt.notice).toBe(RECEIPT_NOTICE);
    expect(receipt.kind).toBe('CUSTOMER_RECEIPT');
    // The disclaimer itself contains the words "fiscal receipt", so the check is that no
    // fiscal *identifier* is carried: this POS issues none, and inventing one would be
    // indistinguishable from a real fiscal document to anyone holding the paper.
    const { notice, ...document } = receipt;
    expect(notice).toMatch(/not a fiscal/i);
    expect(JSON.stringify(document)).not.toMatch(/fiscalNumber|fiscalReceipt|signature|atk/i);
  });
});

describe('Device Agent boundary', () => {
  it('exposes exactly five commands and nothing else', () => {
    expect([...COMMANDS]).toEqual(['status', 'discover', 'test', 'print', 'nfc.read']);
    for (const attempt of ['shell', 'exec', 'eval', 'read-file', 'open', '../status', 'PRINT'])
      expect(isCommand(attempt), attempt).toBe(false);
  });
  it('compares tokens without leaking length or content by timing', () => {
    const token = 'a'.repeat(48);
    expect(tokenMatches(token, token)).toBe(true);
    expect(tokenMatches('b'.repeat(48), token)).toBe(false);
    expect(tokenMatches('a'.repeat(47), token)).toBe(false);
    expect(tokenMatches(undefined, token)).toBe(false);
    expect(tokenMatches(token, '')).toBe(false);
  });
  it('chooses an adapter from saved configuration, never from a request', () => {
    const target = (extra: Record<string, unknown>) => ({
      kind: 'KITCHEN_PRINTER',
      connection: 'NETWORK',
      port: null,
      baudRate: null,
      host: null,
      tcpPort: null,
      windowsPrinterName: null,
      ...extra,
    });
    expect(adapterFor(target({})).name).toBe('network-printer');
    expect(adapterFor(target({ connection: 'SERIAL', port: 'COM3' })).name).toBe('serial-printer');
    expect(adapterFor(target({ connection: 'WINDOWS_PRINTER' })).name).toBe('windows-printer');
    expect(adapterFor(target({ kind: 'NFC_READER', connection: 'SERIAL' })).name).toBe('nfc-reader');
  });
  it('never claims a print it cannot actually render', () => {
    // An adapter without the printer's command set must fail visibly. A silently
    // discarded kitchen ticket is far worse than a reported failure.
    const unknown = adapterFor({
      kind: 'RECEIPT_PRINTER',
      connection: 'SERIAL',
      port: 'COM3',
      baudRate: 9600,
      host: null,
      tcpPort: null,
      windowsPrinterName: null,
    });
    expect(unknown.ready).toBe(false);
    return unknown.deliver({} as never, {}).then((result) => {
      expect(result.delivered).toBe(false);
      expect(result.error).toMatch(/command set/i);
    });
  });
  it('reports an unreachable printer as retryable', async () => {
    // Port 1 on loopback is closed, so this exercises the real refusal path.
    const result = await new NetworkPrinterAdapter(500).probe('127.0.0.1', 1);
    expect(result.delivered).toBe(false);
    expect(result.retryable).toBe(true);
  });
});

describe('Device inputs and permissions', () => {
  it('accepts only a job outcome from the agent, never a destination', () => {
    const jobId = '6f1c2f1e-0000-4000-8000-000000000001';
    expect(printResultSchema.safeParse({ jobId, delivered: true }).success).toBe(true);
    for (const extra of [{ host: '8.8.8.8' }, { deviceId: jobId }, { documentId: 'x' }])
      expect(printResultSchema.safeParse({ jobId, delivered: true, ...extra }).success).toBe(false);
  });
  it('accepts only a saved device for a station binding', () => {
    const id = '6f1c2f1e-0000-4000-8000-000000000001';
    expect(stationPrinterSchema.safeParse({ stationId: id, deviceId: id }).success).toBe(true);
    expect(stationPrinterSchema.safeParse({ stationId: id, deviceId: null }).success).toBe(true);
    expect(
      stationPrinterSchema.safeParse({ stationId: id, host: '192.168.1.5', tcpPort: 9100 }).success,
    ).toBe(false);
  });
  it('never lets a card sign-in name a user, a role or a permission', () => {
    const base = { organization: 'riza', branch: 'main', credential: 'card-abc123' };
    expect(nfcLoginSchema.safeParse(base).success).toBe(true);
    for (const extra of [
      { userId: '6f1c2f1e-0000-4000-8000-000000000001' },
      { role: 'MANAGER' },
      { permissions: ['payment.refund'] },
      { branchId: '6f1c2f1e-0000-4000-8000-000000000001' },
    ])
      expect(nfcLoginSchema.safeParse({ ...base, ...extra }).success, JSON.stringify(extra)).toBe(
        false,
      );
  });
  it('requires a PIN alongside the card for a manager override', () => {
    // A raw card id can be cloned. A second factor is what makes an override meaningful.
    const full = { credential: 'card-abc123', pin: '4821', action: 'payment.refund' };
    expect(managerOverrideSchema.safeParse(full).success).toBe(true);
    expect(managerOverrideSchema.safeParse({ ...full, pin: undefined }).success).toBe(false);
    expect(managerOverrideSchema.safeParse({ ...full, pin: '12' }).success).toBe(false);
  });
  it('requires an idempotent command id for enrolment', () => {
    const base = {
      userId: '6f1c2f1e-0000-4000-8000-000000000001',
      credential: 'card-abc123',
    };
    expect(nfcEnrollSchema.safeParse(base).success).toBe(false);
    expect(
      nfcEnrollSchema.safeParse({ ...base, commandId: '6f1c2f1e-0000-4000-8000-000000000002' })
        .success,
    ).toBe(true);
  });
  it('accepts only a test outcome, never an address to test', () => {
    expect(deviceTestSchema.safeParse({ ok: true }).success).toBe(true);
    expect(deviceTestSchema.safeParse({ ok: false, error: 'refused' }).success).toBe(true);
    expect(deviceTestSchema.safeParse({ ok: true, host: '8.8.8.8' }).success).toBe(false);
  });
  it('grants device permissions to owner, admin and manager only', () => {
    expect(PERMISSIONS).toContain('device.read');
    expect(PERMISSIONS).toContain('device.manage');
    for (const role of ['OWNER', 'ADMIN', 'MANAGER'] as const) {
      expect(DEFAULT_ROLE_PERMISSIONS[role]).toContain('device.read');
      expect(DEFAULT_ROLE_PERMISSIONS[role]).toContain('device.manage');
    }
    // A cashier, waiter or cook never reconfigures the restaurant's hardware.
    for (const role of ['CASHIER', 'WAITER', 'KITCHEN', 'STOREKEEPER'] as const) {
      expect(DEFAULT_ROLE_PERMISSIONS[role]).not.toContain('device.read');
      expect(DEFAULT_ROLE_PERMISSIONS[role]).not.toContain('device.manage');
    }
  });
});

describe('Device messages reach operators in Albanian', () => {
  const target = (overrides: Partial<DeviceTarget>): DeviceTarget => ({
    kind: 'RECEIPT_PRINTER',
    connection: 'SERIAL',
    port: null,
    host: null,
    tcpPort: null,
    windowsPrinterName: null,
    ...overrides,
  });
  // Each case runs the real adapter, so a change to its wording that the catalogue does
  // not follow fails here instead of silently showing English to Albanian staff.
  it('translates the refusals each adapter actually returns', async () => {
    const serial = await new SerialPrinterAdapter().deliver(target({ port: 'COM3' }));
    expect(serverMessage(serial.error!, 'sq')).toBe(
      translate('sq', 'devices.agentSerialNeedsModel', { port: 'COM3' }),
    );
    const windows = await new WindowsPrinterAdapter().deliver(
      target({ connection: 'WINDOWS_PRINTER', windowsPrinterName: 'POS-80' }),
    );
    expect(serverMessage(windows.error!, 'sq')).toBe(
      translate('sq', 'devices.agentWindowsNeedsModel', { queue: 'POS-80' }),
    );
    const reader = new NfcReaderAdapter();
    expect(serverMessage((await reader.deliver()).error!, 'sq')).toBe(
      'Lexuesi i kartelave nuk mund të printojë',
    );
    expect(serverMessage((await reader.read()).error!, 'sq')).toBe(
      translate('sq', 'devices.agentNfcNeedsModel'),
    );
    for (const result of [serial, windows]) expect(serverMessage(result.error!, 'en')).toBe(result.error);
  });
  it('translates what a network printer reports, answering or not', async () => {
    const server = createServer((socket) => socket.destroy());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const network = target({ kind: 'KITCHEN_PRINTER', connection: 'NETWORK', host: '127.0.0.1', tcpPort: port });
    const answered = await new NetworkPrinterAdapter().deliver(network);
    expect(serverMessage(answered.error!, 'sq')).toBe(
      translate('sq', 'devices.agentNetworkNeedsModel', { address: `127.0.0.1:${port}` }),
    );
    await new Promise<void>((resolve) => server.close(() => resolve()));
    // The port is now closed, which is how a switched-off printer looks.
    const off = await new NetworkPrinterAdapter().deliver(network);
    const code = /is unreachable \((\w+)\)$/.exec(off.error!)?.[1];
    expect(code).toBeTruthy();
    expect(serverMessage(off.error!, 'sq')).toBe(
      translate('sq', 'devices.agentUnreachable', { address: `127.0.0.1:${port}`, code: code! }),
    );
  }, 15000);
  it('has an Albanian rendering for every message the device code can show', () => {
    // English literals thrown by the API or returned by the agent. The agent's start-up
    // configuration errors are excluded: they are written to its log, never shown.
    const sources = [
      ...readdirSync('apps/api/src/devices').map((file) => `apps/api/src/devices/${file}`),
      'packages/validation/src/devices.ts',
      'apps/device-agent/src/agent.ts',
      'apps/device-agent/src/adapters.ts',
    ];
    const messages = new Set<string>();
    for (const file of sources) {
      const source = readFileSync(file, 'utf8');
      // A message is a sentence; identifiers such as audit entity names have no space.
      for (const [, text] of source.matchAll(/(?:Exception\(|error: |, )'([A-Z][^'${}]* [^'${}]+)'/g))
        if (!/^[A-Z_]{4,} must/.test(text!)) messages.add(text!);
    }
    messages.add('This card is not recognised'); // NFC sign-in, raised by the auth service
    expect(messages.size).toBeGreaterThan(20);
    const untranslated = [...messages].filter((text) => serverMessage(text, 'sq') === text);
    expect(untranslated).toEqual([]);
  });
});
