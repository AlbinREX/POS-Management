'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionUser, SyncHealth, SyncStatus } from '@restaurant/shared-types';
import { api } from '../lib/api';
import { serverMessage, useI18n } from '../lib/i18n';
import {
  classifyFailure,
  connectivityLabel,
  connectivityState,
  connectivityTone,
  syncLabel,
  syncTone,
} from '../lib/connectivity';

/**
 * Compact header indicator for the four operator-facing states: local server connected,
 * local server unavailable, internet unavailable and the cloud sync health. It polls a
 * cheap read; failure to reach it is itself the local-unavailable signal.
 *
 * Sync detail is deliberately minimal here. The per-stream breakdown lives in the
 * Owner/Admin dashboard, where a technical audience can act on it.
 *
 * This component sits in the application header, which is an ancestor of every screen,
 * so it must not re-render on a timer when nothing visible has changed. Only the three
 * displayed values are held in state, and an identical poll result is discarded. A poll
 * is also skipped while a modal dialog is open, following the same in-flight guard the
 * polling workspaces use, so a refresh never disturbs an interaction in progress.
 */
interface Display {
  health: SyncHealth;
  pending: number;
  reachable: boolean;
}
export function SyncIndicator({ user }: { user: SessionUser }) {
  const { t, locale } = useI18n();
  const canRead = user.permissions.includes('sync.read');
  const [display, setDisplay] = useState<Display>({
    health: 'disabled',
    pending: 0,
    reachable: true,
  });
  const [online, setOnline] = useState(true);
  const busy = useRef(false);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    addEventListener('online', update);
    addEventListener('offline', update);
    return () => {
      removeEventListener('online', update);
      removeEventListener('offline', update);
    };
  }, []);

  // Replace state only when a displayed value actually changed, so a steady connection
  // produces no render at all between polls.
  const apply = useCallback((next: Display) => {
    setDisplay((previous) =>
      previous.health === next.health &&
      previous.pending === next.pending &&
      previous.reachable === next.reachable
        ? previous
        : next,
    );
  }, []);

  const probe = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      // Reachability must never depend on a permission the session may not hold: probing
      // an authorized endpoint would log a 403 for operational roles and misreport a
      // healthy server. health/ready is public and cheap, so every role uses it.
      if (canRead) {
        const status = await api<SyncStatus>('sync/status');
        apply({ health: status.health, pending: status.pendingTotal, reachable: true });
      } else {
        await api<{ status: string }>('health/ready');
        apply({ health: 'disabled', pending: 0, reachable: true });
      }
    } catch (error) {
      // An HTTP status means the server answered, so the local link is fine.
      apply({
        health: 'disabled',
        pending: 0,
        reachable: classifyFailure(error) === 'local-connected',
      });
    } finally {
      busy.current = false;
    }
  }, [canRead, apply]);

  useEffect(() => {
    void probe();
    const timer = setInterval(() => {
      // A refresh must never re-render the page shell underneath an open modal.
      if (!document.querySelector('dialog[open]')) void probe();
    }, 15000);
    return () => clearInterval(timer);
  }, [probe]);

  const state = connectivityState(display.reachable, online);
  const syncText = display.health === 'pending'
    ? t(display.pending === 1 ? 'report.cloudPendingOne' : 'report.cloudPending', { count: display.pending })
    : serverMessage(syncLabel(display.health, display.pending), locale);
  const connectionText = serverMessage(connectivityLabel(state), locale);
  const detail = canRead ? ` · ${syncText}` : '';
  return (
    <p
      className="sync-indicator"
      role="status"
      aria-label={`${connectionText}${detail}`}
      title={`${connectionText}${detail}`}
    >
      <span className="sync-dot" data-tone={connectivityTone(state)} aria-hidden="true" />
      <span>{connectionText}</span>
      {canRead ? (
        <>
          <span className="sync-dot" data-tone={syncTone(display.health)} aria-hidden="true" />
          <span>{syncText}</span>
        </>
      ) : null}
    </p>
  );
}
