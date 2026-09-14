'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  SessionUser,
  SupplierRecord,
  PurchaseRecord,
  ReceiptRecord,
  SupplierAccount,
  PurchaseStatus,
} from '@restaurant/shared-types';
import { Button } from '@restaurant/ui/button';
import { Input } from '@restaurant/ui/input';
import { api, ApiFailure } from '../lib/api';
import {
  PurchasingEditorDialog,
  PurchaseField as Field,
  quantityLabel as qty,
  type Choice,
  type PurchaseChoice,
  type PurchasingEditor,
} from './purchasing-editors';
type Page<T> = { items: T[]; hasMore: boolean };
type Pending = { path: string; method: string; body: Record<string, unknown> };
type View = 'Orders' | 'Suppliers' | 'Receipts' | 'Account';
const label = (v: string) => v.toLowerCase().replaceAll('_', ' ');
async function all<T>(path: string) {
  const rows: T[] = [];
  for (let page = 1; ; page++) {
    const result = await api<Page<T>>(
      `${path}${path.includes('?') ? '&' : '?'}page=${page}&limit=100`,
    );
    rows.push(...result.items);
    if (!result.hasMore) return rows;
  }
}
function Totals({
  record,
}: {
  record: { subtotal: string; tax: string; total: string; currency: string };
}) {
  return (
    <dl className="purchase-totals">
      <div>
        <dt>Subtotal</dt>
        <dd>{record.subtotal}</dd>
      </div>
      <div>
        <dt>Tax</dt>
        <dd>{record.tax}</dd>
      </div>
      <div>
        <dt>Total</dt>
        <dd>
          {record.total} {record.currency}
        </dd>
      </div>
    </dl>
  );
}
export function PurchasingWorkspace({ user }: { user: SessionUser }) {
  const can = (p: SessionUser['permissions'][number]) => user.permissions.includes(p),
    purchaseRead = can('purchase.read'),
    supplierRead = can('supplier.read');
  const [view, setView] = useState<View>(purchaseRead ? 'Orders' : 'Suppliers'),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [more, setMore] = useState(false),
    [status, setStatus] = useState(''),
    [supplierFilter, setSupplierFilter] = useState(''),
    [archived, setArchived] = useState(false);
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]),
    [choices, setChoices] = useState<Choice[]>([]),
    [items, setItems] = useState<PurchaseChoice[]>([]),
    [warehouses, setWarehouses] = useState<Choice[]>([]),
    [orders, setOrders] = useState<PurchaseRecord[]>([]),
    [receipts, setReceipts] = useState<ReceiptRecord[]>([]),
    [account, setAccount] = useState<SupplierAccount | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<PurchaseRecord | null>(null),
    [selectedReceipt, setSelectedReceipt] = useState<ReceiptRecord | null>(null),
    [editor, setEditor] = useState<PurchasingEditor | null>(null);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [stale, setStale] = useState(true),
    [pending, setPending] = useState<Pending | null>(null);
  const [history, setHistory] = useState<{
    events: { id: string; action: string; createdAt: string; response: unknown }[];
    cursor: string;
    hasMore: boolean;
  } | null>(null);
  const generation = useRef(0),
    saving = useRef(false),
    key = `restaurant-purchasing-command:v1:${user.organizationId}:${user.branchId}:${user.id}`;
  useEffect(() => {
    const saved = sessionStorage.getItem(key);
    if (saved)
      try {
        const p = JSON.parse(saved);
        if (
          !p.path?.startsWith('purchasing/') ||
          !['POST', 'PUT'].includes(p.method) ||
          !p.body?.commandId
        )
          throw new Error();
        setPending(p);
      } catch {
        setError('Saved purchasing command is unreadable. Check history before another change.');
        setPending({ path: '', method: '', body: {} });
      }
  }, [key]);
  const orderId = selectedOrder?.id,
    receiptId = selectedReceipt?.id;
  const reload = useCallback(async () => {
    const current = ++generation.current;
    const q = new URLSearchParams({
      page: String(page),
      limit: '25',
      search,
      ...(supplierFilter ? { supplierId: supplierFilter } : {}),
      ...(view === 'Orders' && status ? { status } : {}),
      ...(view === 'Suppliers' ? { includeArchived: String(archived) } : {}),
    });
    try {
      const [catalog, stores, supplierChoices, result, order, receipt] = await Promise.all([
        purchaseRead ? all<PurchaseChoice>('purchasing/catalog/items') : Promise.resolve([]),
        purchaseRead ? all<Choice>('purchasing/catalog/warehouses') : Promise.resolve([]),
        supplierRead
          ? all<SupplierRecord>('purchasing/suppliers?includeArchived=true')
          : all<Choice>('purchasing/catalog/suppliers'),
        view === 'Account'
          ? supplierFilter
            ? api<SupplierAccount>(
                `purchasing/suppliers/${supplierFilter}/account?page=${page}&limit=25`,
              )
            : Promise.resolve(null)
          : api<Page<PurchaseRecord | SupplierRecord | ReceiptRecord>>(
              `purchasing/${view === 'Orders' ? 'orders' : view === 'Suppliers' ? 'suppliers' : 'receipts'}?${q}`,
            ),
        orderId ? api<PurchaseRecord>(`purchasing/orders/${orderId}`) : Promise.resolve(null),
        receiptId ? api<ReceiptRecord>(`purchasing/receipts/${receiptId}`) : Promise.resolve(null),
      ]);
      if (current !== generation.current || saving.current) return;
      setItems(catalog);
      setWarehouses(stores);
      setChoices(supplierChoices);
      setMore(result?.hasMore ?? false);
      if (view === 'Orders') setOrders((result as Page<PurchaseRecord>).items);
      else if (view === 'Suppliers') setSuppliers((result as Page<SupplierRecord>).items);
      else if (view === 'Receipts') setReceipts((result as Page<ReceiptRecord>).items);
      else setAccount(result as SupplierAccount | null);
      if (order) setSelectedOrder(order);
      if (receipt) setSelectedReceipt(receipt);
      setStale(false);
    } catch (e) {
      if (current === generation.current) {
        setStale(true);
        setError(e instanceof Error ? e.message : 'Purchasing could not be loaded');
      }
    }
  }, [
    view,
    page,
    search,
    supplierFilter,
    status,
    archived,
    purchaseRead,
    supplierRead,
    orderId,
    receiptId,
  ]);
  useEffect(() => {
    void reload();
    const timer = setInterval(() => {
      if (!saving.current) void reload();
    }, 10000);
    const ref = generation;
    return () => {
      clearInterval(timer);
      ref.current++;
    };
  }, [reload]);
  async function execute(request: Pending) {
    if (saving.current || !request.path) return;
    saving.current = true;
    generation.current++;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      sessionStorage.setItem(key, JSON.stringify(request));
      setPending(request);
      const result = await api<PurchaseRecord | ReceiptRecord>(
        request.path,
        request.method,
        request.body,
      );
      sessionStorage.removeItem(key);
      setPending(null);
      setEditor(null);
      setHistory(null);
      setNotice('Saved. Purchasing and stock history are up to date.');
      if ('status' in result) {
        setSelectedOrder(result as PurchaseRecord);
        setSelectedReceipt(null);
      } else if ('purchaseNumber' in result) {
        setSelectedReceipt(result as ReceiptRecord);
        setSelectedOrder(null);
      }
      setStale(true);
    } catch (e) {
      if (e instanceof ApiFailure && e.status >= 400 && e.status < 500) {
        sessionStorage.removeItem(key);
        setPending(null);
      }
      setError(
        e instanceof ApiFailure
          ? e.message
          : 'Save outcome unknown. Retry the saved command before another change.',
      );
      setStale(true);
    } finally {
      saving.current = false;
      setBusy(false);
      void reload();
    }
  }
  const locked = busy || stale || !!pending;
  function submit(path: string, body: Record<string, unknown>, method = 'POST') {
    if (!locked)
      void execute({
        path: 'purchasing/' + path,
        method,
        body: { ...body, commandId: crypto.randomUUID() },
      });
  }
  function changeView(next: View) {
    setView(next);
    setPage(1);
    setSearch('');
    setSelectedOrder(null);
    setSelectedReceipt(null);
    setHistory(null);
  }
  async function openOrder(id: string) {
    try {
      setSelectedOrder(await api(`purchasing/orders/${id}`));
      setSelectedReceipt(null);
      setHistory(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Purchase unavailable');
    }
  }
  async function openReceipt(id: string) {
    try {
      setSelectedReceipt(await api(`purchasing/receipts/${id}`));
      setSelectedOrder(null);
      setHistory(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Receipt unavailable');
    }
  }
  async function loadHistory() {
    if (!selectedOrder) return;
    try {
      const r = await api<NonNullable<typeof history>>(
        `purchasing/orders/${selectedOrder.id}/history?after=${history?.cursor ?? '0'}&limit=25`,
      );
      setHistory((h) => ({ ...r, events: [...(h?.events ?? []), ...r.events] }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'History unavailable');
    }
  }
  const views: View[] = [
    ...(purchaseRead ? ['Orders' as const, 'Receipts' as const] : []),
    ...(supplierRead ? ['Suppliers' as const, 'Account' as const] : []),
  ];
  return (
    <section className="space-y-5" aria-label="Purchasing workspace">
      <div className="inventory-banner">
        <div>
          <p className="pos-eyebrow">FROM SUPPLIER TO SHELF</p>
          <h2 className="mt-2 text-xl font-semibold">Keep your kitchen supplied.</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Plan purchases, receive deliveries and track every supplier balance.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can('purchase.manage') ? (
            <Button disabled={locked} onClick={() => setEditor({ kind: 'draft', value: null })}>
              New purchase order
            </Button>
          ) : null}
          {can('supplier.manage') ? (
            <Button
              variant="outline"
              disabled={locked}
              onClick={() => setEditor({ kind: 'supplier', value: null })}
            >
              Add supplier
            </Button>
          ) : null}
        </div>
      </div>
      <div role="group" aria-label="Purchasing views" className="flex gap-2 overflow-x-auto pb-1">
        {views.map((v) => (
          <Button
            key={v}
            variant={view === v ? 'default' : 'outline'}
            onClick={() => changeView(v)}
          >
            {v === 'Orders'
              ? 'Purchase orders'
              : v === 'Receipts'
                ? 'Goods receipts'
                : v === 'Account'
                  ? 'Supplier balances'
                  : v}
          </Button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="rounded-xl border border-destructive p-3 text-sm">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}
      {pending ? (
        <div className="purchase-notice">
          <p>A previous save needs confirmation before another change.</p>
          <Button disabled={busy || !pending.path} onClick={() => void execute(pending)}>
            Retry purchasing command
          </Button>
        </div>
      ) : null}
      <div className="purchase-filters">
        <Field name="Search purchasing">
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            disabled={view === 'Account'}
          />
        </Field>
        {view !== 'Suppliers' ? (
          <Field name="Filter supplier">
            <select
              value={supplierFilter}
              onChange={(e) => {
                setSupplierFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">{view === 'Account' ? 'Choose a supplier' : 'All suppliers'}</option>
              {choices.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
            />
            Include archived suppliers
          </label>
        )}
        {view === 'Orders' ? (
          <Field name="Purchase status">
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              {(
                [
                  'DRAFT',
                  'ORDERED',
                  'PARTIALLY_RECEIVED',
                  'RECEIVED',
                  'CANCELLED',
                ] as PurchaseStatus[]
              ).map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <Button variant="outline" onClick={() => void reload()} disabled={busy}>
          Refresh purchasing
        </Button>
      </div>
      {stale ? (
        <p className="text-sm text-muted-foreground">
          Refreshing from the local server. Changes are locked until current data is available.
        </p>
      ) : null}
      {view === 'Orders' ? (
        <div className="purchase-grid">
          {orders.map((o) => (
            <article
              key={o.id}
              className="inventory-stock-card space-y-4"
              aria-label={`Purchase ${o.number}`}
            >
              <div className="flex justify-between gap-3">
                <span className="text-sm text-muted-foreground">PO #{o.number}</span>
                <span
                  className={`stock-badge ${['DRAFT', 'PARTIALLY_RECEIVED'].includes(o.status) ? 'stock-low' : ''}`}
                >
                  {label(o.status)}
                </span>
              </div>
              <div>
                <h3 className="text-lg font-semibold">{o.supplierName}</h3>
                <p className="text-sm text-muted-foreground">{o.warehouseName}</p>
              </div>
              <p className="text-sm">{o.reference || 'No external reference'}</p>
              <div className="flex flex-wrap justify-between gap-3 items-center">
                <strong className="text-xl">
                  {o.total} {o.currency}
                </strong>
                <Button variant="outline" onClick={() => void openOrder(o.id)}>
                  View purchase #{o.number}
                </Button>
              </div>
            </article>
          ))}
          {!orders.length ? (
            <p className="purchase-empty">
              No purchase orders here. Create a draft to plan your next delivery.
            </p>
          ) : null}
        </div>
      ) : null}
      {view === 'Suppliers' ? (
        <div className="purchase-grid">
          {suppliers.map((s) => (
            <article key={s.id} className="inventory-stock-card space-y-3">
              <div className="flex justify-between gap-2">
                <h3 className="text-lg font-semibold">{s.name}</h3>
                <span className={`stock-badge ${s.active ? '' : 'stock-low'}`}>
                  {s.deletedAt ? 'Archived' : s.active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {s.businessNumber || 'Business number not set'}
              </p>
              <p className="text-sm">
                {s.contactPerson} {s.phone}
              </p>
              <p className="text-sm break-all">{s.email}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    changeView('Account');
                    setSupplierFilter(s.id);
                  }}
                >
                  View balance
                </Button>
                {purchaseRead ? (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      changeView('Orders');
                      setSupplierFilter(s.id);
                    }}
                  >
                    Purchase history
                  </Button>
                ) : null}
                {can('supplier.manage') && !s.deletedAt ? (
                  <>
                    <Button
                      variant="ghost"
                      disabled={locked}
                      onClick={() => setEditor({ kind: 'supplier', value: s })}
                    >
                      Edit supplier
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={locked}
                      onClick={() => setEditor({ kind: 'archive', value: s })}
                    >
                      Archive supplier
                    </Button>
                  </>
                ) : null}
              </div>
            </article>
          ))}
          {!suppliers.length ? (
            <p className="purchase-empty">No suppliers found. Add the businesses you buy from.</p>
          ) : null}
        </div>
      ) : null}
      {view === 'Receipts' ? (
        <div className="purchase-grid">
          {receipts.map((r) => (
            <article key={r.id} className="inventory-stock-card space-y-3">
              <div className="flex justify-between gap-3">
                <span className="text-sm text-muted-foreground">PO #{r.purchaseNumber}</span>
                <span className="stock-badge">Received</span>
              </div>
              <h3 className="text-lg font-semibold">{r.reference}</h3>
              <p>{r.supplierName}</p>
              <p className="text-sm text-muted-foreground">
                Invoice: {r.invoiceNumber ?? 'Not provided'}
              </p>
              <p className="text-sm">
                Outstanding:{' '}
                <strong>
                  {r.outstanding} {r.currency}
                </strong>
              </p>
              <Button variant="outline" onClick={() => void openReceipt(r.id)}>
                View receipt {r.reference}
              </Button>
            </article>
          ))}
          {!receipts.length ? (
            <p className="purchase-empty">Goods receipts appear after a delivery is posted.</p>
          ) : null}
        </div>
      ) : null}
      {view === 'Account' ? (
        account ? (
          <div className="space-y-5">
            <div className="purchase-grid">
              <div className="inventory-stock-card">
                <p className="text-sm text-muted-foreground">Received value</p>
                <strong className="text-2xl">
                  {account.receivedValue} {account.currency}
                </strong>
              </div>
              <div className="inventory-stock-card">
                <p className="text-sm text-muted-foreground">Outstanding balance</p>
                <strong data-testid="supplier-balance" className="text-2xl">
                  {account.outstanding} {account.currency}
                </strong>
              </div>
              <div className="inventory-stock-card">
                <p className="text-sm text-muted-foreground">Deliveries received</p>
                <strong className="text-2xl">{account.receiptCount}</strong>
                <p className="text-sm text-muted-foreground">
                  Last:{' '}
                  {account.lastReceiptAt
                    ? new Date(account.lastReceiptAt).toLocaleDateString()
                    : 'None'}
                </p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Balance covers recorded receipts and external supplier payments. Purchase orders
              awaiting delivery do not add a charge.
            </p>
            <div className="space-y-3">
              {account.items.map((e) => (
                <article key={e.id} className="purchase-entry">
                  <div>
                    <span className="stock-badge">{label(e.kind)}</span>
                    <h3 className="mt-2 font-semibold">{e.receiptReference}</h3>
                    <p className="text-sm text-muted-foreground">
                      {e.reference} {e.method ? label(e.method) : ''}
                    </p>
                    <p className="text-sm">{e.reason}</p>
                    <small className="text-muted-foreground">
                      {e.userName} · {new Date(e.createdAt).toLocaleString()}
                    </small>
                  </div>
                  <div className="space-y-2">
                    <strong>
                      {e.amount} {account.currency}
                    </strong>
                    <div className="flex flex-wrap gap-2">
                      {purchaseRead ? (
                        <Button variant="outline" onClick={() => void openReceipt(e.receiptId)}>
                          Open receipt
                        </Button>
                      ) : null}
                      {e.kind === 'PAYMENT' && !e.reversed && can('supplier.payment.reverse') ? (
                        <Button
                          variant="outline"
                          disabled={locked}
                          onClick={() => setEditor({ kind: 'reverse', id: e.id })}
                        >
                          Reverse payment record
                        </Button>
                      ) : null}
                      {e.reversed ? (
                        <span className="text-sm text-muted-foreground">Reversed</span>
                      ) : null}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : (
          <p className="purchase-empty">
            Choose a supplier to see receipts, payments and the outstanding balance.
          </p>
        )
      ) : null}
      <div className="flex gap-3 items-center">
        <Button variant="outline" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
          Previous purchasing page
        </Button>
        <span>{page}</span>
        <Button variant="outline" disabled={!more} onClick={() => setPage((p) => p + 1)}>
          Next purchasing page
        </Button>
      </div>

      {selectedOrder ? (
        <section className="purchase-detail space-y-5" aria-label="Purchase detail">
          <div className="flex flex-wrap justify-between gap-3">
            <div>
              <p className="pos-eyebrow">PURCHASE ORDER</p>
              <h2 className="mt-2 text-2xl font-semibold">
                PO #{selectedOrder.number} · {selectedOrder.supplierName}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {selectedOrder.warehouseName} ·{' '}
                <span data-testid="purchase-detail-status">{label(selectedOrder.status)}</span>
              </p>
            </div>
            <Button
              variant="ghost"
              onClick={() => {
                setSelectedOrder(null);
                setHistory(null);
              }}
            >
              Close purchase
            </Button>
          </div>
          <p>{selectedOrder.notes}</p>
          <div className="space-y-3">
            {selectedOrder.items.map((i) => (
              <article key={i.id} className="purchase-entry">
                <div>
                  <h3 className="font-semibold">{i.itemName}</h3>
                  <p className="text-sm text-muted-foreground">
                    {i.sku} · {i.unitPrice} / {i.unitCode} · tax {i.taxRate}%
                  </p>
                  <p className="mt-1 text-sm">
                    Ordered {qty(i.quantity)} {i.unitCode} · received {qty(i.receivedQuantity)} ·
                    remaining {qty(i.remainingQuantity)}
                  </p>
                </div>
                <strong>
                  {i.total} {selectedOrder.currency}
                </strong>
              </article>
            ))}
          </div>
          <Totals record={selectedOrder} />
          <div className="flex flex-wrap gap-2">
            {selectedOrder.status === 'DRAFT' && can('purchase.manage') ? (
              <>
                <Button
                  disabled={locked}
                  onClick={() =>
                    submit(`orders/${selectedOrder.id}/order`, { version: selectedOrder.version })
                  }
                >
                  Confirm purchase order
                </Button>
                <Button
                  variant="outline"
                  disabled={locked}
                  onClick={() => setEditor({ kind: 'draft', value: selectedOrder })}
                >
                  Edit draft
                </Button>
              </>
            ) : null}
            {['ORDERED', 'PARTIALLY_RECEIVED'].includes(selectedOrder.status) &&
            can('purchase.receive') ? (
              <Button
                disabled={locked}
                onClick={() => setEditor({ kind: 'receive', value: selectedOrder })}
              >
                Receive goods
              </Button>
            ) : null}
            {['DRAFT', 'ORDERED'].includes(selectedOrder.status) && can('purchase.manage') ? (
              <Button
                variant="outline"
                disabled={locked}
                onClick={() => setEditor({ kind: 'cancel', value: selectedOrder })}
              >
                Cancel purchase
              </Button>
            ) : null}
            <Button
              variant="outline"
              onClick={() => {
                const s = selectedOrder;
                changeView('Receipts');
                setSupplierFilter(s.supplierId);
              }}
            >
              Supplier receipts
            </Button>
            <Button
              variant="ghost"
              onClick={() => void loadHistory()}
              disabled={!!history && !history.hasMore}
            >
              {history ? 'More purchase history' : 'Show purchase history'}
            </Button>
          </div>
          {history ? (
            <div className="space-y-2">
              {history.events.map((e) => (
                <details key={e.id} className="rounded-lg border p-3 text-sm">
                  <summary>
                    {label(e.action.replace('purchase.', ''))} ·{' '}
                    {new Date(e.createdAt).toLocaleString()}
                  </summary>
                  <PurchaseHistorySummary value={e.response} />
                </details>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
      {selectedReceipt ? (
        <section className="purchase-detail space-y-5" aria-label="Receipt detail">
          <div className="flex flex-wrap justify-between gap-3">
            <div>
              <p className="pos-eyebrow">GOODS RECEIVED</p>
              <h2 className="mt-2 text-2xl font-semibold">{selectedReceipt.reference}</h2>
              <p className="mt-2 text-muted-foreground">
                {selectedReceipt.supplierName} · {selectedReceipt.warehouseName}
              </p>
            </div>
            <Button variant="ghost" onClick={() => setSelectedReceipt(null)}>
              Close receipt
            </Button>
          </div>
          <div className="purchase-grid">
            <p>
              Invoice: <strong>{selectedReceipt.invoiceNumber ?? 'Not provided'}</strong>
              <br />
              <small>{selectedReceipt.invoiceDate ?? ''}</small>
            </p>
            <p>
              Received by {selectedReceipt.receivedBy}
              <br />
              <small>{new Date(selectedReceipt.createdAt).toLocaleString()}</small>
            </p>
            <p>Due date: {selectedReceipt.dueDate ?? 'Not set'}</p>
          </div>
          {selectedReceipt.documentReference ? (
            <a
              className="text-primary underline"
              href={selectedReceipt.documentReference}
              target="_blank"
              rel="noreferrer"
            >
              View supplier document
            </a>
          ) : null}
          <p>{selectedReceipt.notes}</p>
          {selectedReceipt.items.map((i) => (
            <article key={i.id} className="purchase-entry">
              <div>
                <h3 className="font-semibold">{i.itemName}</h3>
                <p className="text-sm text-muted-foreground">
                  Received {qty(i.quantity)} {i.unitCode} · added {qty(i.stockQuantity)}{' '}
                  {i.stockUnit} to stock
                </p>
              </div>
              <strong>
                {i.total} {selectedReceipt.currency}
              </strong>
            </article>
          ))}
          <Totals record={selectedReceipt} />
          <div className="flex flex-wrap justify-between items-center gap-3">
            <p className="text-lg">
              Outstanding:{' '}
              <strong data-testid="receipt-balance">
                {selectedReceipt.outstanding} {selectedReceipt.currency}
              </strong>
            </p>
            {can('supplier.payment.record') && selectedReceipt.outstanding !== '0.00' ? (
              <Button
                disabled={locked}
                onClick={() => setEditor({ kind: 'payment', value: selectedReceipt })}
              >
                Record supplier payment
              </Button>
            ) : null}
            <Button
              variant="outline"
              onClick={() => void openOrder(selectedReceipt.purchaseOrderId)}
            >
              Open source purchase
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Posted receipts are immutable. Supplier payments record an external transaction and do
            not operate your POS cash drawer.
          </p>
        </section>
      ) : null}
      {editor ? (
        <PurchasingEditorDialog
          editor={editor}
          items={items}
          warehouses={warehouses}
          suppliers={choices}
          locked={locked}
          busy={busy}
          error={error}
          onClose={() => setEditor(null)}
          submit={submit}
        />
      ) : null}
    </section>
  );
}

function PurchaseHistorySummary({ value }: { value: unknown }) {
  const r = value as {
    reference?: string;
    notes?: string;
    cancellationReason?: string;
    total?: string;
    currency?: string;
    amount?: string;
    method?: string;
    reason?: string;
    items?: { itemName: string; quantity: string; unitCode: string }[];
  };
  return (
    <div className="mt-3 space-y-2">
      {r.reference ? <p>Reference: {r.reference}</p> : null}
      {r.total ? (
        <p>
          Total: {r.total} {r.currency}
        </p>
      ) : null}
      {r.amount ? (
        <p>
          Amount: {r.amount} {r.method ? label(r.method) : ''}
        </p>
      ) : null}
      {r.notes ? <p>{r.notes}</p> : null}
      {r.cancellationReason || r.reason ? <p>Reason: {r.cancellationReason ?? r.reason}</p> : null}
      {r.items ? (
        <ul className="space-y-1">
          {r.items.map((i, index) => (
            <li key={index}>
              {i.itemName}: {qty(i.quantity)} {i.unitCode}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
