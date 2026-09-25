import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@restaurant/database';
import type { KitchenTicketContent, KitchenTicketRecord } from '@restaurant/shared-types';
import type {
  kitchenListSchema,
  kitchenStateSchema,
  kitchenSubmitSchema,
  layoutChangesSchema,
} from '@restaurant/validation';
import type { z } from 'zod';
import { DatabaseService } from '../database.service';
import type { Principal } from '../auth/auth.service';
import { OrdersService, record, hash } from '../orders/orders.service';
import {
  aggregateKitchen,
  emitKitchen,
  kitchenNext,
  kitchenRecord,
  kitchenScope as scope,
  printContract,
} from './kitchen.transactions';

const options = { isolationLevel: 'Serializable' as const, timeout: 15000 };
@Injectable()
export class KitchenService {
  constructor(
    private readonly db: DatabaseService,
    private readonly orders: OrdersService,
  ) {}
  private async row(tx: Prisma.TransactionClient, p: Principal, id: string) {
    const row = await tx.kitchenTicket.findFirst({ where: { ...scope(p), id } });
    if (!row) throw new NotFoundException('Kitchen ticket not found');
    return row;
  }
  async get(p: Principal, id: string) {
    return kitchenRecord(await this.row(this.db.client, p, id));
  }
  async printer(p: Principal, id: string) {
    return printContract(await this.get(p, id));
  }
  async stations(p: Principal) {
    return this.db.client.kitchenStation.findMany({
      where: {
        ...scope(p),
        OR: [{ active: true, deletedAt: null }, { tickets: { some: {} } }],
      },
      select: { id: true, name: true, active: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
  }
  list(p: Principal, q: z.infer<typeof kitchenListSchema>) {
    return this.db.client.$transaction(
      async (tx) => {
        const revision = await tx.kitchenRevision.findFirst({ where: scope(p) });
        const rows = await tx.kitchenTicket.findMany({
          where: {
            ...scope(p),
            stationId: q.stationId,
            ...(q.view === 'active'
              ? { cancelledAt: null, status: { not: 'COMPLETED' as const } }
              : {}),
          },
          orderBy: [{ createdAt: q.view === 'active' ? 'asc' : 'desc' }, { id: 'asc' }],
          skip: (q.page - 1) * q.limit,
          take: q.limit + 1,
        });
        return {
          items: rows.slice(0, q.limit).map(kitchenRecord),
          page: q.page,
          hasMore: rows.length > q.limit,
          revision: revision?.revision.toString() ?? '0',
          serverTime: new Date().toISOString(),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async changes(p: Principal, q: z.infer<typeof layoutChangesSchema>, ticketId?: string) {
    if (ticketId) await this.get(p, ticketId);
    const rows = await this.db.client.kitchenEvent.findMany({
      where: { ...scope(p), ticketId, revision: { gt: BigInt(q.after) } },
      orderBy: { revision: 'asc' },
      take: q.limit + 1,
    });
    const events = rows.slice(0, q.limit).map((e) => ({
      id: e.id,
      ticketId: e.ticketId,
      orderId: e.orderId,
      revision: e.revision.toString(),
      ticketVersion: e.ticketVersion,
      action: e.action,
      userId: e.userId,
      createdAt: e.createdAt.toISOString(),
      ...(ticketId ? { snapshot: e.response } : {}),
    }));
    return { events, cursor: events.at(-1)?.revision ?? q.after, hasMore: rows.length > q.limit };
  }
  submit(p: Principal, id: string, input: z.infer<typeof kitchenSubmitSchema>) {
    const requestHash = hash({ kitchenSubmit: id, input });
    return this.db.client.$transaction(async (tx) => {
      const replay = await this.orders.replay(tx, p, input.commandId, requestHash);
      if (replay) return replay;
      const order = await this.orders.row(tx, p, id),
        before = record(order);
      if (order.version !== input.version || order.status !== 'OPEN')
        throw new ConflictException('Only the current open order can be submitted');
      if (await tx.kitchenSubmission.findFirst({ where: { ...scope(p), orderId: id } }))
        throw new ConflictException('Order was already submitted');
      const items = order.items.filter((i) => !i.voidedAt);
      if (!items.length) throw new ConflictException('Cannot submit an empty order');
      const products = await tx.product.findMany({
        where: { ...scope(p), id: { in: items.map((i) => i.productId) } },
        include: { kitchenStations: { include: { station: true } } },
      });
      const routed = new Map<string, { name: string; items: typeof items }>();
      // Collect every routing problem before rejecting, and name the products involved.
      // The rule itself is unchanged: an order still reaches the kitchen only when each
      // item routes to at least one station and every one of those stations is live.
      // Reporting all of them at once means the operator fixes the menu in one pass
      // instead of resubmitting to discover the next offending item.
      const unrouted: string[] = [];
      const unavailable = new Map<string, Set<string>>();
      for (const item of items) {
        const links = products.find((product) => product.id === item.productId)?.kitchenStations;
        if (!links?.length) {
          if (!unrouted.includes(item.productName)) unrouted.push(item.productName);
          continue;
        }
        const closed = links.filter((l) => !l.station.active || l.station.deletedAt);
        if (closed.length) {
          const stations = unavailable.get(item.productName) ?? new Set<string>();
          for (const link of closed) stations.add(link.station.name);
          unavailable.set(item.productName, stations);
          continue;
        }
        for (const link of links) {
          const route = routed.get(link.stationId) ?? { name: link.station.name, items: [] };
          route.items.push(item);
          routed.set(link.stationId, route);
        }
      }
      if (unrouted.length || unavailable.size) {
        // Product names come from the order's own frozen item snapshots, so this text
        // reflects what the operator sees on the bill. Problems are joined with '; ',
        // the separator the admin splits on, so each one is translated on its own.
        const problems = [
          ...unrouted.map((name) => `${name} has no active kitchen station assigned`),
          ...[...unavailable].map(
            ([name, stations]) =>
              `${name} is routed to unavailable station${stations.size > 1 ? 's' : ''} ` +
              `${[...stations].sort().join(', ')}`,
          ),
        ];
        throw new ConflictException(problems.join('; '));
      }
      const submission = await tx.kitchenSubmission.create({
        data: { ...scope(p), orderId: id, submittedBy: p.userId },
      });
      for (const [stationId, route] of [...routed].sort(([a], [b]) => a.localeCompare(b))) {
        const ticketId = randomUUID();
        const content: KitchenTicketContent = {
          schemaVersion: 1,
          ticketId,
          submissionId: submission.id,
          orderId: id,
          orderNumber: order.orderNumber.toString(),
          type: order.type,
          stationId,
          stationName: route.name,
          tableName: order.tableName,
          areaName: order.areaName,
          waiterName: order.waiterName,
          notes: order.notes,
          submittedAt: submission.createdAt.toISOString(),
          items: route.items.map((i) => ({
            orderItemId: i.id,
            productName: i.productName,
            quantity: i.quantity,
            notes: i.notes,
            modifiers: i.modifiers.map((m) => ({ groupName: m.groupName, name: m.name })),
          })),
        };
        const ticket = await tx.kitchenTicket.create({
          data: {
            ...scope(p),
            id: ticketId,
            orderId: id,
            submissionId: submission.id,
            stationId,
            content: JSON.parse(JSON.stringify(content)),
          },
        });
        await tx.kitchenTicketItem.createMany({
          data: route.items.map((i) => ({ ...scope(p), ticketId, itemId: i.id, orderId: id })),
        });
        await emitKitchen(tx, p, 'kitchen.ticket.created', kitchenRecord(ticket));
      }
      await tx.order.update({
        where: { ...scope(p), id, version: input.version },
        data: { status: 'SENT_TO_KITCHEN', version: { increment: 1 } },
      });
      if (order.tableId) await this.orders.tableStatus(tx, p, order.tableId, 'ORDER_SENT');
      return this.orders.event(
        tx,
        p,
        input.commandId,
        requestHash,
        'order.kitchen_submitted',
        record(await this.orders.row(tx, p, id)),
        before,
      );
    }, options);
  }
  transition(p: Principal, id: string, input: z.infer<typeof kitchenStateSchema>) {
    const requestHash = hash({ ticketId: id, input });
    return this.db.client.$transaction(async (tx) => {
      const replay = await tx.kitchenEvent.findFirst({
        where: { ...scope(p), commandId: input.commandId },
      });
      if (replay) {
        if (replay.userId !== p.userId || replay.requestHash !== requestHash)
          throw new ConflictException('Kitchen command ID was already used');
        return replay.response as unknown as KitchenTicketRecord;
      }
      const row = await this.row(tx, p, id);
      if (
        row.cancelledAt ||
        row.version !== input.version ||
        kitchenNext[row.status] !== input.status
      )
        throw new ConflictException('Ticket changed or transition is invalid');
      const order = await this.orders.row(tx, p, row.orderId);
      if (
        !['SENT_TO_KITCHEN', 'PREPARING', 'READY', 'WAITING_PAYMENT', 'PAID'].includes(order.status)
      )
        throw new ConflictException('Order no longer accepts kitchen changes');
      const ticket = await tx.kitchenTicket.update({
        where: { ...scope(p), id, version: input.version },
        data: {
          status: input.status,
          version: { increment: 1 },
          ...(input.status === 'PREPARING'
            ? { preparingAt: new Date() }
            : input.status === 'READY'
              ? { readyAt: new Date() }
              : { completedAt: new Date() }),
        },
      });
      const siblings = await tx.kitchenTicket.findMany({
        where: { ...scope(p), orderId: order.id, cancelledAt: null },
        select: { status: true },
      });
      const next =
        order.status === 'WAITING_PAYMENT'
          ? 'WAITING_PAYMENT'
          : aggregateKitchen(siblings.map((t) => t.status));
      if (order.status !== 'PAID') {
        await tx.order.update({
          where: { ...scope(p), id: order.id, version: order.version },
          data: { status: next, version: { increment: 1 } },
        });
        // Internal order event ID is distinct from the kitchen command replay namespace.
        await this.orders.event(
          tx,
          p,
          randomUUID(),
          requestHash,
          'order.kitchen_progress',
          record(await this.orders.row(tx, p, order.id)),
          record(order),
        );
      }
      const after = kitchenRecord(ticket);
      await emitKitchen(tx, p, 'kitchen.ticket.status_changed', after, kitchenRecord(row), {
        commandId: input.commandId,
        requestHash,
      });
      return after;
    }, options);
  }
}
