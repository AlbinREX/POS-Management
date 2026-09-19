'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  KitchenPage,
  KitchenStatus,
  KitchenTicketRecord,
  SessionUser,
} from '@restaurant/shared-types';
import { Button } from '@restaurant/ui/button';
import { Input } from '@restaurant/ui/input';
import { api, ApiFailure } from '../lib/api';
import { useI18n, formatDateTime, serverMessage } from '../lib/i18n';
import { SALES_VALUE_KEYS } from '../lib/i18n/sales-messages';
const next: Partial<Record<KitchenStatus, KitchenStatus>> = {
  NEW: 'PREPARING',
  PREPARING: 'READY',
  READY: 'COMPLETED',
};
const label: Partial<Record<KitchenStatus, 'sales.startPreparing' | 'sales.markReady' | 'sales.completeTicket'>> = {
  NEW: 'sales.startPreparing',
  PREPARING: 'sales.markReady',
  READY: 'sales.completeTicket',
};
type Receipt = {
  ticketId: string;
  body: { commandId: string; version: number; status: KitchenStatus };
};
export function KitchenDisplay({ user }: { user: SessionUser }) {
  const { t, locale } = useI18n();
  const valueLabel = (value: string) => SALES_VALUE_KEYS[value] ? t(SALES_VALUE_KEYS[value]) : value;
  const [tickets, setTickets] = useState<KitchenTicketRecord[]>([]),
    [stations, setStations] = useState<{ id: string; name: string; active: boolean }[]>([]);
  const [station, setStation] = useState(''),
    [view, setView] = useState('active'),
    [page, setPage] = useState(1),
    [more, setMore] = useState(false);
  const [stale, setStale] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [pending, setPending] = useState<Receipt | null>(null);
  const [clock, setClock] = useState(0),
    [offset, setOffset] = useState(0),
    [delay, setDelay] = useState(15),
    [history, setHistory] = useState<{ id: string; action: string; createdAt: string }[]>([]);
  const generation = useRef(0),
    busyRef = useRef(false);
  const storage = `restaurant-kitchen-command:${user.organizationId}:${user.branchId}:${user.id}`;
  const canManage = user.permissions.includes('kitchen.manage');
  useEffect(() => {
    const saved = sessionStorage.getItem(storage);
    if (saved) {
      try {
        setPending(JSON.parse(saved));
      } catch {
        sessionStorage.removeItem(storage);
      }
    }
  }, [storage]);
  const reload = useCallback(async () => {
    const request = ++generation.current;
    try {
      const [result, stationRows] = await Promise.all([
        api<KitchenPage>(
          `kitchen/tickets?view=${view}&page=${page}&limit=24${station ? '&stationId=' + station : ''}`,
        ),
        api<{ id: string; name: string; active: boolean }[]>('kitchen/stations'),
      ]);
      if (request !== generation.current || busyRef.current) return;
      setTickets(result.items);
      setMore(result.hasMore);
      setStations(stationRows);
      setOffset(Date.parse(result.serverTime) - Date.now());
      setStale(false);
    } catch (e) {
      if (request !== generation.current) return;
      setStale(true);
      setError(
        e instanceof ApiFailure
          ? e.message
          : 'Local server unavailable. Ticket updates are paused.',
      );
    }
  }, [station, view, page]);
  useEffect(() => {
    void reload();
    const counter = generation;
    const timer = setInterval(() => {
      if (!busyRef.current) void reload();
    }, 5000);
    return () => {
      clearInterval(timer);
      counter.current++;
    };
  }, [reload]);
  useEffect(() => {
    setClock(Date.now());
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const execute = async (receipt: Receipt) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    generation.current++;
    setError('');
    try {
      sessionStorage.setItem(storage, JSON.stringify(receipt));
      setPending(receipt);
      await api(`kitchen/tickets/${receipt.ticketId}/state`, 'POST', receipt.body);
      sessionStorage.removeItem(storage);
      setPending(null);
    } catch (e) {
      if (e instanceof ApiFailure && e.status >= 400 && e.status < 500) {
        sessionStorage.removeItem(storage);
        setPending(null);
      }
      setError(
        e instanceof ApiFailure
          ? e.message
          : 'Update outcome unknown. Retry the pending ticket command.',
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
      setStale(true);
      void reload();
    }
  };
  return (
    <div className="space-y-5 [overflow-wrap:anywhere]">
      <div className="flex flex-wrap items-end gap-4">
        <label className="min-w-0 max-w-full">
          {t('sales.kitchenStation')}
          <select
            aria-label={t('sales.kitchenStation')}
            className="block min-h-12 w-full min-w-0 max-w-full rounded-md border bg-background p-3"
            value={station}
            onChange={(e) => {
              setStation(e.target.value);
              setPage(1);
              setStale(true);
            }}
          >
            <option value="">{t('sales.allStations')}</option>
            {stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.active ? '' : t('sales.inactiveRouting')}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('sales.ticketView')}
          <select
            aria-label={t('sales.ticketView')}
            className="block min-h-12 rounded-md border bg-background p-3"
            value={view}
            onChange={(e) => {
              setView(e.target.value);
              setPage(1);
              setStale(true);
            }}
          >
            <option value="active">{t('sales.activeTickets')}</option>
            <option value="history">{t('sales.allTicketHistory')}</option>
          </select>
        </label>
        <label className="w-40">
          {t('sales.delayWarningMinutes')}
          <Input
            type="number"
            min={1}
            max={240}
            value={delay}
            onChange={(e) => setDelay(Math.max(1, Math.min(240, Number(e.target.value) || 1)))}
            className="min-h-12"
          />
        </label>
        <Button
          variant="outline"
          disabled={busy}
          className="min-h-12"
          onClick={() => {
            setError('');
            void reload();
          }}
        >
          {t('sales.refreshKitchen')}
        </Button>
      </div>
      <p role="status">
        {stale
          ? t('sales.kitchenDisconnected')
          : t('sales.kitchenConnected')}
      </p>
      {error ? (
        <p role="alert" className="rounded-md border border-destructive p-3 text-destructive">
          {serverMessage(error, locale)}
        </p>
      ) : null}
      {pending ? (
        <div className="rounded-md border border-amber-600 p-4">
          <p>{t('sales.aTicketUpdateNeedsConfirmationBeforeAnotherChange')}</p>
          <Button
            disabled={busy || !canManage}
            className="mt-3 min-h-12"
            onClick={() => void execute(pending)}
          >
            {t('sales.retryKitchenCommand')}
          </Button>
        </div>
      ) : null}
      {!tickets.length ? (
        <p className="rounded-lg border p-8 text-lg">{t('sales.noTicketsInThisView')}</p>
      ) : null}
      <div className="grid items-start gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {tickets.map((ticket) => {
          const end = ticket.cancelledAt ?? ticket.completedAt;
          const minutes = Math.max(
            0,
            Math.floor(
              ((end ? Date.parse(end) : clock + offset) - Date.parse(ticket.createdAt)) / 60000,
            ),
          );
          const delayed = !end && ticket.status !== 'READY' && minutes >= delay;
          return (
            <article
              aria-label={t('sales.ticketName', { number: ticket.content.orderNumber, station: ticket.content.stationName })}
              key={ticket.id}
              className={`space-y-4 rounded-xl border-2 p-5 ${ticket.cancelledAt ? 'border-slate-600 bg-slate-900' : delayed ? 'border-red-400 bg-red-950/30' : ticket.status === 'READY' ? 'border-emerald-400 bg-emerald-950/30' : 'border-amber-500/50 bg-card'}`}
            >
              <header>
                <div className="flex flex-wrap justify-between gap-2">
                  <h2 className="text-2xl font-bold">
                    #{ticket.content.orderNumber} · {ticket.content.stationName}
                  </h2>
                  <strong>{minutes} min</strong>
                </div>
                <p className="text-lg">
                  {ticket.content.tableName
                    ? `${ticket.content.areaName} / ${ticket.content.tableName}`
                    : t('sales.waiterTakeaway')}
                </p>
                <p>{t('sales.waiter')} {ticket.content.waiterName ?? t('sales.unassigned')}</p>
                <p className="mt-2 text-xl font-bold">
                  {valueLabel(ticket.cancelledAt ? 'CANCELLED' : ticket.status)}
                </p>
                {delayed ? <p className="font-bold text-red-300">{t('sales.delayedPreparation')}</p> : null}
              </header>
              {ticket.content.notes ? (
                <p className="rounded-md border p-2 font-semibold">{ticket.content.notes}</p>
              ) : null}
              <ul className="space-y-4">
                {ticket.content.items.map((item) => (
                  <li key={item.orderItemId}>
                    <p className="text-2xl font-bold">
                      {item.quantity} × {item.productName}
                    </p>
                    {item.modifiers.map((m, i) => (
                      <p className="text-lg" key={i}>
                        {m.groupName}: {m.name}
                      </p>
                    ))}
                    {item.notes ? (
                      <p className="text-lg font-semibold">{t('sales.note')} {item.notes}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
              {ticket.cancellationReason ? (
                <p className="font-semibold text-red-300">
                  {t('sales.cancellation')} {ticket.cancellationReason}
                </p>
              ) : null}
              {next[ticket.status] && !ticket.cancelledAt && canManage ? (
                <Button
                  className="min-h-14 w-full text-lg"
                  disabled={stale || busy || !!pending}
                  onClick={() =>
                    void execute({
                      ticketId: ticket.id,
                      body: {
                        commandId: crypto.randomUUID(),
                        version: ticket.version,
                        status: next[ticket.status]!,
                      },
                    })
                  }
                >
                  {label[ticket.status] ? t(label[ticket.status]!) : null}
                </Button>
              ) : null}
              <Button
                variant="outline"
                className="min-h-12"
                onClick={async () => {
                  try {
                    const result = await api<{
                      events: { id: string; action: string; createdAt: string }[];
                    }>(`kitchen/tickets/${ticket.id}/history`);
                    setHistory(result.events);
                  } catch {
                    setError('Ticket history is unavailable.');
                  }
                }}
              >
                {t('sales.ticketHistory')}
              </Button>
            </article>
          );
        })}
      </div>
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          disabled={page === 1 || busy}
          onClick={() => {
            setPage((p) => p - 1);
            setStale(true);
          }}
        >
          {t('sales.previousTickets')}
        </Button>
        <span>{t('sales.page')} {page}</span>
        <Button
          variant="outline"
          disabled={!more || busy}
          onClick={() => {
            setPage((p) => p + 1);
            setStale(true);
          }}
        >
          {t('sales.nextTickets')}
        </Button>
      </div>
      {history.length ? (
        <section aria-label={t('sales.kitchenHistory')} className="rounded-md border p-4">
          <div className="flex justify-between">
            <h2 className="font-semibold">{t('sales.ticketHistoryFirst100Events')}</h2>
            <Button variant="ghost" onClick={() => setHistory([])}>
              {t('sales.closeHistory')}
            </Button>
          </div>
          <ol>
            {history.map((h) => (
              <li key={h.id}>
                {valueLabel(h.action)} · {formatDateTime(h.createdAt, locale)}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
