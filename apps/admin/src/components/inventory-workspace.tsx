'use client';
import { useI18n, serverMessage, formatDateTime, type Translate } from '../lib/i18n';

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type {
  InventoryItemRecord,
  WarehouseRecord,
  RecipeRecord,
  StockRecord,
  StockMovementRecord,
  SessionUser,
  InventoryUnitCode,
} from '@restaurant/shared-types';
import { Button } from '@restaurant/ui/button';
import { Input } from '@restaurant/ui/input';
import { api, ApiFailure } from '../lib/api';

type View = 'Stock' | 'Items' | 'Warehouses' | 'Recipes' | 'History';
type Pending = { path: string; method: string; body: Record<string, unknown> };
type Page<T> = { items: T[]; hasMore: boolean };
type Product = { id: string; name: string; active: boolean };
const units: InventoryUnitCode[] = ['kg', 'g', 'l', 'ml', 'pcs'];
const qty = (v: string) => (v.includes('.') ? v.replace(/\.?0+$/, '') || '0' : v);
const unitLabel = (unit: InventoryUnitCode, t: Translate) =>
  ({
    kg: t('operations.kgKilograms'),
    g: t('operations.gGrams'),
    l: t('operations.lLitres'),
    ml: t('operations.mlMillilitres'),
    pcs: t('operations.pcsPieces'),
  })[unit];
const data = (e: FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  return Object.fromEntries(new FormData(e.currentTarget));
};
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-2 block text-sm">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
async function all<T>(path: string) {
  const rows: T[] = [];
  for (let page = 1; ; page++) {
    const result = await api<Page<T>>(`${path}?limit=100&page=${page}`);
    rows.push(...result.items);
    if (!result.hasMore) return rows;
  }
}

export function InventoryWorkspace({ user }: { user: SessionUser }) {
  const { t, locale } = useI18n();
  const can = (key: SessionUser['permissions'][number]) => user.permissions.includes(key);
  const [view, setView] = useState<View>('Stock');
  const [items, setItems] = useState<InventoryItemRecord[]>([]),
    [warehouses, setWarehouses] = useState<WarehouseRecord[]>([]),
    [products, setProducts] = useState<Product[]>([]);
  const [stock, setStock] = useState<StockRecord[]>([]),
    [recipes, setRecipes] = useState<RecipeRecord[]>([]),
    [movements, setMovements] = useState<StockMovementRecord[]>([]);
  const [page, setPage] = useState(1),
    [more, setMore] = useState(false),
    [search, setSearch] = useState(''),
    [warehouseId, setWarehouseId] = useState('');
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [stale, setStale] = useState(true),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<Pending | null>(null);
  const [movementKind, setMovementKind] = useState<'ADJUSTMENT' | 'WASTE' | null>(null),
    [selectedItem, setSelectedItem] = useState(''),
    [movementWarehouse, setMovementWarehouse] = useState('');
  const [editor, setEditor] = useState<InventoryItemRecord | WarehouseRecord | null>(null),
    [creating, setCreating] = useState(false),
    [threshold, setThreshold] = useState<StockRecord | 'new' | null>(null);
  const [recipe, setRecipe] = useState<RecipeRecord | 'new' | null>(null),
    [recipeLines, setRecipeLines] = useState<
      { key: string; itemId: string; quantity: string; unitCode: InventoryUnitCode }[]
    >([]),
    [recipeHistory, setRecipeHistory] = useState<RecipeRecord[] | null>(null);
  const generation = useRef(0),
    saving = useRef(false);
  const storageKey = `restaurant-inventory-command:v1:${user.organizationId}:${user.branchId}:${user.id}`;
  useEffect(() => {
    const saved = sessionStorage.getItem(storageKey);
    if (saved)
      try {
        const parsed = JSON.parse(saved);
        if (
          typeof parsed.path !== 'string' ||
          !parsed.path.startsWith('inventory/') ||
          !['POST', 'PUT'].includes(parsed.method) ||
          !parsed.body?.commandId
        )
          throw new Error('Invalid receipt');
        setPending(parsed);
      } catch {
        setError(
          'The saved inventory receipt is unreadable. Check history before recording another movement.',
        );
        setPending({ path: '', method: '', body: {} });
      }
  }, [storageKey]);
  const reload = useCallback(async () => {
    const current = ++generation.current;
    const query = new URLSearchParams({
      page: String(page),
      limit: '25',
      search,
      ...(warehouseId ? { warehouseId } : {}),
    });
    try {
      const [catalog, stores, menu, result] = await Promise.all([
        all<InventoryItemRecord>('inventory/items'),
        all<WarehouseRecord>('inventory/warehouses'),
        all<Product>('inventory/products'),
        api<Page<StockRecord | RecipeRecord | StockMovementRecord>>(
          `inventory/${view === 'Recipes' ? 'recipes' : view === 'History' ? 'movements' : 'stock'}?${query}`,
        ),
      ]);
      if (current !== generation.current || saving.current) return;
      setItems(catalog);
      setWarehouses(stores);
      setProducts(menu);
      setMore(result.hasMore);
      if (view === 'Recipes') setRecipes(result.items as RecipeRecord[]);
      else if (view === 'History') setMovements(result.items as StockMovementRecord[]);
      else setStock(result.items as StockRecord[]);
      setStale(false);
    } catch (e) {
      if (current === generation.current) {
        setStale(true);
        setError(e instanceof Error ? e.message : 'Inventory could not be loaded');
      }
    }
  }, [page, search, warehouseId, view]);
  useEffect(() => {
    void reload();
    const timer = setInterval(() => {
      if (!saving.current) void reload();
    }, 10000);
    const counter = generation;
    return () => {
      clearInterval(timer);
      counter.current++;
    };
  }, [reload]);
  async function execute(request: Pending) {
    if (saving.current || !request.path) return;
    saving.current = true;
    setBusy(true);
    generation.current++;
    setError('');
    setNotice('');
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(request));
      setPending(request);
      await api(request.path, request.method, request.body);
      sessionStorage.removeItem(storageKey);
      setPending(null);
      setNotice('Inventory saved. Stock history is up to date.');
      setMovementKind(null);
      setEditor(null);
      setCreating(false);
      setThreshold(null);
      setRecipe(null);
      setStale(true);
    } catch (e) {
      if (e instanceof ApiFailure && e.status >= 400 && e.status < 500) {
        sessionStorage.removeItem(storageKey);
        setPending(null);
      }
      setError(
        e instanceof ApiFailure
          ? e.message
          : 'Save outcome unknown. Retry the saved command before making another change.',
      );
      setStale(true);
    } finally {
      saving.current = false;
      setBusy(false);
      void reload();
    }
  }
  const locked = busy || stale || !!pending;
  const submit = (path: string, body: Record<string, unknown>, method = 'POST') => {
    if (!locked)
      void execute({
        path: `inventory/${path}`,
        method,
        body: { ...body, commandId: crypto.randomUUID() },
      });
  };
  const startMovement = (kind: 'ADJUSTMENT' | 'WASTE', row?: StockRecord) => {
    setMovementKind(kind);
    setSelectedItem(row?.itemId ?? '');
    setMovementWarehouse(row?.warehouseId ?? warehouseId);
  };
  const selectItem = (name: string, value?: string, change?: (value: string) => void) => (
    <select
      name={name}
      aria-label={t('operations.inventoryItem')}
      required
      {...(change
        ? { value, onChange: (e) => change(e.target.value) }
        : { defaultValue: value ?? '' })}
    >
      <option value="">{t('operations.chooseAnItem')}</option>
      {items
        .filter((i) => i.active)
        .map((i) => (
          <option key={i.id} value={i.id}>
            {i.name} · {i.unitCode}
          </option>
        ))}
    </select>
  );
  const selectWarehouse = (name: string, value = '', change?: (value: string) => void) => (
    <select
      name={name}
      aria-label={t('operations.warehouse')}
      required
      {...(change ? { value, onChange: (e) => change(e.target.value) } : { defaultValue: value })}
    >
      <option value="">{t('operations.chooseAWarehouse')}</option>
      {warehouses
        .filter((w) => w.active)
        .map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
    </select>
  );
  const selectUnit = (value: string, name = 'unitCode') => (
    <select name={name} aria-label={t('operations.quantityUnit')} defaultValue={value}>
      {units.map((u) => (
        <option key={u} value={u}>
          {unitLabel(u, t)}
        </option>
      ))}
    </select>
  );
  const openRecipe = (row: RecipeRecord | 'new') => {
    setRecipe(row);
    setRecipeLines(
      row === 'new'
        ? [{ key: crypto.randomUUID(), itemId: '', quantity: '', unitCode: 'g' }]
        : row.items.map((i) => ({
            key: crypto.randomUUID(),
            itemId: i.itemId,
            quantity: i.quantity,
            unitCode: i.unitCode,
          })),
    );
  };
  const dialogOpen = movementKind || creating || editor || threshold || recipe || recipeHistory;
  const close = () => {
    if (!busy) {
      setMovementKind(null);
      setCreating(false);
      setEditor(null);
      setThreshold(null);
      setRecipe(null);
      setRecipeHistory(null);
    }
  };
  return (
    <div className="space-y-5">
      <div className="inventory-banner">
        <div>
          <p className="eyebrow">{t('operations.stockUnderControl')}</p>
          <h2 className="text-xl font-semibold">{t('operations.knowWhatSInYourKitchen')}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {user.branchName} {t('operations.everyAdjustmentSaleAndWasteEntryLeavesAHistory')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can('inventory.adjust') ? (
            <Button disabled={locked} onClick={() => startMovement('ADJUSTMENT')}>
              {t('operations.adjustStock')}
            </Button>
          ) : null}
          {can('inventory.waste') ? (
            <Button variant="outline" disabled={locked} onClick={() => startMovement('WASTE')}>
              {t('operations.recordWaste')}
            </Button>
          ) : null}
        </div>
      </div>
      <div role="group" aria-label={t('operations.inventoryViews')} className="flex gap-2 overflow-x-auto pb-1">
        {(['Stock', 'Items', 'Warehouses', 'Recipes', 'History'] as View[]).map((v) => (
          <Button
            key={v}
            className="shrink-0"
            variant={view === v ? 'default' : 'outline'}
            aria-pressed={view === v}
            onClick={() => {
              setView(v);
              setPage(1);
              setSearch('');
              setStale(true);
            }}
          >
            {t({ Stock: 'operations.stock', Items: 'operations.ingredientsItems', Warehouses: 'operations.warehouses', Recipes: 'operations.recipes', History: 'operations.history' }[v] as 'operations.stock' | 'operations.ingredientsItems' | 'operations.warehouses' | 'operations.recipes' | 'operations.history')}
          </Button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="rounded-lg border border-destructive p-3 text-destructive">
          {serverMessage(error, locale)}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-primary">
          {serverMessage(notice, locale)}
        </p>
      ) : null}
      {stale ? <p role="status">{t('operations.refreshingInventoryChangesArePaused')}</p> : null}
      {pending ? (
        <div className="rounded-lg border border-primary p-4">
          <p>{t('operations.aPreviousSaveNeedsConfirmationReviewTheResultByRetryingTheSameCommand')}</p>
          <Button
            className="mt-3"
            disabled={busy || !pending.path}
            onClick={() => void execute(pending)}
          >
            {t('operations.retryInventoryCommand')}
          </Button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <Field label={t('operations.searchInventory')}>
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder={t('operations.findAnItemOrRecipe')}
            />
          </Field>
        </div>
        {view === 'Stock' || view === 'History' ? (
          <div className="min-w-48">
            <Field label={t('operations.filterWarehouse')}>
              <select
                value={warehouseId}
                onChange={(e) => {
                  setWarehouseId(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">{t('operations.allWarehouses')}</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        ) : null}
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            setError('');
            void reload();
          }}
        >
          {t('operations.refreshInventory')}
        </Button>
        {(view === 'Items' || view === 'Warehouses') && can('inventory.manage') ? (
          <Button disabled={locked} onClick={() => setCreating(true)}>
            {view === 'Items' ? t('operations.addInventoryItem') : t('operations.addWarehouse')}
          </Button>
        ) : null}
        {view === 'Recipes' && can('recipe.manage') ? (
          <Button disabled={locked} onClick={() => openRecipe('new')}>
            {t('operations.createRecipe')}
          </Button>
        ) : null}
        {view === 'Stock' && can('inventory.manage') ? (
          <Button variant="outline" disabled={locked} onClick={() => setThreshold('new')}>
            {t('operations.setLowStockAlert')}
          </Button>
        ) : null}
      </div>
      {view === 'Stock' ? (
        <>
          <p className="text-sm text-muted-foreground">
            {t('operations.quantitiesAreCalculatedFromRecordedMovementsNegativeQuantitiesAreShownNeverHidden')}
          </p>
          <div className="inventory-stock-grid">
            {stock.map((r) => (
              <article
                key={r.id}
                className="inventory-stock-card"
                aria-label={t('operations.stockAtWarehouse', { item: r.itemName, warehouse: r.warehouseName })}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">{r.warehouseName}</p>
                    <h3 className="mt-1 font-semibold">{r.itemName}</h3>
                  </div>
                  <span className={r.lowStock ? 'stock-badge stock-low' : 'stock-badge'}>
                    {r.lowStock ? t('operations.lowStock') : t('operations.inStock')}
                  </span>
                </div>
                <p
                  className={`my-5 text-3xl font-semibold ${r.quantity.startsWith('-') ? 'text-destructive' : ''}`}
                >
                  <span data-testid="stock-quantity">{qty(r.quantity)}</span>{' '}
                  <small className="text-sm font-normal text-muted-foreground">{r.unitCode}</small>
                </p>
                <p className="mb-4 text-xs text-muted-foreground">
                  {t('operations.alertAt')} {qty(r.lowStockThreshold)} {r.unitCode}
                  {!r.active ? t('operations.inactiveConfiguration') : ''}
                </p>
                <div className="flex flex-wrap gap-2">
                  {can('inventory.adjust') && r.active ? (
                    <Button
                      variant="outline"
                      disabled={locked}
                      onClick={() => startMovement('ADJUSTMENT', r)}
                    >
                      {t('operations.adjust')}
                    </Button>
                  ) : null}
                  {can('inventory.waste') && r.active ? (
                    <Button
                      variant="outline"
                      disabled={locked}
                      onClick={() => startMovement('WASTE', r)}
                    >
                      {t('operations.waste')}
                    </Button>
                  ) : null}
                  {can('inventory.manage') && r.active ? (
                    <Button variant="ghost" disabled={locked} onClick={() => setThreshold(r)}>
                      {t('operations.editAlert')}
                    </Button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
          {!stock.length && !stale ? (
            <Empty
              title={t('operations.startWithYourOpeningStock')}
              text={t('operations.addAWarehouseAndInventoryItemsThenRecordAnOpeningStockAdjustmentOrSetALowStockAlert')}
            />
          ) : null}
        </>
      ) : null}
      {view === 'Items' || view === 'Warehouses' ? (
        <div className="space-y-3">
          {(view === 'Items' ? items : warehouses)
            .filter((r) => r.name.toLowerCase().includes(search.toLowerCase()))
            .map((r) => (
              <article
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-5"
              >
                <div>
                  <h3 className="font-semibold">{r.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {'sku' in r
                      ? `${r.sku} · ${r.unitCode} · ${r.kind === 'INGREDIENT' ? t('operations.ingredient') : t('operations.stockItem')}`
                      : r.description}
                    {!r.active ? t('operations.inactive') : ''}
                  </p>
                </div>
                {can('inventory.manage') ? (
                  <Button
                    variant="outline"
                    disabled={locked}
                    onClick={() => setEditor(r)}
                    aria-label={t('operations.editName', { name: r.name })}
                  >
                    {t('operations.edit')}
                  </Button>
                ) : null}
              </article>
            ))}
          {!(view === 'Items' ? items : warehouses).length && !stale ? (
            <Empty
              title={view === 'Items' ? t('operations.yourStockCatalogStartsHere') : t('operations.giveYourStockAHome')}
              text={
                view === 'Items'
                  ? t('operations.createIngredientsAndOtherItemsYouWantToTrack')
                  : t('operations.createIndependentlyManagedKitchensStoresOrOtherWarehouses')
              }
            />
          ) : null}
        </div>
      ) : null}
      {view === 'Recipes' ? (
        <div className="space-y-3">
          {recipes.map((r) => (
            <article key={r.id} className="rounded-xl border bg-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{r.productName}</h3>
                  <p className="text-sm text-muted-foreground">
                    {r.warehouseName} {t('operations.version')} {r.version} · {r.active ? t('operations.active') : t('operations.inactive2')}
                  </p>
                </div>
                <div className="flex gap-2">
                  {can('recipe.manage') ? (
                    <Button
                      variant="outline"
                      disabled={locked}
                      onClick={() => openRecipe(r)}
                      aria-label={t('operations.editRecipeName', { name: r.productName })}
                    >
                      {t('operations.editRecipe')}
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      try {
                        setRecipeHistory(
                          await all<RecipeRecord>(`inventory/recipes/${r.id}/history`),
                        );
                      } catch {
                        setError('Recipe history could not be loaded');
                      }
                    }}
                  >
                    {t('operations.versions')}
                  </Button>
                </div>
              </div>
              <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                {r.items.map((i) => (
                  <li key={i.itemId}>
                    {qty(i.quantity)} {i.unitCode} · {i.name}
                  </li>
                ))}
              </ul>
            </article>
          ))}
          {!recipes.length && !stale ? (
            <Empty
              title={t('operations.connectYourMenuToYourStock')}
              text={t('operations.aRecipeDefinesTheIngredientsConsumedForOneSoldProductProductsWithoutAnActiveRecipeDoNotConsumeStock')}
            />
          ) : null}
          <p className="text-sm text-muted-foreground">
            {t('operations.recipesCoverTheBaseProductModifierSpecificIngredientsAreNotConfiguredInThisPhase')}
          </p>
        </div>
      ) : null}
      {view === 'History' ? (
        <div className="space-y-3">
          {movements.map((m) => (
            <article key={m.id} className="rounded-xl border bg-card p-5">
              <div className="flex flex-wrap justify-between gap-3">
                <div>
                  <h3 className="font-semibold">
                    {m.itemName}{' '}
                    <span className="text-xs font-normal text-muted-foreground">
                      · {m.warehouseName}
                    </span>
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {t(({ PURCHASE: 'operations.movementPurchase', SALE_CONSUMPTION: 'operations.movementSaleConsumption', WASTE: 'operations.waste', ADJUSTMENT: 'operations.movementAdjustment', TRANSFER_IN: 'operations.movementTransferIn', TRANSFER_OUT: 'operations.movementTransferOut', RETURN: 'operations.movementReturn' } as const)[m.kind])} · {formatDateTime(m.createdAt, locale)}
                  </p>
                </div>
                <strong
                  className={m.quantity.startsWith('-') ? 'text-destructive' : 'text-primary'}
                >
                  {qty(m.quantity)} {m.unitCode}
                </strong>
              </div>
              <p className="mt-3 text-sm">{serverMessage(m.reason, locale)}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {m.userName} {t('operations.entered')} {m.enteredQuantity} {m.enteredUnit}
                {m.orderNumber ? t('operations.sourceOrder', { number: m.orderNumber }) : ''}
              </p>
            </article>
          ))}
          {!movements.length && !stale ? (
            <Empty
              title={t('operations.noStockMovementsYet')}
              text={t('operations.openingStockAdjustmentsWasteAndCompletedSalesWillAppearHere')}
            />
          ) : null}
        </div>
      ) : null}
      {!['Items', 'Warehouses'].includes(view) ? (
        <div className="flex items-center gap-3">
          <Button variant="outline" disabled={page === 1 || busy} onClick={() => setPage(page - 1)}>
            {t('operations.previousInventoryPage')}
          </Button>
          <span className="text-sm">{page}</span>
          <Button variant="outline" disabled={!more || busy} onClick={() => setPage(page + 1)}>
            {t('operations.nextInventoryPage')}
          </Button>
        </div>
      ) : null}
      {dialogOpen ? (
        <dialog
          className="riza-dialog inventory-dialog"
          aria-label={t('operations.inventoryEditor')}
          ref={(node) => {
            if (node && !node.open) node.showModal();
          }}
          onCancel={(e) => {
            if (busy) e.preventDefault();
          }}
          onClose={close}
        >
          <div className="mb-5 flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">
              {movementKind === 'WASTE'
                ? t('operations.recordWaste')
                : movementKind
                  ? t('operations.adjustStock')
                  : threshold
                    ? t('operations.lowStockAlert')
                    : recipe
                      ? t('operations.recipePerProduct')
                      : recipeHistory
                        ? t('operations.recipeVersions')
                        : editor
                          ? t('operations.editDetails')
                          : view === 'Items'
                            ? t('operations.addInventoryItem')
                            : t('operations.addWarehouse')}
            </h2>
            <Button variant="outline" disabled={busy} onClick={close}>
              {t('operations.close')}
            </Button>
          </div>
          {error ? (
            <p role="alert" className="mb-4 text-destructive">
              {serverMessage(error, locale)}
            </p>
          ) : null}
          {movementKind ? (
            <form
              onSubmit={(e) => {
                const f = data(e);
                submit('movements', { ...f, kind: movementKind });
              }}
            >
              <fieldset disabled={locked} className="space-y-4">
                <Field label={t('operations.warehouse')}>
                  {selectWarehouse('warehouseId', movementWarehouse, setMovementWarehouse)}
                </Field>
                <Field label={t('operations.inventoryItem')}>
                  {selectItem('itemId', selectedItem, setSelectedItem)}
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={movementKind === 'WASTE' ? t('operations.quantityWasted') : t('operations.quantityChange')}>
                    <Input
                      name="quantity"
                      required
                      inputMode="decimal"
                      placeholder={movementKind === 'WASTE' ? '0.250' : t('operations.5Or0250')}
                    />
                  </Field>
                  <Field key={selectedItem} label={t('operations.quantityUnit')}>
                    {selectUnit(items.find((i) => i.id === selectedItem)?.unitCode ?? 'kg')}
                  </Field>
                </div>
                <p className="text-xs text-muted-foreground">
                  {movementKind === 'WASTE'
                    ? t('operations.enterAPositiveQuantityWasteWillReduceRecordedStock')
                    : t('operations.useAPositiveQuantityToAddStockOrANegativeQuantityToRemoveItThisIsAChangeNotAReplacementBalance')}
                </p>
                <Field label={t('operations.reason')}>
                  <Input
                    name="reason"
                    required
                    maxLength={500}
                    placeholder={t('operations.openingStockCountCorrectionSpoiledIngredient')}
                  />
                </Field>
                <Button type="submit" className="w-full">
                  {movementKind === 'WASTE' ? t('operations.saveWaste') : t('operations.saveAdjustment')}
                </Button>
              </fieldset>
            </form>
          ) : null}
          {(creating || editor) && !recipe ? (
            <form
              onSubmit={(e) => {
                const f = data(e);
                if (editor)
                  submit(
                    `${view === 'Items' ? 'items' : 'warehouses'}/${editor.id}`,
                    { ...f, version: editor.version, active: f.active === 'on' },
                    'PUT',
                  );
                else submit(view === 'Items' ? 'items' : 'warehouses', f);
              }}
            >
              <fieldset disabled={locked} className="space-y-4">
                <Field label={t('operations.name')}>
                  <Input name="name" required maxLength={160} defaultValue={editor?.name ?? ''} />
                </Field>
                {view === 'Items' ? (
                  !editor ? (
                    <>
                      <Field label="SKU">
                        <Input name="sku" required maxLength={80} />
                      </Field>
                      <Field label={t('operations.itemType')}>
                        <select name="kind">
                          <option value="INGREDIENT">{t('operations.ingredient')}</option>
                          <option value="STOCK_ITEM">{t('operations.otherStockItem')}</option>
                        </select>
                      </Field>
                      <Field label={t('operations.stockUnit')}>{selectUnit('kg')}</Field>
                      <p className="text-xs text-muted-foreground">
                        {t('operations.chooseTheUnitUsedToDisplayThisItemSStockItStaysFixedToProtectHistory')}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {t('operations.skuAndStockUnitAreFixedCreateASeparateItemIfYouNeedADifferentStockIdentity')}
                    </p>
                  )
                ) : (
                  <Field label={t('operations.description')}>
                    <Input
                      name="description"
                      maxLength={1000}
                      defaultValue={editor && 'description' in editor ? editor.description : ''}
                    />
                  </Field>
                )}
                {editor ? (
                  <label className="flex min-h-11 items-center gap-3">
                    <input type="checkbox" name="active" defaultChecked={editor.active} />
                    {t('operations.active')}
                  </label>
                ) : null}
                <Button className="w-full">{t('operations.saveDetails')}</Button>
                {editor ? (
                  <details>
                    <summary className="text-destructive">{t('operations.archiveThisRecord')}</summary>
                    <p className="my-2 text-sm text-muted-foreground">
                      {t('operations.keepsAllHistoryActiveRecipeReferencesMustBeRemovedFirst')}
                    </p>
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() =>
                        submit(
                          `${view === 'Items' ? 'items' : 'warehouses'}/${editor.id}/archive`,
                          { version: editor.version },
                        )
                      }
                    >
                      {t('operations.confirmArchive')}
                    </Button>
                  </details>
                ) : null}
              </fieldset>
            </form>
          ) : null}
          {threshold ? (
            <form
              onSubmit={(e) => {
                const f = data(e);
                submit('thresholds', {
                  ...f,
                  version: threshold === 'new' ? 0 : threshold.version,
                });
              }}
            >
              <fieldset disabled={locked} className="space-y-4">
                {threshold === 'new' ? (
                  <>
                    <Field label={t('operations.warehouse')}>{selectWarehouse('warehouseId', warehouseId)}</Field>
                    <Field label={t('operations.inventoryItem')}>{selectItem('itemId')}</Field>
                  </>
                ) : (
                  <>
                    <input type="hidden" name="warehouseId" value={threshold.warehouseId} />
                    <input type="hidden" name="itemId" value={threshold.itemId} />
                    <p>
                      {threshold.itemName} · {threshold.warehouseName}
                    </p>
                  </>
                )}
                <Field label={t('operations.lowStockThreshold')}>
                  <Input
                    name="lowStockThreshold"
                    required
                    inputMode="decimal"
                    defaultValue={threshold === 'new' ? '0' : threshold.lowStockThreshold}
                  />
                </Field>
                <Field label={t('operations.quantityUnit')}>
                  {selectUnit(threshold === 'new' ? 'kg' : threshold.unitCode)}
                </Field>
                <Button className="w-full">{t('operations.saveLowStockAlert')}</Button>
              </fieldset>
            </form>
          ) : null}
          {recipe ? (
            <form
              onSubmit={(e) => {
                const f = data(e);
                submit('recipes', {
                  ...f,
                  active: f.active === 'on',
                  version: recipe === 'new' ? 0 : recipe.version,
                  items: recipeLines.map(({ key: _key, ...line }) => line),
                });
              }}
            >
              <fieldset disabled={locked} className="space-y-4">
                <Field label={t('operations.product')}>
                  {recipe === 'new' ? (
                    <select required name="productId">
                      <option value="">{t('operations.chooseAProduct')}</option>
                      {products
                        .filter((p) => p.active)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                  ) : (
                    <>
                      <input type="hidden" name="productId" value={recipe.productId} />
                      <span className="block font-semibold">{recipe.productName}</span>
                    </>
                  )}
                </Field>
                <Field label={t('operations.consumptionWarehouse')}>
                  {selectWarehouse('warehouseId', recipe === 'new' ? '' : recipe.warehouseId)}
                </Field>
                <p className="text-sm text-muted-foreground">
                  {t('operations.ingredientQuantitiesForOneProductEachSavePreservesThePreviousRecipeVersion')}
                </p>
                {recipeLines.map((line, index) => (
                  <div key={line.key} className="space-y-3 rounded-lg border p-3">
                    <Field label={t('operations.ingredientNumber', { number: index + 1 })}>
                      <select
                        required
                        aria-label={t('operations.ingredientNumber', { number: index + 1 })}
                        value={line.itemId}
                        onChange={(e) =>
                          setRecipeLines((lines) =>
                            lines.map((l) =>
                              l.key === line.key
                                ? {
                                    ...l,
                                    itemId: e.target.value,
                                    unitCode:
                                      items.find((i) => i.id === e.target.value)?.unitCode ?? 'g',
                                  }
                                : l,
                            ),
                          )
                        }
                      >
                        <option value="">{t('operations.chooseAnIngredient')}</option>
                        {items
                          .filter((i) => i.active)
                          .map((i) => (
                            <option key={i.id} value={i.id}>
                              {i.name}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label={t('operations.recipeQuantityNumber', { number: index + 1 })}>
                        <Input
                          required
                          inputMode="decimal"
                          value={line.quantity}
                          onChange={(e) =>
                            setRecipeLines((lines) =>
                              lines.map((l) =>
                                l.key === line.key ? { ...l, quantity: e.target.value } : l,
                              ),
                            )
                          }
                        />
                      </Field>
                      <Field label={t('operations.recipeUnitNumber', { number: index + 1 })}>
                        <select
                          value={line.unitCode}
                          onChange={(e) =>
                            setRecipeLines((lines) =>
                              lines.map((l) =>
                                l.key === line.key
                                  ? { ...l, unitCode: e.target.value as InventoryUnitCode }
                                  : l,
                              ),
                            )
                          }
                        >
                          {units.map((u) => (
                            <option key={u} value={u}>{u}</option>
                          ))}
                        </select>
                      </Field>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={recipeLines.length <= 1}
                      onClick={() =>
                        setRecipeLines((lines) => lines.filter((l) => l.key !== line.key))
                      }
                    >
                      {t('operations.removeIngredient')} {index + 1}
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  disabled={recipeLines.length >= 100}
                  onClick={() =>
                    setRecipeLines((lines) => [
                      ...lines,
                      { key: crypto.randomUUID(), itemId: '', quantity: '', unitCode: 'g' },
                    ])
                  }
                >
                  {t('operations.addIngredientRow')}
                </Button>
                <label className="flex min-h-11 items-center gap-3">
                  <input
                    type="checkbox"
                    name="active"
                    defaultChecked={recipe === 'new' || recipe.active}
                  />
                  {t('operations.activeRecipe')}
                </label>
                <Button className="w-full">{t('operations.saveRecipe')}</Button>
              </fieldset>
            </form>
          ) : null}
          {recipeHistory ? (
            <div className="space-y-4">
              {recipeHistory.map((r) => (
                <section key={r.version} className="rounded-lg border p-4">
                  <h3 className="font-semibold">
                    {t('operations.version2')} {r.version} · {r.warehouseName}
                  </h3>
                  {r.items.map((i) => (
                    <p key={i.itemId} className="mt-2 text-sm">
                      {i.name}: {qty(i.quantity)} {i.unitCode}
                    </p>
                  ))}
                </section>
              ))}
            </div>
          ) : null}
        </dialog>
      ) : null}
    </div>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="riza-empty rounded-xl border bg-card">
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
