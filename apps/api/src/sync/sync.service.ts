// Phase 12 outbound delivery state.
//
// Read-only with respect to business data. The seven per-module event logs are the
// durable outbox, each row committed in the same transaction as its business change.
// This service reports how far an optional cloud consumer has confirmed delivery and
// advances that checkpoint. It never reads, rewrites or reconciles business records,
// and a checkpoint can never overwrite local state.
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@restaurant/database';
import {
  SYNC_STREAMS,
  type SyncStatus,
  type SyncStream,
  type SyncStreamStatus,
} from '@restaurant/shared-types';
import type { Principal } from '../auth/auth.service';
import { DatabaseService } from '../database.service';
import { inventoryScope as scope } from '../inventory/inventory.transactions';
import { isDegraded, pendingCount, pendingTotal, syncHealth } from './sync-state';

type Tx = Prisma.TransactionClient;
const read = { isolationLevel: 'RepeatableRead' as const };

/** True only when an operator has configured a cloud target for this deployment. */
export const syncEnabled = () => Boolean(process.env.SYNC_TARGET_URL);

@Injectable()
export class SyncService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Latest locally committed revision per stream. Each module keeps its own revision
   * counter, updated atomically with its events, so this is the authoritative high-water
   * mark of local business history.
   */
  private async localRevisions(tx: Tx, p: Principal): Promise<Record<SyncStream, bigint>> {
    const where = scope(p);
    const [layout, orders, kitchen, payments, inventory, purchasing, companies] = await Promise.all(
      [
        tx.layoutRevision.findFirst({ where, select: { revision: true } }),
        // Orders have no dedicated revision row; the event log itself carries the cursor.
        tx.orderEvent.findFirst({
          where,
          orderBy: { revision: 'desc' },
          select: { revision: true },
        }),
        tx.kitchenRevision.findFirst({ where, select: { revision: true } }),
        tx.paymentRevision.findFirst({ where, select: { revision: true } }),
        tx.inventoryRevision.findFirst({ where, select: { revision: true } }),
        tx.purchasingRevision.findFirst({ where, select: { revision: true } }),
        tx.companiesRevision.findFirst({ where, select: { revision: true } }),
      ],
    );
    return {
      layout: layout?.revision ?? 0n,
      orders: orders?.revision ?? 0n,
      kitchen: kitchen?.revision ?? 0n,
      payments: payments?.revision ?? 0n,
      inventory: inventory?.revision ?? 0n,
      purchasing: purchasing?.revision ?? 0n,
      companies: companies?.revision ?? 0n,
    };
  }

  /** Branch-scoped delivery status. Never blocks and never mutates business data. */
  status(p: Principal, only?: SyncStream): Promise<SyncStatus> {
    return this.db.client.$transaction(async (tx) => {
      const local = await this.localRevisions(tx, p);
      const checkpoints = await tx.syncCheckpoint.findMany({ where: scope(p) });
      const wanted = only ? [only] : [...SYNC_STREAMS];
      const streams = wanted.map<SyncStreamStatus>((stream) => {
        const row = checkpoints.find((c) => c.stream === stream);
        const localRevision = (local[stream] ?? 0n).toString();
        const deliveredRevision = (row?.deliveredRevision ?? 0n).toString();
        return {
          stream,
          localRevision,
          deliveredRevision,
          pending: pendingCount(localRevision, deliveredRevision),
          lastDeliveredAt: row?.lastDeliveredAt?.toISOString() ?? null,
          lastAttemptAt: row?.lastAttemptAt?.toISOString() ?? null,
          lastError: row?.lastError ?? null,
          failedAttempts: row?.failedAttempts ?? 0,
        };
      });
      const enabled = syncEnabled();
      return {
        localAuthoritative: true,
        enabled,
        health: syncHealth(streams, enabled),
        branchId: p.branchId,
        organizationId: p.organizationId,
        serverTime: new Date().toISOString(),
        pendingTotal: pendingTotal(streams),
        streams,
        degraded: isDegraded(streams),
      };
    }, read);
  }

  /**
   * Record a delivery outcome for one branch and stream.
   *
   * A cursor only ever moves forward: a stale or replayed acknowledgement is ignored
   * rather than rewinding delivery, and no business row is touched either way. Failures
   * are recorded so a silent delivery error can never be displayed as healthy.
   */
  async record(
    branchId: string,
    organizationId: string,
    stream: SyncStream,
    outcome: { deliveredRevision?: bigint; error?: string },
  ): Promise<void> {
    const now = new Date();
    const existing = await this.db.client.syncCheckpoint.findFirst({
      where: { branchId, organizationId, stream },
      select: { id: true, deliveredRevision: true, failedAttempts: true },
    });
    if (outcome.error !== undefined) {
      const data = {
        lastAttemptAt: now,
        lastError: outcome.error.slice(0, 500),
        failedAttempts: (existing?.failedAttempts ?? 0) + 1,
      };
      if (existing)
        await this.db.client.syncCheckpoint.update({ where: { id: existing.id }, data });
      else
        await this.db.client.syncCheckpoint.create({
          data: { branchId, organizationId, stream, ...data },
        });
      return;
    }
    const delivered = outcome.deliveredRevision ?? 0n;
    // Monotonic: never rewind a delivered cursor from an out-of-order acknowledgement.
    const next =
      existing && existing.deliveredRevision > delivered ? existing.deliveredRevision : delivered;
    const data = {
      deliveredRevision: next,
      lastAttemptAt: now,
      lastDeliveredAt: now,
      lastError: null,
      failedAttempts: 0,
    };
    if (existing) await this.db.client.syncCheckpoint.update({ where: { id: existing.id }, data });
    else
      await this.db.client.syncCheckpoint.create({
        data: { branchId, organizationId, stream, ...data },
      });
  }
}
