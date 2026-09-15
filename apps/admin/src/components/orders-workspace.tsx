'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  MenuRecord,
  OrderRecord,
  SessionUser,
  TableRecord,
  OrderChange,
} from '@restaurant/shared-types';
import { Button } from '@restaurant/ui/button';
import { Input } from '@restaurant/ui/input';
import { OptionalDetails, ProductImage } from './riza-ui';
import { api, ApiFailure } from '../lib/api';

const selectClass = 'min-h-12 w-full rounded-md border bg-background px-3';
type Pending = { path: string; body: Record<string, unknown> };
async function all<T>(path: string): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; ; page++) {
    const result = await api<{ items: T[]; hasMore: boolean }>(
      `${path}${path.includes('?') ? '&' : '?'}limit=100&page=${page}`,
    );
    rows.push(...result.items);
    if (!result.hasMore) return rows;
  }
}
export function OrdersWorkspace({
  user,
  view = 'orders',
  initialOrderId = '',
  onPayment,
}: {
  user: SessionUser;
  view?: 'orders' | 'pos';
  /** Preselects an existing order, so the waiter shell can open a table's live bill. */
  initialOrderId?: string;
  onPayment?: (id: string, method: string) => void;
}) {
  const pos = view === 'pos';
  const [categories, setCategories] = useState<MenuRecord[]>([]);
  const [category, setCategory] = useState('');
  const [customizing, setCustomizing] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const can = (key: SessionUser['permissions'][number]) => user.permissions.includes(key);
  const manage = can('order.manage'),
    catalogAccess = can('menu.read'),
    layoutAccess = can('layout.read'),
    assign = can('order.assign');
  const storageKey = `restaurant-pending-order:${user.organizationId}:${user.branchId}:${user.id}`;
  const [orders, setOrders] = useState<OrderRecord[]>([]),
    [order, setOrder] = useState<OrderRecord | null>(null);
  const [selected, setSelected] = useState(initialOrderId),
    [page, setPage] = useState(1),
    [hasMore, setHasMore] = useState(false);
  const [products, setProducts] = useState<MenuRecord[]>([]),
    [groups, setGroups] = useState<MenuRecord[]>([]),
    [modifiers, setModifiers] = useState<MenuRecord[]>([]);
  const [tables, setTables] = useState<TableRecord[]>([]),
    [waiters, setWaiters] = useState<{ id: string; name: string }[]>([]);
  const [type, setType] = useState('TAKEAWAY'),
    [productId, setProductId] = useState(''),
    [search, setSearch] = useState('');
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [stale, setStale] = useState(true),
    [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null),
    [history, setHistory] = useState<OrderChange[]>([]);
  const busyRef = useRef(false),
    generation = useRef(0);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  useEffect(() => {
    const stored = sessionStorage.getItem(storageKey);
    if (stored) {
      try {
        setPending(JSON.parse(stored));
      } catch {
        sessionStorage.removeItem(storageKey);
      }
    }
  }, [storageKey]);
  const reload = useCallback(async () => {
    const current = ++generation.current;
    try {
      const [
        list,
        detail,
        menuProducts,
        menuGroups,
        menuModifiers,
        layoutTables,
        eligible,
        menuCategories,
      ] = await Promise.all([
        api<{ items: OrderRecord[]; hasMore: boolean }>(`orders?page=${page}&limit=25`),
        selected ? api<OrderRecord>('orders/' + selected) : Promise.resolve(null),
        catalogAccess ? all<MenuRecord>('menu/products') : Promise.resolve([]),
        catalogAccess ? all<MenuRecord>('menu/modifier-groups') : Promise.resolve([]),
        catalogAccess ? all<MenuRecord>('menu/modifiers') : Promise.resolve([]),
        layoutAccess ? all<TableRecord>('layout/tables') : Promise.resolve([]),
        assign ? all<{ id: string; name: string }>('orders/waiters') : Promise.resolve([]),
        catalogAccess ? all<MenuRecord>('menu/categories') : Promise.resolve([]),
      ]);
      if (current !== generation.current || busyRef.current) return;
      setOrders(list.items);
      setHasMore(list.hasMore);
      setOrder(detail);
      setProducts(menuProducts.filter((p) => p.active));
      setGroups(menuGroups.filter((g) => g.active));
      setModifiers(menuModifiers.filter((m) => m.active));
      setTables(layoutTables.filter((t) => t.active && t.status === 'FREE'));
      setWaiters(eligible);
      setCategories(menuCategories.filter((c) => c.active));
      setStale(false);
    } catch (e) {
      if (current !== generation.current) return;
      setStale(true);
      setError(
        e instanceof ApiFailure ? e.message : 'Local server unavailable. Editing is paused.',
      );
    }
  }, [selected, page, catalogAccess, layoutAccess, assign]);
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
  const execute = async (request: Pending) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    generation.current++;
    setError('');
    setNotice('');
    try {
      // Persist the exact command before sending. This is a retry receipt, never an offline queue.
      sessionStorage.setItem(storageKey, JSON.stringify(request));
      setPending(request);
      const result = await api<OrderRecord>(request.path, 'POST', request.body);
      sessionStorage.removeItem(storageKey);
      setPending(null);
      setSelected(result.id);
      setOrder(result);
      setHistory([]);
      setNotice('Order saved.');
      // Replays may return an earlier version; refresh the authoritative current snapshot.
      setStale(true);
    } catch (e) {
      if (e instanceof ApiFailure && e.status >= 400 && e.status < 500) {
        sessionStorage.removeItem(storageKey);
        setPending(null);
      }
      setError(
        e instanceof ApiFailure
          ? e.message
          : 'Save outcome unknown. Retry the pending command to recover safely.',
      );
      setStale(true);
    } finally {
      busyRef.current = false;
      setBusy(false);
      void reload();
    }
  };
  const command = (body: Record<string, unknown>) => {
    if (order && !stale && !pending)
      void execute({
        path: `orders/${order.id}/commands`,
        body: { ...body, version: order.version, commandId: crypto.randomUUID() },
      });
  };
  const submitCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (stale || pending) return;
    const data = new FormData(event.currentTarget);
    void execute({
      path: 'orders',
      body: {
        commandId: crypto.randomUUID(),
        type,
        tableId: type === 'DINE_IN' ? data.get('tableId') : null,
        waiterId: data.get('waiterId') || user.id,
        notes: data.get('notes'),
      },
    });
  };
  const product = products.find((p) => p.id === productId);
  const locked = !manage || stale || busy || !!pending;
  const editable = order && !order.paymentStarted && ['DRAFT', 'OPEN'].includes(order.status);
  const addItemForm =
    editable && manage && catalogAccess ? (
      <form
        aria-label="Add order item"
        className="space-y-3 rounded-md border p-4"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          command({
            action: 'add_item',
            productId,
            quantity: Number(f.get('quantity')),
            modifierIds: f.getAll('modifierIds'),
            notes: f.get('notes'),
          });
          if (pos) setCustomizing(false);
        }}
      >
        <h3 className="font-semibold">Add product</h3>
        <fieldset disabled={locked} className="space-y-3">
          <label className="block">
            Search products
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="min-h-12"
              placeholder="Name or SKU"
            />
          </label>
          <label className="block">
            Product
            <select
              className={selectClass}
              value={productId}
              aria-label="Product"
              required
              onChange={(e) => setProductId(e.target.value)}
            >
              <option value="">Choose a product</option>
              {products
                .filter(
                  (p) =>
                    p.name.toLowerCase().includes(search.toLowerCase()) ||
                    p.sku?.toLowerCase().includes(search.toLowerCase()) ||
                    p.id === productId,
                )
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.sellingPrice}
                  </option>
                ))}
            </select>
          </label>
          <div key={productId} className="space-y-3">
            {groups
              .filter((g) => product?.modifierGroupIds?.includes(g.id))
              .map((g) => (
                <fieldset className="rounded-md border p-3" key={g.id}>
                  <legend>
                    {g.name} · choose {g.minSelections}–{g.maxSelections}
                  </legend>
                  {modifiers
                    .filter((m) => m.groupId === g.id)
                    .map((m) => (
                      <label key={m.id} className="flex min-h-12 items-center gap-3">
                        <input
                          type="checkbox"
                          name="modifierIds"
                          value={m.id}
                          className="h-5 w-5"
                        />
                        {m.name} · {m.priceAdjustment}
                      </label>
                    ))}
                </fieldset>
              ))}
          </div>
          <label className="block">
            New item quantity
            <Input
              name="quantity"
              type="number"
              min={1}
              max={999}
              required
              defaultValue={pos ? (quantities[productId] ?? 1) : 1}
              className="min-h-12"
            />
          </label>
          <label className="block">
            New item notes
            <Input name="notes" maxLength={2000} className="min-h-12" />
          </label>
          <Button type="submit" className="min-h-12 w-full" disabled={!product}>
            Add to order
          </Button>
        </fieldset>
      </form>
    ) : null;
  const orderNavigation = (
    <aside className="space-y-4">
      {manage ? (
        <form
          aria-label="New order"
          onSubmit={submitCreate}
          className="space-y-3 rounded-lg border p-4"
        >
          <h2 className="text-lg font-semibold">New order</h2>
          <fieldset disabled={locked} className="space-y-3">
            {pos ? (
              <div role="group" aria-label="Order type" className="service-selector">
                {layoutAccess ? (
                  <button
                    type="button"
                    aria-pressed={type === 'DINE_IN'}
                    onClick={() => setType('DINE_IN')}
                  >
                    Dine-in
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-pressed={type === 'TAKEAWAY'}
                  onClick={() => setType('TAKEAWAY')}
                >
                  Takeaway
                </button>
                <button type="button" disabled title="Delivery is not available">
                  Delivery
                </button>
              </div>
            ) : (
              <label className="block space-y-1">
                <span>Order type</span>
                <select
                  aria-label="Order type"
                  className={selectClass}
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                >
                  <option value="TAKEAWAY">Takeaway</option>
                  {layoutAccess ? <option value="DINE_IN">Dine-in</option> : null}
                </select>
              </label>
            )}
            {type === 'DINE_IN' ? (
              <label className="block space-y-1">
                <span>Free table</span>
                <select aria-label="Free table" required name="tableId" className={selectClass}>
                  <option value="">Choose a table</option>
                  {tables.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.number} · {t.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {assign ? (
              <label className="block space-y-1">
                <span>Assigned waiter</span>
                <select
                  aria-label="Assigned waiter"
                  name="waiterId"
                  className={selectClass}
                  defaultValue={user.id}
                >
                  {waiters.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="text-sm">Assigned to {user.name}</p>
            )}
            <label className="block space-y-1">
              <span>Order notes</span>
              <Input name="notes" maxLength={2000} className="min-h-12" />
            </label>
            <Button className="min-h-12 w-full" type="submit">
              Create draft
            </Button>
          </fieldset>
        </form>
      ) : null}
      <section aria-label="Order list" className="space-y-2">
        <h2 className="text-lg font-semibold">Recent orders</h2>
        {orders.length === 0 ? (
          <p>No orders yet.</p>
        ) : (
          orders.map((o) => (
            <button
              key={o.id}
              type="button"
              aria-pressed={selected === o.id}
              className={`min-h-16 w-full rounded-md border p-3 text-left ${selected === o.id ? 'border-primary bg-muted' : ''}`}
              onClick={() => {
                setSelected(o.id);
                setStale(true);
                setHistory([]);
              }}
            >
              <span className="font-semibold">
                #{o.orderNumber} · {o.tableName ?? 'Takeaway'}
              </span>
              <span className="block text-sm">
                {o.status.replaceAll('_', ' ')} · {o.total} {o.currency}
              </span>
            </button>
          ))
        )}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            disabled={page === 1 || busy}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous orders
          </Button>
          <span>{page}</span>
          <Button
            variant="outline"
            disabled={!hasMore || busy}
            onClick={() => setPage((p) => p + 1)}
          >
            Next orders
          </Button>
        </div>
      </section>
    </aside>
  );
  return (
    <div className={pos ? 'pos-workspace' : 'orders-workspace space-y-5'}>
      <div
        className={
          pos
            ? 'pos-toolbar flex items-center justify-end'
            : 'flex flex-wrap items-center justify-between gap-3'
        }
      >
        <p className="text-sm text-muted-foreground">
          {user.branchName} · Operator: {user.name} · Local updates every 5 seconds
        </p>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            setError('');
            void reload();
          }}
        >
          Refresh orders
        </Button>
      </div>
      {error ? (
        <p role="alert" className="rounded-md border border-destructive p-3 text-destructive">
          {error}
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {stale ? <p role="status">Refreshing local data. Editing is paused.</p> : null}
      {pending ? (
        <div className="rounded-md border border-amber-500 p-4">
          <p>
            A command needs confirmation from the local server. Retry it before making another
            change.
          </p>
          <Button className="mt-3 min-h-12" disabled={busy} onClick={() => void execute(pending)}>
            Retry pending command
          </Button>
        </div>
      ) : null}
      {pos ? (
        <details className="riza-order-switch" open={!order}>
          <summary>
            Start or switch order{' '}
            <span>{order ? `Current: #${order.orderNumber}` : 'Create your first draft'}</span>
          </summary>
          {orderNavigation}
        </details>
      ) : null}
      {pos && customizing && addItemForm ? (
        <dialog
          className="riza-dialog"
          aria-label="Customize product"
          ref={(node) => {
            if (node && !node.open) node.showModal();
          }}
          onClose={() => setCustomizing(false)}
        >
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="text-xl font-semibold">Make it yours</h2>
            <Button variant="outline" onClick={() => setCustomizing(false)}>
              Close
            </Button>
          </div>
          {addItemForm}
        </dialog>
      ) : null}
      <div
        className={
          pos ? 'pos-grid' : 'grid items-start gap-5 xl:grid-cols-[minmax(240px,1fr)_minmax(0,2fr)]'
        }
      >
        {pos ? (
          <section className="pos-catalog" aria-label="Product catalog">
            <div className="catalog-heading">
              <div>
                <p className="eyebrow">MADE TO ORDER</p>
                <h2>What's on the menu?</h2>
              </div>
              <span className="catalog-count">{products.length} products</span>
            </div>
            {catalogAccess ? (
              <>
                <label className="catalog-search">
                  <span>Search the menu</span>
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by name or SKU…"
                  />
                </label>
                <div className="category-strip" role="group" aria-label="Product categories">
                  <Button
                    variant={category === '' ? 'default' : 'outline'}
                    aria-pressed={category === ''}
                    onClick={() => setCategory('')}
                  >
                    All items
                  </Button>
                  {categories.map((c) => (
                    <Button
                      key={c.id}
                      variant={category === c.id ? 'default' : 'outline'}
                      aria-pressed={category === c.id}
                      onClick={() => setCategory(c.id)}
                    >
                      {c.name}
                    </Button>
                  ))}
                </div>
                <div className="product-grid">
                  {products
                    .filter(
                      (p) =>
                        (!category || p.categoryId === category) &&
                        (p.name.toLowerCase().includes(search.toLowerCase()) ||
                          p.sku?.toLowerCase().includes(search.toLowerCase())),
                    )
                    .map((p) => (
                      <article className="product-card" key={p.id} aria-label={`Product ${p.name}`}>
                        <button
                          className="product-select"
                          disabled={locked || !editable}
                          onClick={() => {
                            setProductId(p.id);
                            setCustomizing(true);
                          }}
                          aria-label={`Customize ${p.name}`}
                        >
                          <ProductImage name={p.name} src={p.imageUrl} />
                          <div className="product-copy">
                            <h3>{p.name}</h3>
                            <p>{p.description || 'Prepared to order. Customize it your way.'}</p>
                          </div>
                        </button>
                        <div className="product-footer">
                          <strong>
                            {p.sellingPrice} <small>{order?.currency ?? ''}</small>
                          </strong>
                          <div
                            className="quantity-stepper"
                            aria-label={`Draft quantity for ${p.name}`}
                          >
                            <button
                              aria-label={`Decrease ${p.name}`}
                              disabled={locked || !editable || (quantities[p.id] ?? 1) <= 1}
                              onClick={() =>
                                setQuantities((q) => ({
                                  ...q,
                                  [p.id]: Math.max(1, (q[p.id] ?? 1) - 1),
                                }))
                              }
                            >
                              −
                            </button>
                            <output>{quantities[p.id] ?? 1}</output>
                            <button
                              aria-label={`Increase ${p.name}`}
                              disabled={locked || !editable || (quantities[p.id] ?? 1) >= 999}
                              onClick={() =>
                                setQuantities((q) => ({
                                  ...q,
                                  [p.id]: Math.min(999, (q[p.id] ?? 1) + 1),
                                }))
                              }
                            >
                              +
                            </button>
                          </div>
                        </div>
                        <Button
                          variant="secondary"
                          className="product-customize"
                          disabled={locked || !editable}
                          onClick={() => {
                            setProductId(p.id);
                            setCustomizing(true);
                          }}
                        >
                          Customize & add
                        </Button>
                      </article>
                    ))}
                </div>
                {products.length === 0 ? (
                  <div className="riza-empty">
                    <span className="riza-mark" aria-hidden="true">
                      R
                    </span>
                    <h3>Your menu starts here</h3>
                    <p>
                      No active products are available. Products configured in Menu will appear
                      here.
                    </p>
                  </div>
                ) : !products.some(
                    (p) =>
                      (!category || p.categoryId === category) &&
                      (p.name.toLowerCase().includes(search.toLowerCase()) ||
                        p.sku?.toLowerCase().includes(search.toLowerCase())),
                  ) ? (
                  <p className="riza-empty">No products match this search.</p>
                ) : null}
              </>
            ) : (
              <p className="riza-empty">Menu access is not granted to this account.</p>
            )}
            {!editable ? (
              <p className="catalog-hint">Create or select an editable draft to add products.</p>
            ) : (
              <p className="catalog-hint">
                Choose a quantity, then customize your item before adding it.
              </p>
            )}
          </section>
        ) : (
          orderNavigation
        )}
        {order && order.id === selected ? (
          <section
            aria-label="Current order"
            id={pos ? 'pos-current-order' : undefined}
            className={
              pos
                ? 'pos-cart min-w-0 space-y-4 rounded-lg border p-4 md:p-5'
                : 'order-first min-w-0 space-y-4 rounded-lg border bg-card p-4 md:p-6 xl:order-last'
            }
          >
            <div>
              <p className="eyebrow">CURRENT ORDER</p>
              <h2 className="text-2xl font-semibold">Order #{order.orderNumber}</h2>
              <p>
                {order.tableName ? `${order.areaName} / ${order.tableName}` : 'Takeaway'} ·{' '}
                {order.waiterName ?? 'Unassigned waiter'}
              </p>
              <p className="order-status mt-2 font-medium">{order.status.replaceAll('_', ' ')}</p>
              {order.notes ? <p>{order.notes}</p> : null}
            </div>
            <div className="order-totals grid grid-cols-2 gap-3 rounded-md bg-muted p-4">
              <p>
                Subtotal (gross)
                <strong className="block">
                  {order.subtotal} {order.currency}
                </strong>
              </p>
              <p>
                Discount
                <strong className="block">
                  {order.discount} {order.currency}
                </strong>
              </p>
              <p>
                Included tax
                <strong className="block">
                  {order.tax} {order.currency}
                </strong>
              </p>
              <p className="text-lg">
                Total
                <strong className="block text-2xl" data-testid="order-total">
                  {order.total} {order.currency}
                </strong>
              </p>
            </div>
            <div className="cart-items space-y-3">
              {order.items.length === 0 ? (
                <p>Add the first item to this draft.</p>
              ) : (
                order.items.map((item) => (
                  <article
                    key={item.id}
                    aria-label={item.productName + (item.voidedAt ? ' voided' : '')}
                    className={`space-y-2 rounded-md border p-3 ${item.voidedAt ? 'bg-muted text-muted-foreground' : ''}`}
                  >
                    <div className="flex justify-between gap-3">
                      <h3 className="font-semibold">
                        {item.quantity} × {item.productName}
                      </h3>
                      <strong>
                        {item.total} {order.currency}
                      </strong>
                    </div>
                    <p className="text-sm">
                      {pos ? 'Unit price' : 'Snapshot price'} {item.unitPrice} · {item.taxRate}%{' '}
                      {item.taxMode.toLowerCase()} tax
                    </p>
                    {item.modifiers.map((m) => (
                      <p className="text-sm" key={m.modifierId}>
                        {m.groupName}: {m.name} ({m.priceAdjustment})
                      </p>
                    ))}
                    {item.notes ? <p>{item.notes}</p> : null}
                    {item.voidedAt ? (
                      <p>Voided: {item.voidReason}</p>
                    ) : editable && manage ? (
                      <OptionalDetails compact={pos} title="Edit item">
                        <form
                          className="flex flex-wrap items-end gap-2"
                          onSubmit={(e) => {
                            e.preventDefault();
                            const f = new FormData(e.currentTarget);
                            command({
                              action: 'update_item',
                              itemId: item.id,
                              quantity: Number(f.get('quantity')),
                              notes: f.get('notes'),
                            });
                          }}
                        >
                          <label className="w-24">
                            Quantity
                            <Input
                              key={`${item.id}:${item.quantity}`}
                              aria-label={`Quantity for ${item.productName}`}
                              name="quantity"
                              type="number"
                              min={1}
                              max={999}
                              defaultValue={item.quantity}
                              required
                              className="min-h-12"
                              disabled={locked}
                            />
                          </label>
                          <label className="min-w-0 flex-1">
                            Item notes
                            <Input
                              key={`${item.id}:${item.notes}`}
                              name="notes"
                              defaultValue={item.notes}
                              maxLength={2000}
                              className="min-h-12"
                              disabled={locked}
                            />
                          </label>
                          <Button
                            type="submit"
                            variant="outline"
                            className="min-h-12"
                            disabled={locked}
                          >
                            Update item
                          </Button>
                        </form>
                        <form
                          className="flex gap-2"
                          onSubmit={(e) => {
                            e.preventDefault();
                            command({
                              action: 'void_item',
                              itemId: item.id,
                              reason: new FormData(e.currentTarget).get('reason'),
                            });
                          }}
                        >
                          <Input
                            name="reason"
                            aria-label={`Removal reason for ${item.productName}`}
                            placeholder="Removal reason"
                            required
                            maxLength={500}
                            className="min-h-12"
                            disabled={locked}
                          />
                          <Button
                            type="submit"
                            variant="outline"
                            className="min-h-12"
                            disabled={locked}
                          >
                            Remove item
                          </Button>
                        </form>
                      </OptionalDetails>
                    ) : null}
                  </article>
                ))
              )}
            </div>
            {!pos ? addItemForm : null}
            <OptionalDetails compact={pos} title="Order options">
              {editable && manage && can('order.discount') ? (
                <OptionalDetails compact={false} title="Discount">
                  <form
                    aria-label="Order discount"
                    className="space-y-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      command({
                        action: 'discount',
                        amount: f.get('amount'),
                        reason: f.get('reason'),
                      });
                    }}
                  >
                    <label className="block">
                      Discount amount ({order.currency}, gross)
                      <Input
                        key={order.discount}
                        name="amount"
                        inputMode="decimal"
                        pattern="(0|[1-9][0-9]*)\.[0-9]{2}"
                        required
                        defaultValue={order.discount}
                        className="min-h-12"
                        disabled={locked}
                      />
                    </label>
                    <Input
                      name="reason"
                      aria-label="Discount reason"
                      placeholder="Discount reason"
                      required
                      maxLength={500}
                      className="min-h-12"
                      disabled={locked}
                    />
                    <Button type="submit" variant="outline" className="min-h-12" disabled={locked}>
                      Apply discount
                    </Button>
                  </form>
                </OptionalDetails>
              ) : null}
              {editable && manage && assign ? (
                <OptionalDetails compact={false} title="Assign waiter">
                  <form
                    className="flex flex-wrap gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      command({
                        action: 'assign_waiter',
                        waiterId: new FormData(e.currentTarget).get('waiterId') || null,
                      });
                    }}
                  >
                    <label className="flex-1">
                      Change waiter
                      <select
                        key={order.waiterId}
                        aria-label="Change waiter"
                        name="waiterId"
                        className={selectClass}
                        defaultValue={order.waiterId ?? ''}
                        disabled={locked}
                      >
                        <option value="">Unassigned</option>
                        {waiters.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Button type="submit" variant="outline" disabled={locked}>
                      Assign waiter
                    </Button>
                  </form>
                </OptionalDetails>
              ) : null}
            </OptionalDetails>
            {pos ? (
              <div className="service-selector" aria-label="Order service type">
                <span aria-current={order.type === 'DINE_IN' ? 'true' : undefined}>Dine-in</span>
                <span aria-current={order.type === 'TAKEAWAY' ? 'true' : undefined}>Takeaway</span>
                <button disabled title="Delivery is not available">
                  Delivery
                </button>
              </div>
            ) : null}
            {pos && can('payment.read') && can('order.read') ? (
              <div className="payment-shortcuts">
                <p className="text-sm text-muted-foreground">
                  {order.status === 'WAITING_PAYMENT'
                    ? 'Continue to payment collection'
                    : 'Request payment before collecting'}
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {['CASH', 'CARD', 'SPLIT'].map((method) => (
                    <Button
                      key={method}
                      variant="outline"
                      disabled={locked || order.status !== 'WAITING_PAYMENT'}
                      onClick={() => onPayment?.(order.id, method)}
                    >
                      {method === 'SPLIT' ? 'Split' : method === 'CASH' ? 'Cash' : 'Card'}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="order-actions flex flex-wrap gap-2">
              {manage && order.status === 'DRAFT' ? (
                <Button
                  className="min-h-12"
                  disabled={locked}
                  onClick={() => command({ action: 'status', status: 'OPEN' })}
                >
                  {pos ? 'Place Order' : 'Open order'}
                </Button>
              ) : null}
              {manage && order.status === 'OPEN' && can('order.submit_kitchen') ? (
                <Button
                  className="min-h-12"
                  disabled={locked}
                  onClick={() =>
                    void execute({
                      path: `orders/${order.id}/kitchen-submit`,
                      body: { commandId: crypto.randomUUID(), version: order.version },
                    })
                  }
                >
                  Send to kitchen
                </Button>
              ) : null}
              {manage && ['OPEN', 'READY'].includes(order.status) ? (
                <Button
                  className="min-h-12"
                  disabled={locked}
                  onClick={() => command({ action: 'status', status: 'WAITING_PAYMENT' })}
                >
                  Request payment
                </Button>
              ) : null}
              {manage &&
              order.status === 'WAITING_PAYMENT' &&
              !order.kitchenSubmitted &&
              !order.paymentStarted ? (
                <Button
                  className="min-h-12"
                  disabled={locked}
                  onClick={() => command({ action: 'status', status: 'OPEN' })}
                >
                  Reopen order
                </Button>
              ) : null}
              <Button
                variant="outline"
                className="min-h-12"
                onClick={async () => {
                  const requested = selected;
                  try {
                    const rows = await allHistory(requested);
                    if (selectedRef.current === requested) setHistory(rows);
                  } catch {
                    setError('Could not load order history.');
                  }
                }}
              >
                View order history
              </Button>
            </div>
            {manage &&
            can('order.cancel') &&
            ['DRAFT', 'OPEN', 'SENT_TO_KITCHEN', 'PREPARING', 'READY', 'WAITING_PAYMENT'].includes(
              order.status,
            ) ? (
              <OptionalDetails compact={pos} title="Cancel order">
                <form
                  className="flex flex-wrap gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    command({
                      action: 'cancel',
                      reason: new FormData(e.currentTarget).get('reason'),
                    });
                  }}
                >
                  <Input
                    name="reason"
                    aria-label="Cancellation reason"
                    placeholder="Cancellation reason"
                    required
                    maxLength={500}
                    className="min-h-12 flex-1"
                    disabled={locked}
                  />
                  <Button
                    variant="destructive"
                    type="submit"
                    className="min-h-12"
                    disabled={locked}
                  >
                    Cancel order
                  </Button>
                </form>
              </OptionalDetails>
            ) : null}
            {order.cancellationReason ? <p>Cancellation: {order.cancellationReason}</p> : null}
            {history.length ? (
              <ol aria-label="Order history" className="space-y-2 border-t pt-3">
                {history.map((h) => (
                  <li key={h.id} className="text-sm">
                    v{h.orderVersion} · {h.action} · {new Date(h.createdAt).toLocaleString()}
                  </li>
                ))}
              </ol>
            ) : null}
          </section>
        ) : (
          <div className="riza-empty rounded-lg border bg-card p-8 text-muted-foreground">
            <p className="eyebrow">CURRENT ORDER</p>
            <h2>Ready when you are</h2>
            <p>Select an order or create a draft to begin.</p>
            <div className="service-selector mt-6">
              <span>Dine-in</span>
              <span>Takeaway</span>
              <button disabled title="Delivery is not available">
                Delivery
              </button>
            </div>
          </div>
        )}
      </div>
      {pos && order ? (
        <a className="mobile-cart-link" href="#pos-current-order">
          <span>View order #{order.orderNumber}</span>
          <strong>
            {order.total} {order.currency}
          </strong>
        </a>
      ) : null}
    </div>
  );
}
async function allHistory(id: string) {
  const rows: OrderChange[] = [];
  let cursor = '0';
  for (;;) {
    const page = await api<{ events: OrderChange[]; cursor: string; hasMore: boolean }>(
      `orders/${id}/history?after=${cursor}`,
    );
    rows.push(...page.events);
    cursor = page.cursor;
    if (!page.hasMore) return rows;
  }
}
