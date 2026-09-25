// Device management service.
//
// Owns hardware configuration, station-to-printer routing, print delivery state and
// staff card credentials. It never opens a socket or a COM port: the Device Agent on the
// restaurant PC performs every physical delivery, and this service records what happened.
//
// Two invariants shape the whole file. A device address is written only here, by an
// operator holding device.manage, so no request can aim restaurant hardware somewhere
// else. And print delivery is strictly downstream of business truth: a failed job never
// alters an order, a kitchen submission, a ticket or a payment.
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hash as argonHash, verify as argonVerify, argon2id } from 'argon2';
import type { Prisma } from '@restaurant/database';
import type {
  DeviceOverview,
  DeviceRecord,
  PrintJobRecord,
  PrinterKind,
  StationPrinterRecord,
} from '@restaurant/shared-types';
import type {
  DeviceInput,
  PrintResultInput,
  StationPrinterInput,
} from '@restaurant/validation';
import type { Principal } from '../auth/auth.service';
import { audit } from '../audit';
import { DatabaseService } from '../database.service';
import { inventoryScope as scope } from '../inventory/inventory.transactions';
import { printContract } from '../kitchen/kitchen.transactions';
import { kitchenRecord } from '../kitchen/kitchen.transactions';
import {
  AGENT_STALE_MS,
  canAttempt,
  deviceStatus,
  deviceUnavailableReason,
  isTerminal,
  nextJobState,
  printerKindFor,
} from './devices-state';
import { buildReceipt } from './receipt-contract';

type Tx = Prisma.TransactionClient;
const read = { isolationLevel: 'RepeatableRead' as const };
const write = { isolationLevel: 'Serializable' as const, timeout: 15000 };
// AuditLog accepts only these context columns; a Principal also carries session and
// permission data that must never be spread into a database row.
const context = (p: Principal) => ({
  ...scope(p),
  userId: p.userId,
  terminalId: p.terminalId,
  requestId: p.requestId,
  ip: p.ip,
});
/** Same parameters the password hasher uses, so card material is protected identically. */
const hashSecret = (value: string) =>
  argonHash(value, { type: argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });

type DeviceRow = Prisma.DeviceGetPayload<{ include: { terminal: true } }>;

function deviceRecord(row: DeviceRow, now = new Date()): DeviceRecord {
  return {
    id: row.id,
    kind: row.kind as DeviceRecord['kind'],
    name: row.name,
    connection: row.connection as DeviceRecord['connection'],
    port: row.port,
    baudRate: row.baudRate,
    host: row.host,
    tcpPort: row.tcpPort,
    windowsPrinterName: row.windowsPrinterName,
    terminalId: row.terminalId,
    terminalName: row.terminal?.name ?? null,
    enabled: row.enabled,
    status: deviceStatus(row, now),
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    lastTestAt: row.lastTestAt?.toISOString() ?? null,
    lastError: row.lastError,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function jobRecord(
  row: Prisma.PrintJobGetPayload<{ include: { device: true } }>,
): PrintJobRecord {
  return {
    id: row.id,
    documentId: row.documentId,
    kind: row.kind as PrinterKind,
    deviceId: row.deviceId,
    deviceName: row.device?.name ?? null,
    state: row.state as PrintJobRecord['state'],
    attempts: row.attempts,
    lastError: row.lastError,
    lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class DevicesService {
  constructor(private readonly db: DatabaseService) {}

  // --- configuration ---------------------------------------------------------

  async list(p: Principal): Promise<DeviceRecord[]> {
    const rows = await this.db.client.device.findMany({
      where: { ...scope(p), deletedAt: null },
      include: { terminal: true },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    });
    return rows.map((row) => deviceRecord(row));
  }

  private async row(tx: Tx, p: Principal, id: string) {
    const row = await tx.device.findFirst({
      where: { ...scope(p), id, deletedAt: null },
      include: { terminal: true },
    });
    if (!row) throw new NotFoundException('Device not found');
    return row;
  }

  async get(p: Principal, id: string): Promise<DeviceRecord> {
    return deviceRecord(await this.row(this.db.client, p, id));
  }

  /**
   * Create or update a device.
   *
   * This is the only path by which an address enters the system. The schema has already
   * refused anything but a COM name, a private LAN host or a spooler queue.
   */
  save(p: Principal, input: DeviceInput, id?: string, version?: number) {
    return this.db.client.$transaction(async (tx) => {
      const before = id ? await this.row(tx, p, id) : undefined;
      if (before && before.version !== version)
        throw new ConflictException('Reload this device');
      if (input.terminalId) {
        const terminal = await tx.terminal.findFirst({
          where: { ...scope(p), id: input.terminalId, deletedAt: null },
        });
        if (!terminal) throw new NotFoundException('Terminal not found');
      }
      const data = {
        kind: input.kind,
        name: input.name,
        connection: input.connection,
        terminalId: input.terminalId,
        enabled: input.enabled,
        port: 'port' in input ? (input.port ?? null) : null,
        baudRate: 'baudRate' in input ? (input.baudRate ?? null) : null,
        host: 'host' in input ? input.host : null,
        tcpPort: 'tcpPort' in input ? input.tcpPort : null,
        windowsPrinterName:
          'windowsPrinterName' in input ? (input.windowsPrinterName ?? null) : null,
      };
      const row = id
        ? await tx.device.update({
            where: { ...scope(p), id, version, deletedAt: null },
            data: { ...data, version: { increment: 1 } },
            include: { terminal: true },
          })
        : await tx.device.create({ data: { ...scope(p), ...data }, include: { terminal: true } });
      const after = deviceRecord(row);
      await audit(
        tx,
        context(p),
        id ? 'device.updated' : 'device.registered',
        'Device',
        row.id,
        before ? { name: before.name, enabled: before.enabled } : undefined,
        { name: after.name, kind: after.kind, connection: after.connection, enabled: after.enabled },
      );
      return after;
    }, write);
  }

  /** Remove a device from service. Its delivery history is retained. */
  archive(p: Principal, id: string, version: number) {
    return this.db.client.$transaction(async (tx) => {
      const before = await this.row(tx, p, id);
      if (before.version !== version) throw new ConflictException('Reload this device');
      const bound = await tx.stationPrinter.count({ where: { ...scope(p), deviceId: id } });
      if (bound)
        throw new ConflictException('Unassign this printer from its stations first');
      const row = await tx.device.update({
        where: { ...scope(p), id, version, deletedAt: null },
        data: { enabled: false, deletedAt: new Date(), version: { increment: 1 } },
        include: { terminal: true },
      });
      await audit(tx, context(p), 'device.archived', 'Device', id, { name: before.name }, {
        name: row.name,
      });
      return deviceRecord(row);
    }, write);
  }

  /**
   * The saved address for a device, for the Device Agent only.
   *
   * The agent calls this so it never has to trust an address from the browser. Nothing
   * secret is returned: a COM port and a LAN address are configuration, and the caller
   * already holds a device-scoped session.
   */
  async target(p: Principal, id: string) {
    const row = await this.row(this.db.client, p, id);
    return {
      kind: row.kind,
      connection: row.connection,
      port: row.port,
      baudRate: row.baudRate,
      host: row.host,
      tcpPort: row.tcpPort,
      windowsPrinterName: row.windowsPrinterName,
    };
  }

  // --- station routing -------------------------------------------------------

  async stations(p: Principal): Promise<StationPrinterRecord[]> {
    const stations = await this.db.client.kitchenStation.findMany({
      where: { ...scope(p), deletedAt: null, active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { stationPrinter: { include: { device: true } } },
    });
    return stations.map((s) => ({
      stationId: s.id,
      stationName: s.name,
      deviceId: s.stationPrinter?.deviceId ?? null,
      deviceName: s.stationPrinter?.device.name ?? null,
      unrouted: !s.stationPrinter,
    }));
  }

  /** Bind a station to a saved printer, or clear the binding with a null device. */
  bindStation(p: Principal, input: StationPrinterInput) {
    return this.db.client.$transaction(async (tx) => {
      const station = await tx.kitchenStation.findFirst({
        where: { ...scope(p), id: input.stationId, deletedAt: null },
      });
      if (!station) throw new NotFoundException('Kitchen station not found');
      if (!input.deviceId) {
        await tx.stationPrinter.deleteMany({ where: { ...scope(p), stationId: input.stationId } });
        await audit(tx, context(p), 'device.station_unbound', 'KitchenStation', station.id, undefined, {
          stationName: station.name,
        });
        return { stationId: station.id, deviceId: null };
      }
      const device = await this.row(tx, p, input.deviceId);
      const unavailable = deviceUnavailableReason(device);
      if (unavailable) throw new ConflictException(unavailable);
      await tx.stationPrinter.upsert({
        where: { stationId: input.stationId },
        create: { ...scope(p), stationId: input.stationId, deviceId: device.id },
        update: { deviceId: device.id },
      });
      await audit(tx, context(p), 'device.station_bound', 'KitchenStation', station.id, undefined, {
        stationName: station.name,
        deviceName: device.name,
      });
      return { stationId: station.id, deviceId: device.id };
    }, write);
  }

  // --- print delivery --------------------------------------------------------

  /**
   * Queue the kitchen tickets of one submitted order for printing.
   *
   * Called after the kitchen submission has already committed, so a printing problem can
   * never roll back a submission or a ticket. Each ticket's own print contract supplies
   * the documentId, which is the idempotency key: re-running this for the same order
   * produces no second job, and a cancelled ticket yields a different document.
   */
  queueOrderTickets(p: Principal, orderId: string) {
    return this.db.client.$transaction(async (tx) => {
      const tickets = await tx.kitchenTicket.findMany({
        where: { ...scope(p), orderId },
        include: { station: { include: { stationPrinter: { include: { device: true } } } } },
        orderBy: { id: 'asc' },
      });
      const queued: PrintJobRecord[] = [];
      for (const ticket of tickets) {
        const contract = printContract(kitchenRecord(ticket));
        const binding = ticket.station.stationPrinter;
        // An unrouted station is recorded as a failed job naming the station, rather
        // than being sent to some default printer or silently skipped.
        const device = binding?.device ?? null;
        const unavailable = device ? deviceUnavailableReason(device) : null;
        const job = await this.upsertJob(tx, p, {
          documentId: contract.documentId,
          kind: (device ? printerKindFor(device.kind as DeviceRecord['kind']) : 'KITCHEN_PRINTER') ??
            'KITCHEN_PRINTER',
          deviceId: device && !unavailable ? device.id : null,
          ticketId: ticket.id,
          orderId,
          payload: contract as unknown as Prisma.InputJsonObject,
          error: device
            ? unavailable
            : `${ticket.station.name} has no printer assigned`,
        });
        if (job) queued.push(job);
      }
      return queued;
    }, write);
  }

  /** Queue the customer receipt for a settled order. */
  queueReceipt(p: Principal, orderId: string) {
    return this.db.client.$transaction(async (tx) => {
      const source = await this.receiptSource(tx, p, orderId);
      const contract = buildReceipt(source);
      const device = await tx.device.findFirst({
        where: { ...scope(p), kind: 'RECEIPT_PRINTER', enabled: true, deletedAt: null },
        orderBy: { name: 'asc' },
      });
      const job = await this.upsertJob(tx, p, {
        documentId: contract.documentId,
        kind: 'RECEIPT_PRINTER',
        deviceId: device?.id ?? null,
        ticketId: null,
        orderId,
        payload: contract as unknown as Prisma.InputJsonObject,
        error: device ? null : 'No receipt printer is configured',
      });
      return job ?? (await this.jobByDocument(tx, p, contract.documentId));
    }, write);
  }

  private async receiptSource(tx: Tx, p: Principal, orderId: string) {
    const settlement = await tx.orderSettlement.findFirst({
      where: { ...scope(p), orderId },
      include: { cashier: { include: { user: true } } },
    });
    if (!settlement) throw new NotFoundException('No settled sale for this order');
    const order = await tx.order.findFirst({
      where: { ...scope(p), id: orderId },
      include: { items: { include: { modifiers: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    const branch = await tx.branch.findFirst({ where: { id: p.branchId } });
    const payments = await tx.payment.findMany({
      where: { ...scope(p), orderId },
      orderBy: { createdAt: 'asc' },
    });
    return {
      branchName: branch?.name ?? '',
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        type: order.type as 'DINE_IN' | 'TAKEAWAY',
        tableName: order.tableName,
        areaName: order.areaName,
        subtotal: order.subtotal.toFixed(2),
        discount: order.discount.toFixed(2),
        tax: order.tax.toFixed(2),
        total: order.total.toFixed(2),
        items: order.items.map((i) => ({
          id: i.id,
          productName: i.productName,
          quantity: i.quantity,
          unitPrice: i.unitPrice.toFixed(2),
          total: i.total.toFixed(2),
          voidedAt: i.voidedAt ? i.voidedAt.toISOString() : null,
          modifiers: i.modifiers.map((m) => ({ groupName: m.groupName, name: m.name })),
        })),
      },
      settlement: {
        orderId: settlement.orderId,
        currency: settlement.currency,
        createdAt: settlement.createdAt.toISOString(),
        cashierName: settlement.cashier.user.name,
      },
      payments: payments.map((r) => ({
        method: r.method,
        amount: r.amount.toFixed(2),
        tendered: r.tendered?.toFixed(2) ?? null,
        change: r.change?.toFixed(2) ?? null,
      })),
    };
  }

  /**
   * Create a job for a document, or leave the existing one alone.
   *
   * The unique index on (branch, documentId) is the real guarantee; this read makes the
   * intent explicit and keeps a re-queue from looking like an error to the caller.
   */
  private async upsertJob(
    tx: Tx,
    p: Principal,
    input: {
      documentId: string;
      kind: PrinterKind;
      deviceId: string | null;
      ticketId: string | null;
      orderId: string | null;
      payload: Prisma.InputJsonObject;
      error: string | null;
    },
  ): Promise<PrintJobRecord | null> {
    const existing = await tx.printJob.findFirst({
      where: { ...scope(p), documentId: input.documentId },
      include: { device: true },
    });
    if (existing) return null;
    const row = await tx.printJob.create({
      data: {
        ...scope(p),
        documentId: input.documentId,
        kind: input.kind,
        deviceId: input.deviceId,
        ticketId: input.ticketId,
        orderId: input.orderId,
        state: input.error ? 'FAILED' : 'PENDING',
        payload: input.payload,
        lastError: input.error,
      },
      include: { device: true },
    });
    await audit(tx, context(p), 'device.print_queued', 'PrintJob', row.id, undefined, {
      documentId: row.documentId,
      kind: row.kind,
      state: row.state,
      deviceName: row.device?.name ?? null,
    });
    return jobRecord(row);
  }

  private async jobByDocument(tx: Tx, p: Principal, documentId: string) {
    const row = await tx.printJob.findFirst({
      where: { ...scope(p), documentId },
      include: { device: true },
    });
    return row ? jobRecord(row) : null;
  }

  async jobs(p: Principal, state?: PrintJobRecord['state']): Promise<PrintJobRecord[]> {
    const rows = await this.db.client.printJob.findMany({
      where: { ...scope(p), state },
      include: { device: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    return rows.map(jobRecord);
  }

  /**
   * Record what the Device Agent observed for one attempt.
   *
   * The agent reports only an outcome for a job it was given; it cannot name a document
   * or a device. A confirmed job is terminal, so a duplicate report cannot undo a
   * delivery or print a second copy.
   */
  recordResult(p: Principal, input: PrintResultInput) {
    return this.db.client.$transaction(async (tx) => {
      const before = await tx.printJob.findFirst({
        where: { ...scope(p), id: input.jobId },
        include: { device: true },
      });
      if (!before) throw new NotFoundException('Print job not found');
      if (isTerminal(before.state as PrintJobRecord['state']))
        throw new ConflictException('This document was already printed');
      const state = nextJobState(input.delivered, input.retryable);
      const row = await tx.printJob.update({
        where: { id: before.id },
        data: {
          state,
          attempts: { increment: 1 },
          lastError: input.delivered ? null : (input.error?.slice(0, 500) ?? 'Delivery failed'),
          lastAttemptAt: new Date(),
          confirmedAt: input.delivered ? new Date() : null,
        },
        include: { device: true },
      });
      if (row.deviceId)
        await tx.device.updateMany({
          where: { ...scope(p), id: row.deviceId },
          data: {
            lastSeenAt: new Date(),
            lastError: input.delivered ? null : (input.error?.slice(0, 500) ?? null),
          },
        });
      await audit(tx, context(p), 'device.print_result', 'PrintJob', row.id, undefined, {
        documentId: row.documentId,
        state: row.state,
        attempts: row.attempts,
        deviceName: row.device?.name ?? null,
      });
      return jobRecord(row);
    }, write);
  }

  /** Make a failed job eligible again. The document itself is never rebuilt or changed. */
  retry(p: Principal, jobId: string) {
    return this.db.client.$transaction(async (tx) => {
      const before = await tx.printJob.findFirst({
        where: { ...scope(p), id: jobId },
        include: { device: true },
      });
      if (!before) throw new NotFoundException('Print job not found');
      if (isTerminal(before.state as PrintJobRecord['state']))
        throw new ConflictException('This document was already printed');
      if (!canAttempt(before.state as PrintJobRecord['state']))
        throw new ConflictException('This document is already being delivered');
      // Re-resolve the station's printer, so fixing the routing and pressing retry works.
      let deviceId = before.deviceId;
      if (!deviceId && before.ticketId) {
        const ticket = await tx.kitchenTicket.findFirst({
          where: { ...scope(p), id: before.ticketId },
          include: { station: { include: { stationPrinter: true } } },
        });
        deviceId = ticket?.station.stationPrinter?.deviceId ?? null;
      }
      const row = await tx.printJob.update({
        where: { id: jobId },
        data: { state: 'PENDING', deviceId, lastError: null },
        include: { device: true },
      });
      await audit(tx, context(p), 'device.print_retried', 'PrintJob', row.id, undefined, {
        documentId: row.documentId,
        deviceName: row.device?.name ?? null,
      });
      return jobRecord(row);
    }, write);
  }

  // --- overview --------------------------------------------------------------

  async overview(p: Principal): Promise<DeviceOverview> {
    return this.db.client.$transaction(async (tx) => {
      const now = new Date();
      const rows = await tx.device.findMany({
        where: { ...scope(p), deletedAt: null },
        include: { terminal: true },
        orderBy: [{ kind: 'asc' }, { name: 'asc' }],
      });
      const devices = rows.map((row) => deviceRecord(row, now));
      const stations = await this.stations(p);
      const unresolved = await tx.printJob.findMany({
        where: { ...scope(p), state: { not: 'CONFIRMED' } },
        include: { device: true },
        orderBy: [{ createdAt: 'desc' }],
        take: 50,
      });
      const agentSeen = rows
        .map((r) => r.lastSeenAt?.getTime() ?? 0)
        .reduce((a, b) => Math.max(a, b), 0);
      return {
        devices,
        stations,
        unresolvedJobs: unresolved.map(jobRecord),
        agentReachable: agentSeen > 0 && now.getTime() - agentSeen < AGENT_STALE_MS,
        agentLastSeenAt: agentSeen ? new Date(agentSeen).toISOString() : null,
      };
    }, read);
  }

  /** Record the outcome of an operator's Test button press. */
  recordTest(p: Principal, id: string, result: { ok: boolean; error?: string }) {
    return this.db.client.$transaction(async (tx) => {
      const device = await this.row(tx, p, id);
      const row = await tx.device.update({
        where: { id: device.id },
        data: {
          lastTestAt: new Date(),
          lastSeenAt: result.ok ? new Date() : device.lastSeenAt,
          lastError: result.ok ? null : (result.error?.slice(0, 500) ?? 'Test failed'),
        },
        include: { terminal: true },
      });
      await audit(tx, context(p), 'device.tested', 'Device', row.id, undefined, {
        name: row.name,
        ok: result.ok,
      });
      return deviceRecord(row);
    }, write);
  }

  // --- NFC -------------------------------------------------------------------

  /**
   * Bind a card to a member of staff.
   *
   * Only a hash is stored. A card already enrolled to somebody else is refused rather
   * than silently moved, because two people sharing an identity would make every audit
   * record that follows unreliable.
   */
  enrollNfc(p: Principal, input: { userId: string; credential: string; label: string }) {
    return this.db.client.$transaction(async (tx) => {
      const member = await tx.branchMembership.findFirst({
        where: { ...scope(p), userId: input.userId, active: true },
        include: { user: true },
      });
      if (!member) throw new NotFoundException('Team member not found in this branch');
      const existing = await tx.userNfcCredential.findMany({
        where: { ...scope(p), revokedAt: null },
      });
      for (const row of existing)
        if (await argonVerify(row.credentialHash, input.credential)) {
          if (row.userId !== input.userId)
            throw new ConflictException('This card is already assigned to another person');
          throw new ConflictException('This card is already assigned to this person');
        }
      const row = await tx.userNfcCredential.create({
        data: {
          ...scope(p),
          userId: input.userId,
          credentialHash: await hashSecret(input.credential),
          label: input.label,
          enrolledBy: p.userId,
        },
      });
      // The card value is never audited; only who was given a card, and by whom.
      await audit(tx, context(p), 'device.nfc_enrolled', 'UserNfcCredential', row.id, undefined, {
        userId: input.userId,
        userName: member.user.name,
        label: row.label,
      });
      return { id: row.id, userId: row.userId, label: row.label };
    }, write);
  }

  revokeNfc(p: Principal, credentialId: string) {
    return this.db.client.$transaction(async (tx) => {
      const row = await tx.userNfcCredential.findFirst({
        where: { ...scope(p), id: credentialId, revokedAt: null },
      });
      if (!row) throw new NotFoundException('Card not found');
      const updated = await tx.userNfcCredential.update({
        where: { id: row.id },
        data: { revokedAt: new Date() },
      });
      await audit(tx, context(p), 'device.nfc_revoked', 'UserNfcCredential', row.id, undefined, {
        userId: row.userId,
        label: row.label,
      });
      return { id: updated.id, revokedAt: updated.revokedAt?.toISOString() ?? null };
    }, write);
  }

  /** Set the PIN that a manager must supply alongside their card for an override. */
  setManagerPin(p: Principal, input: { userId: string; pin: string }) {
    return this.db.client.$transaction(async (tx) => {
      const row = await tx.userNfcCredential.findFirst({
        where: { ...scope(p), userId: input.userId, revokedAt: null },
      });
      if (!row) throw new NotFoundException('This person has no active card');
      await tx.userNfcCredential.update({
        where: { id: row.id },
        data: { managerPinHash: await hashSecret(input.pin) },
      });
      await audit(tx, context(p), 'device.manager_pin_set', 'UserNfcCredential', row.id, undefined, {
        userId: input.userId,
      });
      return { ok: true };
    }, write);
  }

  async cardsFor(p: Principal, userId: string) {
    const rows = await this.db.client.userNfcCredential.findMany({
      where: { ...scope(p), userId },
      orderBy: { createdAt: 'desc' },
    });
    // The hash never leaves the service.
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      hasManagerPin: Boolean(r.managerPinHash),
      lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
      revokedAt: r.revokedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /**
   * Authorise a manager override.
   *
   * Card plus PIN: a cloned UID on its own is not enough for a sensitive action. The
   * caller names the action only so it can be audited; this method grants nothing by
   * itself and the permission check stays where it always was.
   */
  async managerOverride(p: Principal, input: { credential: string; pin: string; action: string }) {
    const approval = await this.db.client.$transaction(async (tx) => {
      const candidates = await tx.userNfcCredential.findMany({
        where: { ...scope(p), revokedAt: null, managerPinHash: { not: null } },
        include: { member: { include: { user: true, roles: { include: { role: true } } } } },
      });
      for (const row of candidates) {
        if (!(await argonVerify(row.credentialHash, input.credential))) continue;
        if (!(await argonVerify(row.managerPinHash!, input.pin))) break;
        await tx.userNfcCredential.update({
          where: { id: row.id },
          data: { lastUsedAt: new Date() },
        });
        await audit(tx, context(p), 'device.manager_override', 'UserNfcCredential', row.id, undefined, {
          action: input.action.slice(0, 100),
          approvedBy: row.userId,
          approverName: row.member.user.name,
        });
        return {
          approved: true,
          approvedBy: row.userId,
          approverName: row.member.user.name,
          action: input.action,
        };
      }
      return null;
    }, write);
    if (approval) return approval;
    // A refused override is audited outside the transaction, because a throw would roll
    // the record back and repeated failed attempts are exactly the signal an owner needs
    // to see. This mirrors how a failed sign-in is recorded.
    await audit(
      this.db.client,
      context(p),
      'device.manager_override_denied',
      'UserNfcCredential',
      undefined,
      undefined,
      { action: input.action.slice(0, 100) },
    );
    throw new BadRequestException('Card and PIN do not authorise this action');
  }
}
