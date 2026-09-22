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
import { useI18n, formatDateTime, serverMessage } from '../lib/i18n';
import { SALES_VALUE_KEYS } from '../lib/i18n/sales-messages';

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
  const { t, locale } = useI18n();
  const valueLabel = (value: string) => SALES_VALUE_KEYS[value] ? t(SALES_VALUE_KEYS[value]) : value;
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
        aria-label={t('sales.addOrderItem')}
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
        <h3 className="font-semibold">{t('sales.addProduct')}</h3>
        <fieldset disabled={locked} className="space-y-3">
          <label className="block">
            {t('sales.searchProducts')}
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="min-h-12"
              placeholder={t('sales.nameOrSku')}
            />
          </label>
          <label className="block">
            {t('sales.product')}
            <select
              className={selectClass}
              value={productId}
              aria-label={t('sales.product')}
              required
              onChange={(e) => setProductId(e.target.value)}
            >
              <option value="">{t('sales.chooseAProduct')}</option>
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
                    {t('sales.chooseRange', { name: g.name, min: g.minSelections ?? '', max: g.maxSelections ?? '' })}
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
            {t('sales.newItemQuantity')}
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
            {t('sales.newItemNotes')}
            <Input name="notes" maxLength={2000} className="min-h-12" />
          </label>
          <Button type="submit" className="min-h-12 w-full" disabled={!product}>
            {t('sales.addToOrder')}
          </Button>
        </fieldset>
      </form>
    ) : null;
  const orderNavigation = (
    <aside className="space-y-4">
      {manage ? (
        <form
          data-testid="new-order-form"
          aria-label={t('sales.newOrder')}
          onSubmit={submitCreate}
          className="space-y-3 rounded-lg border p-4"
        >
          <h2 className="text-lg font-semibold">{t('sales.newOrder')}</h2>
          <fieldset disabled={locked} className="space-y-3">
            {pos ? (
              <div role="group" aria-label={t('sales.orderType')} className="service-selector">
                {layoutAccess ? (
                  <button
                    type="button"
                    aria-pressed={type === 'DINE_IN'}
                    onClick={() => setType('DINE_IN')}
                  >
                    {t('sales.dineIn')}
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-pressed={type === 'TAKEAWAY'}
                  onClick={() => setType('TAKEAWAY')}
                >
                  {t('sales.takeaway')}
                </button>
                <button type="button" disabled title={t('sales.deliveryIsNotAvailable')}>
                  {t('sales.delivery')}
                </button>
              </div>
            ) : (
              <label className="block space-y-1">
                <span>{t('sales.orderType')}</span>
                <select
                  data-testid="order-type"
                  aria-label={t('sales.orderType')}
                  className={selectClass}
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                >
                  <option value="TAKEAWAY">{t('sales.takeaway')}</option>
                  {layoutAccess ? <option value="DINE_IN">{t('sales.dineIn')}</option> : null}
                </select>
              </label>
            )}
            {type === 'DINE_IN' ? (
              <label className="block space-y-1">
                <span>{t('sales.freeTable')}</span>
                <select aria-label={t('sales.freeTable')} required name="tableId" className={selectClass}>
                  <option value="">{t('sales.chooseATable')}</option>
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
                <span>{t('sales.assignedWaiter')}</span>
                <select
                  aria-label={t('sales.assignedWaiter')}
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
              <p className="text-sm">{t('sales.assignedTo')} {user.name}</p>
            )}
            <label className="block space-y-1">
              <span>{t('sales.orderNotes')}</span>
              <Input data-testid="order-notes" name="notes" maxLength={2000} className="min-h-12" />
            </label>
            <Button data-testid="create-draft" className="min-h-12 w-full" type="submit">
              {t('sales.createDraft')}
            </Button>
          </fieldset>
        </form>
      ) : null}
      <section aria-label={t('sales.orderList')} className="space-y-2">
        <h2 className="text-lg font-semibold">{t('sales.recentOrders')}</h2>
        {orders.length === 0 ? (
          <p>{t('sales.noOrdersYet')}</p>
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
                #{o.orderNumber} · {o.tableName ?? t('sales.takeaway')}
              </span>
              <span className="block text-sm">
                {locale === 'en' ? o.status.replaceAll('_', ' ') : valueLabel(o.status)} · {o.total} {o.currency}
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
            {t('sales.previousOrders')}
          </Button>
          <span>{page}</span>
          <Button
            variant="outline"
            disabled={!hasMore || busy}
            onClick={() => setPage((p) => p + 1)}
          >
            {t('sales.nextOrders')}
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
          {t('sales.operatorRefresh', { branch: user.branchName, name: user.name })}
        </p>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            setError('');
            void reload();
          }}
        >
          {t('sales.refreshOrders')}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="rounded-md border border-destructive p-3 text-destructive">
          {serverMessage(error, locale)}
        </p>
      ) : null}
      {notice ? <p role="status">{serverMessage(notice, locale)}</p> : null}
      {stale ? <p role="status">{t('sales.refreshingLocalDataEditingIsPaused')}</p> : null}
      {pending ? (
        <div className="rounded-md border border-amber-500 p-4">
          <p>
            {t('sales.aCommandNeedsConfirmationFromTheLocalServerRetryItBeforeMakingAnotherChange')}
          </p>
          <Button className="mt-3 min-h-12" disabled={busy} onClick={() => void execute(pending)}>
            {t('sales.retryPendingCommand')}
          </Button>
        </div>
      ) : null}
      {pos ? (
        <details className="riza-order-switch" open={!order}>
          <summary>
            {t('sales.startOrSwitchOrder')}{' '}
            <span>{order ? t('sales.currentNumber', { number: order.orderNumber }) : t('sales.firstDraft')}</span>
          </summary>
          {orderNavigation}
        </details>
      ) : null}
      {pos && customizing && addItemForm ? (
        <dialog
          className="riza-dialog"
          aria-label={t('sales.customizeProduct')}
          ref={(node) => {
            if (node && !node.open) node.showModal();
          }}
          onClose={() => setCustomizing(false)}
        >
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="text-xl font-semibold">{t('sales.makeItYours')}</h2>
            <Button variant="outline" onClick={() => setCustomizing(false)}>
              {t('sales.close')}
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
          <section className="pos-catalog" aria-label={t('sales.productCatalog')}>
            <div className="catalog-heading">
              <div>
                <p className="eyebrow">{t('sales.madeToOrder')}</p>
                <h2>{t('sales.whatSOnTheMenu')}</h2>
              </div>
              <span className="catalog-count">{products.length} {t('sales.products')}</span>
            </div>
            {catalogAccess ? (
              <>
                <label className="catalog-search">
                  <span>{t('sales.searchTheMenu')}</span>
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t('sales.searchByNameOrSku')}
                  />
                </label>
                <div className="category-strip" role="group" aria-label={t('sales.productCategories')}>
                  <Button
                    variant={category === '' ? 'default' : 'outline'}
                    aria-pressed={category === ''}
                    onClick={() => setCategory('')}
                  >
                    {t('sales.allItems')}
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
                      <article className="product-card" key={p.id} aria-label={t('sales.productName', { name: p.name })}>
                        <button
                          className="product-select"
                          disabled={locked || !editable}
                          onClick={() => {
                            setProductId(p.id);
                            setCustomizing(true);
                          }}
                          aria-label={t('sales.customizeName', { name: p.name })}
                        >
                          <ProductImage name={p.name} src={p.imageUrl} />
                          <div className="product-copy">
                            <h3>{p.name}</h3>
                            <p>{p.description || t('sales.preparedToOrder')}</p>
                          </div>
                        </button>
                        <div className="product-footer">
                          <strong>
                            {p.sellingPrice} <small>{order?.currency ?? ''}</small>
                          </strong>
                          <div
                            className="quantity-stepper"
                            aria-label={t('sales.draftQuantity', { name: p.name })}
                          >
                            <button
                              aria-label={t('sales.decrease', { name: p.name })}
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
                              aria-label={t('sales.increase', { name: p.name })}
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
                          {t('sales.customizeAdd')}
                        </Button>
                      </article>
                    ))}
                </div>
                {products.length === 0 ? (
                  <div className="riza-empty">
                    <span className="riza-mark" aria-hidden="true">
                      R
                    </span>
                    <h3>{t('sales.yourMenuStartsHere')}</h3>
                    <p>
                      {t('sales.noActiveProductsAreAvailableProductsConfiguredInMenuWillAppearHere')}
                    </p>
                  </div>
                ) : !products.some(
                    (p) =>
                      (!category || p.categoryId === category) &&
                      (p.name.toLowerCase().includes(search.toLowerCase()) ||
                        p.sku?.toLowerCase().includes(search.toLowerCase())),
                  ) ? (
                  <p className="riza-empty">{t('sales.noProductsMatchThisSearch')}</p>
                ) : null}
              </>
            ) : (
              <p className="riza-empty">{t('sales.menuAccessIsNotGrantedToThisAccount')}</p>
            )}
            {!editable ? (
              <p className="catalog-hint">{t('sales.createOrSelectAnEditableDraftToAddProducts')}</p>
            ) : (
              <p className="catalog-hint">
                {t('sales.chooseAQuantityThenCustomizeYourItemBeforeAddingIt')}
              </p>
            )}
          </section>
        ) : (
          orderNavigation
        )}
        {order && order.id === selected ? (
          <section
            aria-label={t('sales.currentOrder')}
            id={pos ? 'pos-current-order' : undefined}
            className={
              pos
                ? 'pos-cart min-w-0 space-y-4 rounded-lg border p-4 md:p-5'
                : 'order-first min-w-0 space-y-4 rounded-lg border bg-card p-4 md:p-6 xl:order-last'
            }
          >
            <div>
              <p className="eyebrow">{t('sales.currentOrderLabel')}</p>
              <h2 className="text-2xl font-semibold">{t('sales.orderNumber', { number: order.orderNumber })}</h2>
              <p>
                {order.tableName ? `${order.areaName} / ${order.tableName}` : t('sales.waiterTakeaway')} ·{' '}
                {order.waiterName ?? t('sales.unassignedWaiter')}
              </p>
              <p className="order-status mt-2 font-medium">{locale === 'en' ? order.status.replaceAll('_', ' ') : valueLabel(order.status)}</p>
              {order.notes ? <p>{order.notes}</p> : null}
            </div>
            <div className="order-totals grid grid-cols-2 gap-3 rounded-md bg-muted p-4">
              <p>
                {t('sales.subtotalGross')}
                <strong className="block">
                  {order.subtotal} {order.currency}
                </strong>
              </p>
              <p>
                {t('sales.discount')}
                <strong className="block">
                  {order.discount} {order.currency}
                </strong>
              </p>
              <p>
                {t('sales.includedTax')}
                <strong className="block">
                  {order.tax} {order.currency}
                </strong>
              </p>
              <p className="text-lg">
                {t('sales.total')}
                <strong className="block text-2xl" data-testid="order-total">
                  {order.total} {order.currency}
                </strong>
              </p>
            </div>
            <div className="cart-items space-y-3">
              {order.items.length === 0 ? (
                <p>{t('sales.addTheFirstItemToThisDraft')}</p>
              ) : (
                order.items.map((item) => (
                  <article
                    key={item.id}
                    aria-label={item.productName + (item.voidedAt ? t('sales.voidedSuffix') : '')}
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
                      {pos ? t('sales.unitPrice') : t('sales.snapshotPrice')} {item.unitPrice} · {item.taxRate}%{' '}
                      {locale === 'en' ? item.taxMode.toLowerCase() : valueLabel(item.taxMode)} {t('sales.tax')}
                    </p>
                    {item.modifiers.map((m) => (
                      <p className="text-sm" key={m.modifierId}>
                        {m.groupName}: {m.name} ({m.priceAdjustment})
                      </p>
                    ))}
                    {item.notes ? <p>{item.notes}</p> : null}
                    {item.voidedAt ? (
                      <p>{t('sales.voided')} {item.voidReason}</p>
                    ) : editable && manage ? (
                      <OptionalDetails compact={pos} title={t('sales.editItem')}>
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
                            {t('sales.quantity')}
                            <Input
                              key={`${item.id}:${item.quantity}`}
                              aria-label={t('sales.quantityFor', { name: item.productName })}
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
                            {t('sales.itemNotes')}
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
                            {t('sales.updateItem')}
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
                            aria-label={t('sales.removalReasonFor', { name: item.productName })}
                            placeholder={t('sales.removalReason')}
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
                            {t('sales.removeItem')}
                          </Button>
                        </form>
                      </OptionalDetails>
                    ) : null}
                  </article>
                ))
              )}
            </div>
            {!pos ? addItemForm : null}
            <OptionalDetails compact={pos} title={t('sales.orderOptions')}>
              {editable && manage && can('order.discount') ? (
                <OptionalDetails compact={false} title={t('sales.discount')}>
                  <form
                    aria-label={t('sales.orderDiscount')}
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
                      {t('sales.discountAmount', { currency: order.currency })}
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
                      aria-label={t('sales.discountReason')}
                      placeholder={t('sales.discountReason')}
                      required
                      maxLength={500}
                      className="min-h-12"
                      disabled={locked}
                    />
                    <Button type="submit" variant="outline" className="min-h-12" disabled={locked}>
                      {t('sales.applyDiscount')}
                    </Button>
                  </form>
                </OptionalDetails>
              ) : null}
              {editable && manage && assign ? (
                <OptionalDetails compact={false} title={t('sales.assignWaiter')}>
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
                      {t('sales.changeWaiter')}
                      <select
                        key={order.waiterId}
                        aria-label={t('sales.changeWaiter')}
                        name="waiterId"
                        className={selectClass}
                        defaultValue={order.waiterId ?? ''}
                        disabled={locked}
                      >
                        <option value="">{t('sales.unassigned')}</option>
                        {waiters.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Button type="submit" variant="outline" disabled={locked}>
                      {t('sales.assignWaiter')}
                    </Button>
                  </form>
                </OptionalDetails>
              ) : null}
            </OptionalDetails>
            {pos ? (
              <div className="service-selector" aria-label={t('sales.orderServiceType')}>
                <span aria-current={order.type === 'DINE_IN' ? 'true' : undefined}>{t('sales.dineIn')}</span>
                <span aria-current={order.type === 'TAKEAWAY' ? 'true' : undefined}>{t('sales.takeaway')}</span>
                <button disabled title={t('sales.deliveryIsNotAvailable')}>
                  {t('sales.delivery')}
                </button>
              </div>
            ) : null}
            {pos && can('payment.read') && can('order.read') ? (
              <div className="payment-shortcuts">
                <p className="text-sm text-muted-foreground">
                  {order.status === 'WAITING_PAYMENT'
                    ? t('sales.continuePayment')
                    : t('sales.requestBeforeCollect')}
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {[t('sales.cash'), t('sales.card'), 'SPLIT'].map((method) => (
                    <Button
                      key={method}
                      variant="outline"
                      disabled={locked || order.status !== 'WAITING_PAYMENT'}
                      onClick={() => onPayment?.(order.id, method)}
                    >
                      {method === 'SPLIT' ? t('sales.split') : method === 'CASH' ? t('sales.cashLabel') : t('sales.cardLabel')}
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
                  {pos ? t('sales.placeOrder') : t('sales.openOrder')}
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
                  {t('sales.sendToKitchen')}
                </Button>
              ) : null}
              {manage && ['OPEN', 'READY'].includes(order.status) ? (
                <Button
                  className="min-h-12"
                  disabled={locked}
                  onClick={() => command({ action: 'status', status: 'WAITING_PAYMENT' })}
                >
                  {t('sales.requestPayment')}
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
                  {t('sales.reopenOrder')}
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
                {t('sales.viewOrderHistory')}
              </Button>
            </div>
            {manage &&
            can('order.cancel') &&
            ['DRAFT', 'OPEN', 'SENT_TO_KITCHEN', 'PREPARING', 'READY', 'WAITING_PAYMENT'].includes(
              order.status,
            ) ? (
              <OptionalDetails compact={pos} title={t('sales.cancelOrder')}>
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
                    aria-label={t('sales.cancellationReason')}
                    placeholder={t('sales.cancellationReason')}
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
                    {t('sales.cancelOrder')}
                  </Button>
                </form>
              </OptionalDetails>
            ) : null}
            {order.cancellationReason ? <p>{t('sales.cancellation')} {order.cancellationReason}</p> : null}
            {history.length ? (
              <ol aria-label={t('sales.orderHistory')} className="space-y-2 border-t pt-3">
                {history.map((h) => (
                  <li key={h.id} className="text-sm">
                    v{h.orderVersion} · {valueLabel(h.action)} · {formatDateTime(h.createdAt, locale)}
                  </li>
                ))}
              </ol>
            ) : null}
          </section>
        ) : (
          <div className="riza-empty rounded-lg border bg-card p-8 text-muted-foreground">
            <p className="eyebrow">{t('sales.currentOrderLabel')}</p>
            <h2>{t('sales.readyWhenYouAre')}</h2>
            <p>{t('sales.selectAnOrderOrCreateADraftToBegin')}</p>
            <div className="service-selector mt-6">
              <span>{t('sales.dineIn')}</span>
              <span>{t('sales.takeaway')}</span>
              <button disabled title={t('sales.deliveryIsNotAvailable')}>
                {t('sales.delivery')}
              </button>
            </div>
          </div>
        )}
      </div>
      {pos && order ? (
        <a className="mobile-cart-link" href="#pos-current-order">
          <span>{t('sales.viewOrderNumber', { number: order.orderNumber })}</span>
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
