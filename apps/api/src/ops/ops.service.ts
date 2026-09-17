// Phase 13 operational status.
//
// Read-only. It reports whether the local database answers, whether the backup is recent
// and succeeded, whether Phase 12 delivery is backed up, and whether the volume is
// filling. It never returns a credential, connection string, archive content, driver
// error or business record, and it writes nothing.
import { Injectable } from '@nestjs/common';
import { readFile, statfs } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { OpsStatus } from '@restaurant/shared-types';
import type { Principal } from '../auth/auth.service';
import { DatabaseService } from '../database.service';
import { SyncService } from '../sync/sync.service';
import {
  buildChecks,
  classifyBackup,
  classifyStorage,
  classifySync,
  worstSeverity,
} from './ops-state';

/** The backup script writes this beside the archives; the API mounts it read-only. */
const BACKUP_STATUS = process.env.BACKUP_STATUS_FILE ?? '/backups/backup-status.json';

@Injectable()
export class OpsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly sync: SyncService,
  ) {}

  private async database() {
    const started = Date.now();
    try {
      await this.db.client.$queryRaw`SELECT 1`;
      return { severity: 'ok' as const, reachable: true, latencyMs: Date.now() - started };
    } catch {
      // The driver message can carry host and role detail, so it is never surfaced.
      return { severity: 'critical' as const, reachable: false, latencyMs: null };
    }
  }

  private async backup(now: Date) {
    try {
      // Tolerate a byte-order mark: some editors and shells prepend one, and a BOM
      // must never be the reason an operator is told their backups are missing.
      const text = (await readFile(resolve(BACKUP_STATUS), 'utf8')).replace(/^﻿/, '');
      const raw = JSON.parse(text) as Record<string, unknown>;
      return classifyBackup(
        {
          archive: typeof raw.archive === 'string' ? raw.archive : null,
          lastSuccessAt: typeof raw.lastSuccessAt === 'string' ? raw.lastSuccessAt : null,
          lastAttemptAt: typeof raw.lastAttemptAt === 'string' ? raw.lastAttemptAt : null,
          sizeBytes: typeof raw.sizeBytes === 'number' ? raw.sizeBytes : null,
          outcome: typeof raw.outcome === 'string' ? raw.outcome : null,
          error: typeof raw.error === 'string' ? raw.error : null,
        },
        now,
      );
    } catch {
      // Missing or unreadable means no verified protection, which classifyBackup treats
      // as critical rather than unknown.
      return classifyBackup(null, now);
    }
  }

  private async storage() {
    try {
      // statfs reports the filesystem holding the API's working directory, which in the
      // deployed stack shares the host volume with the database and archives.
      const stats = await statfs(resolve('/app'));
      const total = Number(stats.blocks) * Number(stats.bsize);
      const free = Number(stats.bavail) * Number(stats.bsize);
      return classifyStorage(
        Number.isFinite(free) ? free : null,
        Number.isFinite(total) ? total : null,
      );
    } catch {
      return classifyStorage(null, null);
    }
  }

  async status(p: Principal): Promise<OpsStatus> {
    const now = new Date();
    const [database, backup, storage] = await Promise.all([
      this.database(),
      this.backup(now),
      this.storage(),
    ]);
    // Delivery state is branch-scoped and already read-only in Phase 12.
    const sync = await this.sync.status(p);
    const syncSeverity = classifySync(sync.health, sync.pendingTotal);
    const checks = buildChecks({
      database: database.severity,
      backup,
      sync: syncSeverity,
      storage,
    });
    return {
      severity: worstSeverity(checks.map((c) => c.severity)),
      serverTime: now.toISOString(),
      localAuthoritative: true,
      nodeEnv: process.env.NODE_ENV ?? 'development',
      uptimeSeconds: Math.floor(process.uptime()),
      database,
      backup,
      sync: {
        severity: syncSeverity,
        health: sync.health,
        pendingTotal: sync.pendingTotal,
        degraded: sync.degraded,
      },
      storage,
      checks,
    };
  }
}
