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
const next: Partial<Record<KitchenStatus, KitchenStatus>> = {
  NEW: 'PREPARING',
  PREPARING: 'READY',
  READY: 'COMPLETED',
};
const label: Partial<Record<KitchenStatus, string>> = {
  NEW: 'Start preparing',
  PREPARING: 'Mark ready',
  READY: 'Complete ticket',
};
type Receipt = {
  ticketId: string;
  body: { commandId: string; version: number; status: KitchenStatus };
};
export function KitchenDisplay({ user }: { user: SessionUser }) {
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
          Kitchen station
          <select
            aria-label="Kitchen station"
            className="block min-h-12 w-full min-w-0 max-w-full rounded-md border bg-background p-3"
            value={station}
            onChange={(e) => {
              setStation(e.target.value);
              setPage(1);
              setStale(true);
            }}
          >
            <option value="">All stations</option>
            {stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.active ? '' : ' (inactive routing)'}
              </option>
            ))}
          </select>
        </label>
        <label>
          Ticket view
          <select
            aria-label="Ticket view"
            className="block min-h-12 rounded-md border bg-background p-3"
            value={view}
            onChange={(e) => {
              setView(e.target.value);
              setPage(1);
              setStale(true);
            }}
          >
            <option value="active">Active tickets</option>
            <option value="history">All ticket history</option>
          </select>
        </label>
        <label className="w-40">
          Delay warning (minutes)
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
          Refresh kitchen
        </Button>
      </div>
      <p role="status">
        {stale
          ? 'Kitchen disconnected or refreshing · Updates paused'
          : 'Connected · Kitchen refreshed every 5 seconds'}
      </p>
      {error ? (
        <p role="alert" className="rounded-md border border-destructive p-3 text-destructive">
          {error}
        </p>
      ) : null}
      {pending ? (
        <div className="rounded-md border border-amber-600 p-4">
          <p>A ticket update needs confirmation before another change.</p>
          <Button
            disabled={busy || !canManage}
            className="mt-3 min-h-12"
            onClick={() => void execute(pending)}
          >
            Retry kitchen command
          </Button>
        </div>
      ) : null}
      {!tickets.length ? (
        <p className="rounded-lg border p-8 text-lg">No tickets in this view.</p>
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
              aria-label={`Ticket ${ticket.content.orderNumber} ${ticket.content.stationName}`}
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
                    : 'Takeaway'}
                </p>
                <p>Waiter: {ticket.content.waiterName ?? 'Unassigned'}</p>
                <p className="mt-2 text-xl font-bold">
                  {ticket.cancelledAt ? 'CANCELLED' : ticket.status}
                </p>
                {delayed ? <p className="font-bold text-red-300">Delayed preparation</p> : null}
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
                      <p className="text-lg font-semibold">Note: {item.notes}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
              {ticket.cancellationReason ? (
                <p className="font-semibold text-red-300">
                  Cancellation: {ticket.cancellationReason}
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
                  {label[ticket.status]}
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
                Ticket history
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
          Previous tickets
        </Button>
        <span>Page {page}</span>
        <Button
          variant="outline"
          disabled={!more || busy}
          onClick={() => {
            setPage((p) => p + 1);
            setStale(true);
          }}
        >
          Next tickets
        </Button>
      </div>
      {history.length ? (
        <section aria-label="Kitchen history" className="rounded-md border p-4">
          <div className="flex justify-between">
            <h2 className="font-semibold">Ticket history (first 100 events)</h2>
            <Button variant="ghost" onClick={() => setHistory([])}>
              Close history
            </Button>
          </div>
          <ol>
            {history.map((h) => (
              <li key={h.id}>
                {h.action} · {new Date(h.createdAt).toLocaleString()}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
