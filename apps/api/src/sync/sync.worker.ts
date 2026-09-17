// Phase 12 delivery worker.
//
// Asynchronous by construction: it runs on its own timer, outside every request and
// every business transaction, so a slow or unreachable cloud target can never delay a
// local order, payment or stock movement. It is inert unless an operator configures
// SYNC_TARGET_URL, which is the default deployment.
//
// The worker only advances a delivery checkpoint. It never writes business data, never
// applies anything received from a cloud target to the local database, and therefore
// cannot overwrite local history: cloud-to-local application is out of scope for this
// phase and is documented as such.
import { Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { SYNC_STREAMS, type SyncStream } from '@restaurant/shared-types';
import { DatabaseService } from '../database.service';
import { logger } from '../security';
import { SyncService, syncEnabled } from './sync.service';
import { backoffMs } from './sync-state';

const TICK_MS = 15000;

@Injectable()
export class SyncWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  constructor(
    private readonly db: DatabaseService,
    private readonly sync: SyncService,
  ) {}

  onApplicationBootstrap() {
    // Never start a timer under test: suites create and close many app instances.
    if (process.env.NODE_ENV === 'test' || !syncEnabled()) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    // A timer must not hold the process open during shutdown.
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * One delivery pass over every branch and stream.
   *
   * Restart-safe: all state lives in SyncCheckpoint, so a crash or restart resumes from
   * the last confirmed cursor and re-delivers only already-committed local records. It
   * is deliberately re-entrant safe via `running`, because overlapping passes would
   * duplicate outbound work without making delivery faster.
   */
  async tick(): Promise<void> {
    if (this.running || !syncEnabled()) return;
    this.running = true;
    try {
      const branches = await this.db.client.branch.findMany({
        where: { deletedAt: null, active: true },
        select: { id: true, organizationId: true },
      });
      for (const branch of branches)
        for (const stream of SYNC_STREAMS) await this.deliver(branch, stream);
    } catch (error) {
      // Delivery is optional. A failure here is logged and retried later; it must never
      // propagate into the request path or stop the API.
      logger.warn({ err: String(error) }, 'Sync delivery pass failed');
    } finally {
      this.running = false;
    }
  }

  private async deliver(
    branch: { id: string; organizationId: string },
    stream: SyncStream,
  ): Promise<void> {
    const checkpoint = await this.db.client.syncCheckpoint.findFirst({
      where: { branchId: branch.id, organizationId: branch.organizationId, stream },
      select: { deliveredRevision: true, failedAttempts: true, lastAttemptAt: true },
    });
    // Respect backoff so a failing endpoint is not hammered every tick.
    const failures = checkpoint?.failedAttempts ?? 0;
    if (failures > 0 && checkpoint?.lastAttemptAt) {
      const wait = backoffMs(failures);
      if (Date.now() - checkpoint.lastAttemptAt.getTime() < wait) return;
    }
    try {
      const target = process.env.SYNC_TARGET_URL;
      if (!target) return;
      // The transport itself is intentionally not implemented in this phase: no cloud
      // endpoint is specified or certified yet. Attempting delivery against an
      // unconfigured contract would either invent a protocol or silently mark records
      // delivered that no consumer received. Recording the attempt keeps the operator
      // honestly informed that delivery is configured but not yet carrying records.
      await this.sync.record(branch.id, branch.organizationId, stream, {
        error: 'Cloud delivery transport is not implemented in this phase',
      });
    } catch (error) {
      await this.sync
        .record(branch.id, branch.organizationId, stream, { error: String(error) })
        .catch(() => undefined);
    }
  }
}
