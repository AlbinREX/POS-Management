'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  CashMovementRecord,
  CashShiftRecord,
  OrderRecord,
  PaymentSummary,
  SessionUser,
} from '@restaurant/shared-types';
import { Button } from '@restaurant/ui/button';
import { Input } from '@restaurant/ui/input';
import { api, ApiFailure } from '../lib/api';
import { FiscalStatus } from './fiscal-status';

type Pending = { path: string; body: Record<string, unknown> };
type Detail = { shift: CashShiftRecord; movements: CashMovementRecord[]; hasMore: boolean };
type History = {
  events: { id: string; action: string; createdAt: string; revision: string }[];
  cursor: string;
  hasMore: boolean;
};
const selectClass = 'min-h-12 w-full rounded-md border bg-background px-3';
const format = (value: bigint) => `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
const cents = (value: string) => BigInt(value.replace('.', ''));

export function PaymentsWorkspace({
  user,
  initialOrderId = '',
  initialMethod = 'CASH',
}: {
  user: SessionUser;
  initialOrderId?: string;
  initialMethod?: string;
}) {
  const can = (key: SessionUser['permissions'][number]) => user.permissions.includes(key);
  const read = can('payment.read') && can('order.read'),
    cashRead = can('cash.shift.read');
  const storageKey = `restaurant-payment-command:v1:${user.organizationId}:${user.branchId}:${user.id}`;
  const [orders, setOrders] = useState<OrderRecord[]>([]),
    [summary, setSummary] = useState<PaymentSummary | null>(null);
  const [selected, setSelected] = useState(initialOrderId),
    [status, setStatus] = useState('WAITING_PAYMENT'),
    [page, setPage] = useState(1),
    [more, setMore] = useState(false);
  const [shifts, setShifts] = useState<CashShiftRecord[]>([]),
    [currentShift, setCurrentShift] = useState<CashShiftRecord | null>(null),
    [terminals, setTerminals] = useState<{ id: string; name: string }[]>([]);
  const [shiftPage, setShiftPage] = useState(1),
    [shiftMore, setShiftMore] = useState(false),
    [shiftId, setShiftId] = useState(''),
    [shiftDetail, setShiftDetail] = useState<Detail | null>(null),
    [movementPage, setMovementPage] = useState(1);
  const [mode, setMode] = useState<'AMOUNT' | 'ITEMS'>('AMOUNT'),
    [method, setMethod] = useState(initialMethod === 'CARD' ? 'CARD' : 'CASH'),
    [cash, setCash] = useState(''),
    [card, setCard] = useState(''),
    [units, setUnits] = useState<Record<string, number>>({});
  const [pending, setPending] = useState<Pending | null>(null),
    [busy, setBusy] = useState(false),
    [stale, setStale] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [history, setHistory] = useState<History>({ events: [], cursor: '0', hasMore: false });
  const busyRef = useRef(false),
    generation = useRef(0);
  useEffect(() => {
    const stored = sessionStorage.getItem(storageKey);
    if (stored)
      try {
        const parsed = JSON.parse(stored);
        if (
          typeof parsed.path === 'string' &&
          parsed.path.startsWith('payments/') &&
          parsed.body?.commandId
        )
          setPending(parsed);
        else throw new Error('Invalid receipt');
      } catch {
        setError(
          'Stored payment receipt is unreadable. Inspect payment history before collecting again.',
        );
        setPending({ path: '', body: {} });
      }
  }, [storageKey]);
  const reload = useCallback(async () => {
    const revision = ++generation.current;
    try {
      const [list, detail, registers, available, drawer, events] = await Promise.all([
        read
          ? api<{ items: OrderRecord[]; hasMore: boolean }>(
              `orders?status=${status}&page=${page}&limit=20`,
            )
          : Promise.resolve({ items: [], hasMore: false }),
        read && selected
          ? api<PaymentSummary>(`payments/orders/${selected}`)
          : Promise.resolve(null),
        cashRead
          ? api<{ items: CashShiftRecord[]; current: CashShiftRecord | null; hasMore: boolean }>(
              `payments/shifts?page=${shiftPage}&limit=20`,
            )
          : Promise.resolve({ items: [], current: null, hasMore: false }),
        cashRead
          ? api<{ id: string; name: string }[]>('payments/terminals?limit=100')
          : Promise.resolve([]),
        cashRead && shiftId
          ? api<Detail>(`payments/shifts/${shiftId}?page=${movementPage}&limit=20`)
          : Promise.resolve(null),
        read && selected
          ? api<History>(`payments/orders/${selected}/history?limit=50`)
          : Promise.resolve({ events: [], cursor: '0', hasMore: false }),
      ]);
      if (revision !== generation.current || busyRef.current) return;
      setOrders(list.items);
      setMore(list.hasMore);
      setSummary(detail);
      setShifts(registers.items);
      setCurrentShift(registers.current);
      setShiftMore(registers.hasMore);
      setTerminals(available);
      setShiftDetail(drawer);
      setHistory(events);
      setStale(false);
    } catch (e) {
      if (revision === generation.current) {
        setStale(true);
        setError(e instanceof Error ? e.message : 'Local server unavailable');
      }
    }
  }, [read, cashRead, selected, page, status, shiftPage, shiftId, movementPage]);
  useEffect(() => {
    void reload();
    const timer = setInterval(() => {
      if (!busyRef.current) void reload();
    }, 5000);
    const counter = generation;
    return () => {
      clearInterval(timer);
      counter.current++;
    };
  }, [reload]);
  async function execute(command: Pending) {
    if (busyRef.current || !command.path) return;
    busyRef.current = true;
    setBusy(true);
    generation.current++;
    setError('');
    setNotice('');
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(command));
      setPending(command);
      const result = await api<{
        payments?: { amount: string; method: string; change: string | null }[];
      }>(command.path, 'POST', command.body);
      sessionStorage.removeItem(storageKey);
      setPending(null);
      setUnits({});
      setCash('');
      setCard('');
      setNotice(
        result.payments
          ? result.payments
              .map(
                (p) => `${p.method} ${p.amount}${p.change !== null ? ` · Change ${p.change}` : ''}`,
              )
              .join(' / ')
          : 'Recorded successfully.',
      );
    } catch (e) {
      if (e instanceof ApiFailure && e.status < 500) {
        sessionStorage.removeItem(storageKey);
        setPending(null);
      }
      setError(e instanceof Error ? e.message : 'Response uncertain. Retry the saved command.');
    } finally {
      busyRef.current = false;
      setBusy(false);
      await reload();
    }
  }
  const send = (path: string, body: Record<string, unknown>) => {
    if (!stale && !pending && !busyRef.current)
      void execute({ path, body: { commandId: crypto.randomUUID(), ...body } });
  };
  const disabled = stale || busy || !!pending;
  const billMode = summary?.mode ?? mode;
  const chooseOrder = (id: string) => {
    generation.current++;
    setSelected(id);
    setSummary(null);
    setStale(true);
    setUnits({});
    setCash('');
    setCard('');
    setNotice('');
  };
  function collect(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!summary) return;
    const form = new FormData(e.currentTarget),
      tenders: Record<string, unknown>[] = [];
    if (billMode === 'AMOUNT') {
      if (cash && cash !== '0.00')
        tenders.push({
          method: 'CASH',
          amount: cash,
          tendered: form.get('tendered'),
          shiftId: currentShift?.id,
        });
      if (card && card !== '0.00')
        tenders.push({ method: 'CARD', amount: card, transactionReference: form.get('reference') });
    } else
      tenders.push({
        method,
        items: Object.entries(units)
          .filter(([, quantity]) => quantity > 0)
          .map(([itemId, quantity]) => ({ itemId, quantity })),
        ...(method === 'CASH'
          ? { tendered: form.get('tendered'), shiftId: currentShift?.id }
          : { transactionReference: form.get('reference') }),
      });
    send(`payments/orders/${summary.order.id}/collect`, {
      version: summary.order.version,
      mode: billMode,
      tenders,
    });
  }
  const cashUsed = billMode === 'AMOUNT' ? !!cash && cash !== '0.00' : method === 'CASH';
  const cardUsed = billMode === 'AMOUNT' ? !!card && card !== '0.00' : method === 'CARD';
  return (
    <div className="space-y-6">
      {error ? (
        <p role="alert" className="rounded-md border border-destructive p-3">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="rounded-md border p-3 font-semibold">
          {notice}
        </p>
      ) : null}
      {stale ? (
        <p role="status">Refreshing local server data. Financial actions are paused.</p>
      ) : null}
      {pending ? (
        <div className="space-y-2 rounded-md border border-amber-500 p-4">
          <p>
            A payment or shift response is uncertain. Retry this saved command before starting
            another action. Do not charge the card again.
          </p>
          <Button disabled={busy || !pending.path} onClick={() => void execute(pending)}>
            Retry saved payment command
          </Button>
        </div>
      ) : null}
      <Button variant="outline" disabled={busy} onClick={() => void reload()}>
        Refresh payments
      </Button>
      {read ? (
        <div className="grid min-w-0 gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="space-y-3">
            <h2 className="text-xl font-semibold">Bills</h2>
            <select
              aria-label="Bill status"
              className={selectClass}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="WAITING_PAYMENT">Waiting for payment</option>
              <option value="PAID">Paid / refunds</option>
              <option value="CANCELLED">Cancelled orders</option>
            </select>
            {orders.map((o) => (
              <button
                key={o.id}
                className={`min-h-20 w-full rounded-md border p-3 text-left ${selected === o.id ? 'border-primary bg-muted' : ''}`}
                onClick={() => chooseOrder(o.id)}
              >
                <strong>
                  #{o.orderNumber} · {o.tableName ?? 'Takeaway'}
                </strong>
                <span className="block">
                  {o.total} {o.currency} · {o.status}
                </span>
                <span className="block text-sm">{o.waiterName ?? 'No waiter assigned'}</span>
              </button>
            ))}
            {!orders.length ? <p>No bills in this view.</p> : null}
            <div className="flex gap-2">
              <Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>
                Previous bills
              </Button>
              <Button variant="outline" disabled={!more} onClick={() => setPage(page + 1)}>
                Next bills
              </Button>
            </div>
          </aside>
          <section className="min-w-0 space-y-5">
            {summary ? (
              <>
                <div className="rounded-md border bg-card p-5">
                  <h2 className="text-2xl font-bold">
                    Bill #{summary.order.orderNumber} · {summary.order.tableName ?? 'Takeaway'}
                  </h2>
                  <p>
                    {summary.order.waiterName ?? 'No waiter assigned'} · {summary.order.status}
                  </p>
                  <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <div>
                      Total
                      <strong className="block text-2xl">
                        {summary.order.total} {summary.order.currency}
                      </strong>
                    </div>
                    <div>
                      Due
                      <strong data-testid="payment-due" className="block text-2xl text-primary">
                        {summary.due}
                      </strong>
                    </div>
                    <div>
                      Refunded<strong className="block text-2xl">{summary.refunded}</strong>
                    </div>
                    <div>
                      Net receipts<strong className="block text-2xl">{summary.netReceipts}</strong>
                    </div>
                  </div>
                  <p className="mt-3 text-sm">
                    Discount {summary.order.discount} · Tax included in total {summary.order.tax}
                  </p>
                  <FiscalStatus user={user} orderId={summary.order.id} />
                </div>
                {summary.order.status === 'WAITING_PAYMENT' && can('payment.collect') ? (
                  summary.order.total === '0.00' ? (
                    <Button
                      disabled={disabled}
                      onClick={() =>
                        send(`payments/orders/${summary.order.id}/settle-zero`, {
                          version: summary.order.version,
                        })
                      }
                    >
                      Settle zero-total bill
                    </Button>
                  ) : (
                    <form onSubmit={collect} className="space-y-4 rounded-md border bg-card p-5">
                      <h3 className="text-xl font-semibold">Collect payment</h3>
                      {initialOrderId === summary.order.id ? (
                        <p className="text-sm text-primary">
                          From POS ·{' '}
                          {initialMethod === 'SPLIT'
                            ? 'Split payment'
                            : initialMethod === 'CARD'
                              ? 'Card payment'
                              : 'Cash payment'}
                          . Review the amounts before confirming.
                        </p>
                      ) : null}
                      <fieldset disabled={disabled} className="space-y-4">
                        <label className="block">
                          Split mode
                          <select
                            aria-label="Split mode"
                            className={selectClass}
                            value={billMode}
                            disabled={!!summary.mode}
                            onChange={(e) => setMode(e.target.value as 'AMOUNT' | 'ITEMS')}
                          >
                            <option value="AMOUNT">Amounts / mixed cash and card</option>
                            <option value="ITEMS">By item quantities</option>
                          </select>
                        </label>
                        {billMode === 'AMOUNT' ? (
                          <div className="grid gap-4 sm:grid-cols-2">
                            <label>
                              Cash amount
                              <Input
                                aria-label="Cash amount"
                                inputMode="decimal"
                                pattern="(0|[1-9][0-9]*)\.[0-9]{2}"
                                placeholder="0.00"
                                value={cash}
                                onChange={(e) => setCash(e.target.value)}
                              />
                            </label>
                            <label>
                              Card amount
                              <Input
                                aria-label="Card amount"
                                inputMode="decimal"
                                pattern="(0|[1-9][0-9]*)\.[0-9]{2}"
                                placeholder="0.00"
                                value={card}
                                onChange={(e) => setCard(e.target.value)}
                              />
                            </label>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                setCash(summary.due);
                                setCard('');
                              }}
                            >
                              Remaining balance in cash
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                setCard(summary.due);
                                setCash('');
                              }}
                            >
                              Remaining balance by card
                            </Button>
                          </div>
                        ) : (
                          <>
                            {summary.order.items
                              .filter((i) => !i.voidedAt)
                              .map((i) => {
                                const available = summary.units.find((u) => u.itemId === i.id);
                                return (
                                  <label
                                    key={i.id}
                                    className="grid grid-cols-[1fr_90px] items-center gap-3 rounded border p-3"
                                  >
                                    <span>
                                      {i.productName}
                                      <small className="block">
                                        {i.modifiers.map((m) => m.name).join(', ')} ·{' '}
                                        {available?.remaining} remaining ·{' '}
                                        {available?.remainingAmount} {summary.order.currency}
                                      </small>
                                    </span>
                                    <Input
                                      aria-label={`Pay quantity ${i.productName}`}
                                      type="number"
                                      min={0}
                                      max={available?.remaining ?? 0}
                                      value={units[i.id] ?? 0}
                                      onChange={(e) =>
                                        setUnits({ ...units, [i.id]: Number(e.target.value) })
                                      }
                                    />
                                  </label>
                                );
                              })}
                            <label>
                              Payment method
                              <select
                                aria-label="Item payment method"
                                className={selectClass}
                                value={method}
                                onChange={(e) => setMethod(e.target.value)}
                              >
                                <option>CASH</option>
                                <option>CARD</option>
                              </select>
                            </label>
                            <p className="text-sm">
                              The server calculates the selected units from the saved discounted
                              line totals, including any remainder cents.
                            </p>
                          </>
                        )}
                        {cashUsed ? (
                          <label className="block">
                            Cash tendered
                            <Input
                              name="tendered"
                              aria-label="Cash tendered"
                              inputMode="decimal"
                              pattern="(0|[1-9][0-9]*)\.[0-9]{2}"
                              required
                            />
                            <small>
                              {currentShift
                                ? `Drawer: ${currentShift.terminalName}`
                                : 'Open your cash shift first.'}
                            </small>
                          </label>
                        ) : null}
                        {cardUsed ? (
                          <label className="block">
                            Approved terminal receipt reference
                            <Input
                              name="reference"
                              aria-label="Approved terminal receipt reference"
                              required
                              maxLength={120}
                              autoComplete="off"
                            />
                            <small>
                              Record only after the external terminal confirms approval. Never enter
                              card numbers or security codes.
                            </small>
                          </label>
                        ) : null}
                        <Button
                          type="submit"
                          className="min-h-14 w-full text-lg"
                          disabled={cashUsed && !currentShift}
                        >
                          Record payment
                        </Button>
                      </fieldset>
                    </form>
                  )
                ) : null}
                <h3 className="text-xl font-semibold">Payment history</h3>
                {summary.payments.map((p) => {
                  const remaining = format(
                    cents(p.amount) - p.reversals.reduce((n, r) => n + cents(r.amount), 0n),
                  );
                  const kind = summary.settledAt ? 'REFUND' : 'CANCELLATION';
                  const permitted = summary.settledAt
                    ? can('payment.refund')
                    : can('payment.cancel');
                  return (
                    <article key={p.id} className="space-y-3 rounded-md border bg-card p-4">
                      <p className="font-semibold">
                        {p.method} {p.amount} {summary.order.currency}{' '}
                        {p.change !== null ? `· Change ${p.change}` : ''}
                      </p>
                      <p className="break-all text-sm">
                        {p.id} · {new Date(p.createdAt).toLocaleString()}{' '}
                        {p.transactionReference ? `· ${p.transactionReference}` : ''}
                      </p>
                      {p.allocations.length ? (
                        <p>{p.allocations.length} item units allocated</p>
                      ) : null}
                      {p.reversals.map((r) => (
                        <p key={r.id} className="rounded bg-muted p-2">
                          {r.kind} {r.amount} · {r.reason} ·{' '}
                          {new Date(r.createdAt).toLocaleString()}
                        </p>
                      ))}
                      {permitted &&
                      remaining !== '0.00' &&
                      ['PAID', 'WAITING_PAYMENT'].includes(summary.order.status) ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            const f = new FormData(e.currentTarget);
                            send(`payments/${p.id}/reverse`, {
                              kind,
                              amount: kind === 'CANCELLATION' ? p.amount : f.get('amount'),
                              reason: f.get('reason'),
                              ...(p.method === 'CASH'
                                ? { shiftId: currentShift?.id }
                                : { transactionReference: f.get('reference') }),
                            });
                          }}
                        >
                          <fieldset disabled={disabled} className="grid gap-3 sm:grid-cols-2">
                            {kind === 'REFUND' ? (
                              <label>
                                Refund amount
                                <Input
                                  name="amount"
                                  aria-label="Refund amount"
                                  defaultValue={remaining}
                                  required
                                  inputMode="decimal"
                                />
                              </label>
                            ) : (
                              <p>Cancel the full unsettled payment: {p.amount}</p>
                            )}
                            <label>
                              Reason
                              <Input
                                name="reason"
                                aria-label="Reversal reason"
                                required
                                maxLength={500}
                              />
                            </label>
                            {p.method === 'CARD' ? (
                              <label>
                                Confirmed card reversal reference
                                <Input
                                  name="reference"
                                  aria-label="Confirmed card reversal reference"
                                  required
                                  autoComplete="off"
                                />
                              </label>
                            ) : (
                              <p>
                                Cash returned from{' '}
                                {currentShift?.terminalName ?? 'your open drawer (required)'}
                              </p>
                            )}
                            <Button
                              variant="outline"
                              disabled={p.method === 'CASH' && !currentShift}
                            >
                              {kind === 'REFUND' ? 'Record refund' : 'Cancel payment'}
                            </Button>
                          </fieldset>
                        </form>
                      ) : null}
                    </article>
                  );
                })}
                {!summary.payments.length ? <p>No payments recorded.</p> : null}
                <details>
                  <summary className="min-h-12 cursor-pointer font-semibold">
                    Payment audit events
                  </summary>
                  {history.events.map((e) => (
                    <p key={e.id}>
                      {e.action} · {new Date(e.createdAt).toLocaleString()} · {e.revision}
                    </p>
                  ))}
                  {history.hasMore ? (
                    <Button
                      variant="outline"
                      onClick={() => {
                        const id = selected;
                        void api<History>(
                          `payments/orders/${id}/history?after=${history.cursor}&limit=50`,
                        )
                          .then((r) => {
                            if (id === selected)
                              setHistory((h) => ({ ...r, events: [...h.events, ...r.events] }));
                          })
                          .catch((e: Error) => setError(e.message));
                      }}
                    >
                      More payment events
                    </Button>
                  ) : null}
                </details>
              </>
            ) : (
              <p>Select a bill to collect payment or inspect its history.</p>
            )}
          </section>
        </div>
      ) : null}
      {cashRead ? (
        <section className="space-y-4 border-t pt-6">
          <h2 className="text-2xl font-bold">Cash register shifts</h2>
          <p>
            {currentShift
              ? `Your open drawer: ${currentShift.terminalName} · Expected ${currentShift.expectedAmount} ${currentShift.currency}`
              : 'You have no open cash shift.'}
          </p>
          {!currentShift && can('cash.shift.manage') ? (
            <form
              className="grid gap-3 rounded border p-4 sm:grid-cols-3"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                send('payments/shifts', {
                  terminalId: f.get('terminal'),
                  openingAmount: f.get('opening'),
                });
              }}
            >
              <label>
                POS terminal
                <select
                  aria-label="POS terminal"
                  name="terminal"
                  className={selectClass}
                  required
                  disabled={disabled}
                >
                  <option value="">Choose registered POS</option>
                  {terminals.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Opening cash
                <Input
                  aria-label="Opening cash"
                  name="opening"
                  defaultValue="0.00"
                  inputMode="decimal"
                  required
                  disabled={disabled}
                />
              </label>
              <Button disabled={disabled}>Open cash shift</Button>
            </form>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {shifts.map((s) => (
              <Button
                variant={shiftId === s.id ? 'default' : 'outline'}
                className="h-auto min-h-16 whitespace-normal"
                key={s.id}
                onClick={() => {
                  setShiftId(s.id);
                  setMovementPage(1);
                  setShiftDetail(null);
                }}
              >
                {s.terminalName} · {s.cashierName} · {s.status}
                <br />
                {new Date(s.openedAt).toLocaleString()}
              </Button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={shiftPage === 1}
              onClick={() => setShiftPage(shiftPage - 1)}
            >
              Previous shifts
            </Button>
            <Button
              variant="outline"
              disabled={!shiftMore}
              onClick={() => setShiftPage(shiftPage + 1)}
            >
              Next shifts
            </Button>
          </div>
          {shiftDetail ? (
            <div className="space-y-4 rounded-md border p-4">
              <h3 className="text-xl font-semibold">
                {shiftDetail.shift.terminalName} · {shiftDetail.shift.status}
              </h3>
              <p>
                Opening {shiftDetail.shift.openingAmount} · Expected{' '}
                {shiftDetail.shift.expectedAmount} · Counted{' '}
                {shiftDetail.shift.closingAmount ?? '—'} · Difference{' '}
                {shiftDetail.shift.difference ?? '—'}
              </p>
              {shiftDetail.shift.closingReason ? <p>{shiftDetail.shift.closingReason}</p> : null}
              {shiftDetail.shift.id === currentShift?.id && can('cash.shift.manage') ? (
                <div className="grid gap-5 lg:grid-cols-2">
                  {can('cash.movement.manage') ? (
                    <form
                      className="space-y-3"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        send(`payments/shifts/${currentShift.id}/commands`, {
                          version: shiftDetail.shift.version,
                          action: f.get('action'),
                          amount: f.get('amount'),
                          reason: f.get('reason'),
                        });
                      }}
                    >
                      <fieldset disabled={disabled} className="space-y-3">
                        <legend className="font-semibold">Cash movement</legend>
                        <select
                          name="action"
                          aria-label="Cash movement type"
                          className={selectClass}
                        >
                          <option value="cash_in">Cash in</option>
                          <option value="cash_out">Cash out</option>
                        </select>
                        <label className="block">
                          Movement amount
                          <Input
                            name="amount"
                            aria-label="Movement amount"
                            required
                            inputMode="decimal"
                          />
                        </label>
                        <label className="block">
                          Movement reason
                          <Input
                            name="reason"
                            aria-label="Movement reason"
                            required
                            maxLength={500}
                          />
                        </label>
                        <Button>Record cash movement</Button>
                      </fieldset>
                    </form>
                  ) : null}
                  <form
                    className="space-y-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      send(`payments/shifts/${currentShift.id}/commands`, {
                        version: shiftDetail.shift.version,
                        action: 'close',
                        closingAmount: f.get('closing'),
                        reason: f.get('reason'),
                      });
                    }}
                  >
                    <fieldset disabled={disabled} className="space-y-3">
                      <legend className="font-semibold">Close cash shift</legend>
                      <label className="block">
                        Counted cash
                        <Input
                          name="closing"
                          aria-label="Counted cash"
                          required
                          inputMode="decimal"
                        />
                      </label>
                      <label className="block">
                        Difference explanation
                        <Input name="reason" aria-label="Difference explanation" maxLength={500} />
                      </label>
                      <Button>Close cash shift</Button>
                    </fieldset>
                  </form>
                </div>
              ) : null}
              <h4 className="font-semibold">Cash movement history</h4>
              {shiftDetail.movements.map((m) => (
                <p key={m.id} className="border-t py-2">
                  {m.kind} · {m.amount} · {m.reason} · {new Date(m.createdAt).toLocaleString()}
                </p>
              ))}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  disabled={movementPage === 1}
                  onClick={() => setMovementPage(movementPage - 1)}
                >
                  Previous movements
                </Button>
                <Button
                  variant="outline"
                  disabled={!shiftDetail.hasMore}
                  onClick={() => setMovementPage(movementPage + 1)}
                >
                  Next movements
                </Button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
