import type { Prisma } from '@restaurant/database';
import type {
  KitchenPrintContract,
  KitchenStatus,
  KitchenTicketContent,
  KitchenTicketRecord,
} from '@restaurant/shared-types';
import type { Principal } from '../auth/auth.service';
import { audit } from '../audit';

export const kitchenScope = (p: Principal) => ({
  branchId: p.branchId,
  organizationId: p.organizationId,
});
export function kitchenRecord(r: Prisma.KitchenTicketGetPayload<object>): KitchenTicketRecord {
  return {
    id: r.id,
    orderId: r.orderId,
    stationId: r.stationId,
    status: r.status,
    version: r.version,
    content: r.content as unknown as KitchenTicketContent,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    preparingAt: r.preparingAt?.toISOString() ?? null,
    readyAt: r.readyAt?.toISOString() ?? null,
    completedAt: r.completedAt?.toISOString() ?? null,
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
    cancellationReason: r.cancellationReason,
  };
}
export const kitchenNext: Partial<Record<KitchenStatus, KitchenStatus>> = {
  NEW: 'PREPARING',
  PREPARING: 'READY',
  READY: 'COMPLETED',
};
export function aggregateKitchen(
  states: KitchenStatus[],
): 'SENT_TO_KITCHEN' | 'PREPARING' | 'READY' {
  if (!states.length) throw new Error('Cannot aggregate an empty kitchen submission');
  if (states.every((s) => s === 'READY' || s === 'COMPLETED')) return 'READY';
  return states.every((s) => s === 'NEW') ? 'SENT_TO_KITCHEN' : 'PREPARING';
}
export function printContract(ticket: KitchenTicketRecord): KitchenPrintContract {
  return {
    schemaVersion: 1,
    kind: ticket.cancelledAt ? 'KITCHEN_CANCELLATION' : 'KITCHEN_TICKET',
    documentId: ticket.id + (ticket.cancelledAt ? ':cancellation' : ':original'),
    ticketVersion: ticket.version,
    content: ticket.content,
    cancellation: ticket.cancelledAt
      ? { at: ticket.cancelledAt, reason: ticket.cancellationReason! }
      : null,
  };
}
export async function emitKitchen(
  tx: Prisma.TransactionClient,
  p: Principal,
  action: string,
  after: KitchenTicketRecord,
  before?: KitchenTicketRecord,
  command?: { commandId: string; requestHash: string },
) {
  const revision = await tx.kitchenRevision.upsert({
    where: { branchId: p.branchId },
    create: { ...kitchenScope(p), revision: 1n },
    update: { revision: { increment: 1n } },
  });
  const snapshot: Prisma.InputJsonObject = JSON.parse(JSON.stringify(after));
  await audit(
    tx,
    {
      ...kitchenScope(p),
      userId: p.userId,
      terminalId: p.terminalId,
      requestId: p.requestId,
      ip: p.ip,
    },
    action,
    'KitchenTicket',
    after.id,
    before ? JSON.parse(JSON.stringify(before)) : undefined,
    snapshot,
  );
  await tx.kitchenEvent.create({
    data: {
      ...kitchenScope(p),
      ticketId: after.id,
      orderId: after.orderId,
      userId: p.userId,
      revision: revision.revision,
      ticketVersion: after.version,
      action,
      response: snapshot,
      ...command,
    },
  });
}
export async function cancelKitchenTickets(
  tx: Prisma.TransactionClient,
  p: Principal,
  orderId: string,
  reason: string,
) {
  const rows = await tx.kitchenTicket.findMany({
    where: { ...kitchenScope(p), orderId, cancelledAt: null },
    orderBy: { id: 'asc' },
  });
  for (const row of rows) {
    const after = await tx.kitchenTicket.update({
      where: { ...kitchenScope(p), id: row.id, version: row.version },
      data: { cancelledAt: new Date(), cancellationReason: reason, version: { increment: 1 } },
    });
    await emitKitchen(tx, p, 'kitchen.ticket.cancelled', kitchenRecord(after), kitchenRecord(row));
  }
}
