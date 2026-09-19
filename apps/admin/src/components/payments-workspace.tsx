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
import { useI18n, formatDateTime, serverMessage } from '../lib/i18n';
import { SALES_VALUE_KEYS } from '../lib/i18n/sales-messages';
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
  const { t, locale } = useI18n();
  const valueLabel = (value: string) => SALES_VALUE_KEYS[value] ? t(SALES_VALUE_KEYS[value]) : value;
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
    [notice, setNotice] = useState<string | { amount: string; method: string; change: string | null }[]>('');
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
      setNotice(result.payments ?? 'Recorded successfully.');
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
          {serverMessage(error, locale)}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="rounded-md border p-3 font-semibold">
          {typeof notice === 'string' ? serverMessage(notice, locale) : notice.map((payment) => `${valueLabel(payment.method)} ${payment.amount}${payment.change !== null ? ` · ${t('sales.change', { amount: payment.change })}` : ''}`).join(' / ')}
        </p>
      ) : null}
      {stale ? (
        <p role="status">{t('sales.refreshingLocalServerDataFinancialActionsArePaused')}</p>
      ) : null}
      {pending ? (
        <div className="space-y-2 rounded-md border border-amber-500 p-4">
          <p>
            {t('sales.aPaymentOrShiftResponseIsUncertainRetryThisSavedCommandBeforeStartingAnotherActionDoNotCha')}
          </p>
          <Button disabled={busy || !pending.path} onClick={() => void execute(pending)}>
            {t('sales.retrySavedPaymentCommand')}
          </Button>
        </div>
      ) : null}
      <Button variant="outline" disabled={busy} onClick={() => void reload()}>
        {t('sales.refreshPayments')}
      </Button>
      {read ? (
        <div className="grid min-w-0 gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="space-y-3">
            <h2 className="text-xl font-semibold">{t('sales.bills')}</h2>
            <select
              aria-label={t('sales.billStatus')}
              className={selectClass}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="WAITING_PAYMENT">{t('sales.waitingForPayment')}</option>
              <option value="PAID">{t('sales.paidRefunds')}</option>
              <option value="CANCELLED">{t('sales.cancelledOrders')}</option>
            </select>
            {orders.map((o) => (
              <button
                key={o.id}
                className={`min-h-20 w-full rounded-md border p-3 text-left ${selected === o.id ? 'border-primary bg-muted' : ''}`}
                onClick={() => chooseOrder(o.id)}
              >
                <strong>
                  #{o.orderNumber} · {o.tableName ?? t('sales.takeaway')}
                </strong>
                <span className="block">
                  {o.total} {o.currency} · {valueLabel(o.status)}
                </span>
                <span className="block text-sm">{o.waiterName ?? t('sales.noWaiter')}</span>
              </button>
            ))}
            {!orders.length ? <p>{t('sales.noBillsInThisView')}</p> : null}
            <div className="flex gap-2">
              <Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>
                {t('sales.previousBills')}
              </Button>
              <Button variant="outline" disabled={!more} onClick={() => setPage(page + 1)}>
                {t('sales.nextBills')}
              </Button>
            </div>
          </aside>
          <section className="min-w-0 space-y-5">
            {summary ? (
              <>
                <div className="rounded-md border bg-card p-5">
                  <h2 className="text-2xl font-bold">
                    {t('sales.bill')}{summary.order.orderNumber} · {summary.order.tableName ?? t('sales.takeaway')}
                  </h2>
                  <p>
                    {summary.order.waiterName ?? t('sales.noWaiter')} · {valueLabel(summary.order.status)}
                  </p>
                  <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <div>
                      {t('sales.total')}
                      <strong className="block text-2xl">
                        {summary.order.total} {summary.order.currency}
                      </strong>
                    </div>
                    <div>
                      {t('sales.due')}
                      <strong data-testid="payment-due" className="block text-2xl text-primary">
                        {summary.due}
                      </strong>
                    </div>
                    <div>
                      {t('sales.refunded')}<strong className="block text-2xl">{summary.refunded}</strong>
                    </div>
                    <div>
                      {t('sales.netReceipts')}<strong className="block text-2xl">{summary.netReceipts}</strong>
                    </div>
                  </div>
                  <p className="mt-3 text-sm">
                    {t('sales.discount')} {summary.order.discount} {t('sales.taxIncludedInTotal')} {summary.order.tax}
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
                      {t('sales.settleZeroTotalBill')}
                    </Button>
                  ) : (
                    <form onSubmit={collect} className="space-y-4 rounded-md border bg-card p-5">
                      <h3 className="text-xl font-semibold">{t('sales.collectPayment')}</h3>
                      {initialOrderId === summary.order.id ? (
                        <p className="text-sm text-primary">
                          {t('sales.fromPos')}{' '}
                          {initialMethod === 'SPLIT'
                            ? t('sales.splitPayment')
                            : initialMethod === 'CARD'
                              ? t('sales.cardPayment')
                              : t('sales.cashPayment')}
                          {t('sales.reviewTheAmountsBeforeConfirming')}
                        </p>
                      ) : null}
                      <fieldset disabled={disabled} className="space-y-4">
                        <label className="block">
                          {t('sales.splitMode')}
                          <select
                            aria-label={t('sales.splitMode')}
                            className={selectClass}
                            value={billMode}
                            disabled={!!summary.mode}
                            onChange={(e) => setMode(e.target.value as 'AMOUNT' | 'ITEMS')}
                          >
                            <option value="AMOUNT">{t('sales.amountsMixedCashAndCard')}</option>
                            <option value="ITEMS">{t('sales.byItemQuantities')}</option>
                          </select>
                        </label>
                        {billMode === 'AMOUNT' ? (
                          <div className="grid gap-4 sm:grid-cols-2">
                            <label>
                              {t('sales.cashAmount')}
                              <Input
                                aria-label={t('sales.cashAmount')}
                                inputMode="decimal"
                                pattern="(0|[1-9][0-9]*)\.[0-9]{2}"
                                placeholder="0.00"
                                value={cash}
                                onChange={(e) => setCash(e.target.value)}
                              />
                            </label>
                            <label>
                              {t('sales.cardAmount')}
                              <Input
                                aria-label={t('sales.cardAmount')}
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
                              {t('sales.remainingBalanceInCash')}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                setCard(summary.due);
                                setCash('');
                              }}
                            >
                              {t('sales.remainingBalanceByCard')}
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
                                        {available?.remaining} {t('sales.remaining')}{' '}
                                        {available?.remainingAmount} {summary.order.currency}
                                      </small>
                                    </span>
                                    <Input
                                      aria-label={t('sales.payQuantity', { name: i.productName })}
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
                              {t('sales.paymentMethod')}
                              <select
                                aria-label={t('sales.itemPaymentMethod')}
                                className={selectClass}
                                value={method}
                                onChange={(e) => setMethod(e.target.value === 'CARD' ? 'CARD' : 'CASH')}
                              >
                                <option value="CASH">{t('sales.cash')}</option>
                                <option value="CARD">{t('sales.card')}</option>
                              </select>
                            </label>
                            <p className="text-sm">
                              {t('sales.theServerCalculatesTheSelectedUnitsFromTheSavedDiscountedLineTotalsIncludingAnyRemainderCe')}
                            </p>
                          </>
                        )}
                        {cashUsed ? (
                          <label className="block">
                            {t('sales.cashTendered')}
                            <Input
                              name="tendered"
                              aria-label={t('sales.cashTendered')}
                              inputMode="decimal"
                              pattern="(0|[1-9][0-9]*)\.[0-9]{2}"
                              required
                            />
                            <small>
                              {currentShift
                                ? t('sales.drawer', { name: currentShift.terminalName })
                                : t('sales.openShiftFirst')}
                            </small>
                          </label>
                        ) : null}
                        {cardUsed ? (
                          <label className="block">
                            {t('sales.approvedTerminalReceiptReference')}
                            <Input
                              name="reference"
                              aria-label={t('sales.approvedTerminalReceiptReference')}
                              required
                              maxLength={120}
                              autoComplete="off"
                            />
                            <small>
                              {t('sales.recordOnlyAfterTheExternalTerminalConfirmsApprovalNeverEnterCardNumbersOrSecurityCodes')}
                            </small>
                          </label>
                        ) : null}
                        <Button
                          type="submit"
                          className="min-h-14 w-full text-lg"
                          disabled={cashUsed && !currentShift}
                        >
                          {t('sales.recordPayment')}
                        </Button>
                      </fieldset>
                    </form>
                  )
                ) : null}
                <h3 className="text-xl font-semibold">{t('sales.paymentHistory')}</h3>
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
                        {valueLabel(p.method)} {p.amount} {summary.order.currency}{' '}
                        {p.change !== null ? `· ${t('sales.change', { amount: p.change })}` : ''}
                      </p>
                      <p className="break-all text-sm">
                        {p.id} · {formatDateTime(p.createdAt, locale)}{' '}
                        {p.transactionReference ? `· ${p.transactionReference}` : ''}
                      </p>
                      {p.allocations.length ? (
                        <p>{p.allocations.length} {t('sales.itemUnitsAllocated')}</p>
                      ) : null}
                      {p.reversals.map((r) => (
                        <p key={r.id} className="rounded bg-muted p-2">
                          {valueLabel(r.kind)} {r.amount} · {r.reason} ·{' '}
                          {formatDateTime(r.createdAt, locale)}
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
                                {t('sales.refundAmount')}
                                <Input
                                  name="amount"
                                  aria-label={t('sales.refundAmount')}
                                  defaultValue={remaining}
                                  required
                                  inputMode="decimal"
                                />
                              </label>
                            ) : (
                              <p>{t('sales.cancelTheFullUnsettledPayment')} {p.amount}</p>
                            )}
                            <label>
                              {t('sales.reason')}
                              <Input
                                name="reason"
                                aria-label={t('sales.reversalReason')}
                                required
                                maxLength={500}
                              />
                            </label>
                            {p.method === 'CARD' ? (
                              <label>
                                {t('sales.confirmedCardReversalReference')}
                                <Input
                                  name="reference"
                                  aria-label={t('sales.confirmedCardReversalReference')}
                                  required
                                  autoComplete="off"
                                />
                              </label>
                            ) : (
                              <p>
                                {t('sales.cashReturnedFrom')}{' '}
                                {currentShift?.terminalName ?? t('sales.requiredDrawer')}
                              </p>
                            )}
                            <Button
                              variant="outline"
                              disabled={p.method === 'CASH' && !currentShift}
                            >
                              {kind === 'REFUND' ? t('sales.recordRefund') : t('sales.cancelPayment')}
                            </Button>
                          </fieldset>
                        </form>
                      ) : null}
                    </article>
                  );
                })}
                {!summary.payments.length ? <p>{t('sales.noPaymentsRecorded')}</p> : null}
                <details>
                  <summary className="min-h-12 cursor-pointer font-semibold">
                    {t('sales.paymentAuditEvents')}
                  </summary>
                  {history.events.map((e) => (
                    <p key={e.id}>
                      {valueLabel(e.action)} · {formatDateTime(e.createdAt, locale)} · {e.revision}
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
                      {t('sales.morePaymentEvents')}
                    </Button>
                  ) : null}
                </details>
              </>
            ) : (
              <p>{t('sales.selectABillToCollectPaymentOrInspectItsHistory')}</p>
            )}
          </section>
        </div>
      ) : null}
      {cashRead ? (
        <section className="space-y-4 border-t pt-6">
          <h2 className="text-2xl font-bold">{t('sales.cashRegisterShifts')}</h2>
          <p>
            {currentShift
              ? t('sales.yourOpenDrawer', { name: currentShift.terminalName, amount: currentShift.expectedAmount, currency: currentShift.currency })
              : t('sales.noOpenShift')}
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
                {t('sales.posTerminal')}
                <select
                  aria-label={t('sales.posTerminal')}
                  name="terminal"
                  className={selectClass}
                  required
                  disabled={disabled}
                >
                  <option value="">{t('sales.chooseRegisteredPos')}</option>
                  {terminals.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('sales.openingCash')}
                <Input
                  aria-label={t('sales.openingCash')}
                  name="opening"
                  defaultValue="0.00"
                  inputMode="decimal"
                  required
                  disabled={disabled}
                />
              </label>
              <Button disabled={disabled}>{t('sales.openCashShift')}</Button>
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
                {s.terminalName} · {s.cashierName} · {valueLabel(s.status)}
                <br />
                {formatDateTime(s.openedAt, locale)}
              </Button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={shiftPage === 1}
              onClick={() => setShiftPage(shiftPage - 1)}
            >
              {t('sales.previousShifts')}
            </Button>
            <Button
              variant="outline"
              disabled={!shiftMore}
              onClick={() => setShiftPage(shiftPage + 1)}
            >
              {t('sales.nextShifts')}
            </Button>
          </div>
          {shiftDetail ? (
            <div className="space-y-4 rounded-md border p-4">
              <h3 className="text-xl font-semibold">
                {shiftDetail.shift.terminalName} · {valueLabel(shiftDetail.shift.status)}
              </h3>
              <p>
                {t('sales.opening')} {shiftDetail.shift.openingAmount} {t('sales.expected')}{' '}
                {shiftDetail.shift.expectedAmount} {t('sales.counted')}{' '}
                {shiftDetail.shift.closingAmount ?? '—'} {t('sales.difference')}{' '}
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
                        <legend className="font-semibold">{t('sales.cashMovement')}</legend>
                        <select
                          name="action"
                          aria-label={t('sales.cashMovementType')}
                          className={selectClass}
                        >
                          <option value="cash_in">{t('sales.cashIn')}</option>
                          <option value="cash_out">{t('sales.cashOut')}</option>
                        </select>
                        <label className="block">
                          {t('sales.movementAmount')}
                          <Input
                            name="amount"
                            aria-label={t('sales.movementAmount')}
                            required
                            inputMode="decimal"
                          />
                        </label>
                        <label className="block">
                          {t('sales.movementReason')}
                          <Input
                            name="reason"
                            aria-label={t('sales.movementReason')}
                            required
                            maxLength={500}
                          />
                        </label>
                        <Button>{t('sales.recordCashMovement')}</Button>
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
                      <legend className="font-semibold">{t('sales.closeCashShift')}</legend>
                      <label className="block">
                        {t('sales.countedCash')}
                        <Input
                          name="closing"
                          aria-label={t('sales.countedCash')}
                          required
                          inputMode="decimal"
                        />
                      </label>
                      <label className="block">
                        {t('sales.differenceExplanation')}
                        <Input name="reason" aria-label={t('sales.differenceExplanation')} maxLength={500} />
                      </label>
                      <Button>{t('sales.closeCashShift')}</Button>
                    </fieldset>
                  </form>
                </div>
              ) : null}
              <h4 className="font-semibold">{t('sales.cashMovementHistory')}</h4>
              {shiftDetail.movements.map((m) => (
                <p key={m.id} className="border-t py-2">
                  {valueLabel(m.kind)} · {m.amount} · {serverMessage(m.reason, locale)} · {formatDateTime(m.createdAt, locale)}
                </p>
              ))}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  disabled={movementPage === 1}
                  onClick={() => setMovementPage(movementPage - 1)}
                >
                  {t('sales.previousMovements')}
                </Button>
                <Button
                  variant="outline"
                  disabled={!shiftDetail.hasMore}
                  onClick={() => setMovementPage(movementPage + 1)}
                >
                  {t('sales.nextMovements')}
                </Button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
