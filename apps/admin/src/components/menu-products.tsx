'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { MenuRecord } from '@restaurant/shared-types';
import { menuInputSchema } from '@restaurant/validation';
import { Button } from '@restaurant/ui/button';
import { Input } from '@restaurant/ui/input';
import { Label } from '@restaurant/ui/label';
import { api } from '../lib/api';
import { serverMessage, useI18n } from '../lib/i18n';
import {
  commitPhoto,
  currentPhoto,
  photoForValidation,
  uploadedPhoto,
  Drawer,
  failure,
  loadAll,
  PhotoField,
  PriceTag,
  ReorderList,
  selectClass,
  type PhotoDraft,
} from './menu-shared';
import { ProductImage } from './riza-ui';

type Status = 'all' | 'active' | 'inactive';
type Stock = 'all' | 'available' | 'soldOut';

/** Settings → Menu → Products: find, edit, photograph and order the products staff sell. */
export function ProductsPanel({ canManage }: { canManage: boolean }) {
  const { t, locale } = useI18n();
  const [products, setProducts] = useState<MenuRecord[]>([]);
  const [categories, setCategories] = useState<MenuRecord[]>([]);
  const [archived, setArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState<Status>('all');
  const [stock, setStock] = useState<Stock>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<MenuRecord | 'new' | null>(null);
  const [reordering, setReordering] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true);
    Promise.all([loadAll<MenuRecord>('products', archived), loadAll<MenuRecord>('categories')])
      .then(([rows, groups]) => {
        if (!current) return;
        setProducts(rows);
        setCategories(groups);
        setError('');
      })
      .catch((e: unknown) => current && setError(failure(e)))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [archived, revision]);
  const categoryName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const shown = products.filter((p) => {
    const text = search.trim().toLocaleLowerCase(locale);
    return (
      (!text ||
        p.name.toLocaleLowerCase(locale).includes(text) ||
        p.sku?.toLocaleLowerCase(locale).includes(text)) &&
      (!category || p.categoryId === category) &&
      (status === 'all' || p.active === (status === 'active')) &&
      (stock === 'all' || Boolean(p.soldOut) === (stock === 'soldOut'))
    );
  });
  const close = useCallback(() => setEditing(null), []);
  function saved(message = t('catalog.saved')) {
    setEditing(null);
    setReordering(false);
    setNotice(message);
    setRevision((v) => v + 1);
  }
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{t('catalog.products')}</h2>
        <div className="flex flex-wrap gap-2">
          {canManage && !archived ? (
            <Button
              variant="outline"
              disabled={!category}
              title={category ? undefined : t('catalog.reorderChooseCategory')}
              onClick={() => {
                setReordering((v) => !v);
                setNotice('');
              }}
            >
              {t('catalog.reorder')}
            </Button>
          ) : null}
          {canManage && !archived ? (
            <Button
              onClick={() => {
                setEditing('new');
                setNotice('');
              }}
            >
              {t('catalog.addProduct')}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="menu-filters">
        <Input
          aria-label={t('catalog.searchLabel')}
          placeholder={t('catalog.searchPlaceholder')}
          value={search}
          maxLength={160}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label={t('catalog.filterCategory')}
          className={selectClass}
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setReordering(false);
          }}
        >
          <option value="">{t('catalog.allCategories')}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          aria-label={t('catalog.filterStatus')}
          className={selectClass}
          value={status}
          onChange={(e) => setStatus(e.target.value as Status)}
        >
          <option value="all">{t('catalog.filterAll')}</option>
          <option value="active">{t('catalog.onlyActive')}</option>
          <option value="inactive">{t('catalog.onlyInactive')}</option>
        </select>
        <select
          aria-label={t('catalog.filterStock')}
          className={selectClass}
          value={stock}
          onChange={(e) => setStock(e.target.value as Stock)}
        >
          <option value="all">{t('catalog.filterAll')}</option>
          <option value="available">{t('catalog.onlyAvailable')}</option>
          <option value="soldOut">{t('catalog.onlySoldOut')}</option>
        </select>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => {
              setArchived(e.target.checked);
              setReordering(false);
              setEditing(null);
            }}
          />
          {t('catalog.showArchived')}
        </label>
      </div>
      {notice ? (
        <p role="status" className="text-sm">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive">
          {serverMessage(error, locale)}
        </p>
      ) : null}
      {reordering && category ? (
        <ReorderList
          items={products
            .filter((p) => p.categoryId === category)
            .sort((a, b) => a.sortOrder - b.sortOrder)}
          name={(p) => p.name}
          onCancel={() => setReordering(false)}
          onSave={async (ordered) => {
            await api('menu/products/reorder', 'POST', {
              categoryId: category,
              items: ordered.map((p) => ({ id: p.id, version: p.version })),
            });
            saved(t('catalog.orderSaved'));
          }}
        />
      ) : null}
      {loading ? (
        <p role="status">{t('catalog.loading')}</p>
      ) : !error ? (
        !shown.length ? (
          <p className="rounded-md border p-6 text-muted-foreground">
            {products.length
              ? t('catalog.noProductsMatch')
              : t('catalog.noResults', { kind: t('catalog.products').toLocaleLowerCase(locale) })}
          </p>
        ) : (
          <ul className="divide-y rounded-md border bg-card">
            {shown.map((row) => (
              <li key={row.id} className="menu-product-row">
                <div className="menu-thumbnail">
                  <ProductImage name={row.name} src={row.imageUrl} />
                </div>
                <div className="min-w-0 flex-1 break-words">
                  <p className="font-medium">
                    {row.name}{' '}
                    {!row.active ? (
                      <span className="text-sm text-muted-foreground">
                        ({row.deletedAt ? t('common.archived') : t('common.inactive')})
                      </span>
                    ) : null}
                    {row.soldOut ? <span className="sold-out-badge">{t('catalog.badgeSoldOut')}</span> : null}
                    {row.featured ? <span className="featured-badge">{t('catalog.badgeFeatured')}</span> : null}
                  </p>
                  {row.description ? (
                    <p className="text-sm text-muted-foreground">{row.description}</p>
                  ) : null}
                  <p className="text-sm">
                    {t('catalog.productSummary', { sku: row.sku ?? '', price: row.sellingPrice ?? '', tax: row.taxRate ?? '' })}{' '}
                    {row.taxMode === 'INCLUSIVE' ? t('catalog.taxIncluded') : t('catalog.taxExcluded')}
                  </p>
                  <p className="text-sm text-muted-foreground">{categoryName.get(row.categoryId ?? '')}</p>
                </div>
                <PriceTag price={row.sellingPrice ?? ''} offer={row.activeOffer} />
                {canManage && !row.deletedAt ? (
                  <Button
                    variant="outline"
                    aria-label={t('catalog.editNamed', { name: row.name })}
                    onClick={() => {
                      setEditing(row);
                      setNotice('');
                    }}
                  >
                    {t('catalog.edit')}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )
      ) : null}
      {editing ? (
        <ProductEditor
          key={editing === 'new' ? 'new' : `${editing.id}-${editing.version}`}
          row={editing === 'new' ? undefined : editing}
          categories={categories}
          onSaved={() => saved()}
          onCancel={close}
        />
      ) : null}
    </section>
  );
}

interface Draft {
  name: string;
  description: string;
  categoryId: string;
  sellingPrice: string;
  taxRate: string;
  taxMode: string;
  sku: string;
  barcode: string;
  sortOrder: string;
  active: boolean;
  soldOut: boolean;
  featured: boolean;
  modifierGroupIds: string[];
  kitchenStationIds: string[];
}

function ProductEditor({
  row,
  categories,
  onSaved,
  onCancel,
}: {
  row?: MenuRecord;
  categories: MenuRecord[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { t, locale } = useI18n();
  const [groups, setGroups] = useState<MenuRecord[]>();
  const [stations, setStations] = useState<MenuRecord[]>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [draft, setDraft] = useState<Draft>({
    name: row?.name ?? '',
    description: row?.description ?? '',
    categoryId: row?.categoryId ?? '',
    sellingPrice: row?.sellingPrice ?? '',
    taxRate: row?.taxRate ?? '',
    taxMode: row?.taxMode ?? '',
    sku: row?.sku ?? '',
    barcode: row?.barcode ?? '',
    sortOrder: String(row?.sortOrder ?? 0),
    active: row?.active ?? true,
    soldOut: row?.soldOut ?? false,
    featured: row?.featured ?? false,
    modifierGroupIds: row?.modifierGroupIds ?? [],
    kitchenStationIds: row?.kitchenStationIds ?? [],
  });
  // The photo is kept apart from the text fields: a chosen file is only uploaded on save.
  const [photo, setPhoto] = useState<PhotoDraft>(currentPhoto(row?.imageUrl));
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const toggle = (key: 'modifierGroupIds' | 'kitchenStationIds', id: string, on: boolean) =>
    setDraft((d) => ({ ...d, [key]: on ? [...d[key], id] : d[key].filter((v) => v !== id) }));
  useEffect(() => {
    let current = true;
    Promise.all([loadAll<MenuRecord>('modifier-groups'), loadAll<MenuRecord>('kitchen-stations')])
      .then(([g, s]) => {
        if (!current) return;
        setGroups(g);
        setStations(s);
      })
      .catch((e: unknown) => current && setError(failure(e)));
    return () => {
      current = false;
    };
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = menuInputSchema.safeParse({
      kind: 'products',
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      sortOrder: Number(draft.sortOrder),
      active: draft.active,
      soldOut: draft.soldOut,
      featured: draft.featured,
      sku: draft.sku.trim(),
      barcode: draft.barcode.trim() || null,
      categoryId: draft.categoryId,
      sellingPrice: draft.sellingPrice.trim(),
      taxRate: draft.taxRate.trim(),
      taxMode: draft.taxMode,
      imageUrl: photoForValidation(photo),
      modifierGroupIds: draft.modifierGroupIds,
      kitchenStationIds: draft.kitchenStationIds,
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      return;
    }
    setPending(true);
    setError('');
    try {
      // Upload first: if it fails nothing is saved and the previous photo stays. The draft
      // stays a selection, remembering the upload, until the save itself succeeds, so a
      // retry never uploads twice and Clear selection still returns to the saved photo.
      const imageUrl = await commitPhoto(photo);
      setPhoto(uploadedPhoto(photo, imageUrl));
      const data = { ...parsed.data, imageUrl };
      await api(
        `menu/products${row ? `/${row.id}` : ''}`,
        row ? 'PUT' : 'POST',
        row ? { version: row.version, data } : data,
      );
      onSaved();
    } catch (e) {
      setError(failure(e));
    } finally {
      setPending(false);
    }
  }
  async function archive() {
    if (!row) return;
    setPending(true);
    try {
      await api(`menu/products/${row.id}/archive`, 'POST', { version: row.version });
      onSaved();
    } catch (e) {
      setError(failure(e));
      setPending(false);
    }
  }
  const field = (key: keyof Draft, label: string, extra: { required?: boolean; decimal?: boolean; maxLength?: number; type?: string } = {}) => (
    <div className="space-y-2">
      <Label htmlFor={`product-${key}`}>{label}</Label>
      <Input
        id={`product-${key}`}
        value={String(draft[key] ?? '')}
        onChange={(e) => set(key, e.target.value as never)}
        required={extra.required}
        maxLength={extra.maxLength ?? 160}
        inputMode={extra.decimal ? 'decimal' : undefined}
        type={extra.type ?? 'text'}
      />
    </div>
  );
  const checklist = (key: 'modifierGroupIds' | 'kitchenStationIds', label: string, rows?: MenuRecord[]) => (
    <fieldset className="space-y-2 rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">{label}</legend>
      {rows?.length ? (
        rows.map((item) => (
          <label key={item.id} className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={draft[key].includes(item.id)}
              onChange={(e) => toggle(key, item.id, e.target.checked)}
            />
            {item.name}
            {item.active ? '' : ` (${t('common.inactive')})`}
          </label>
        ))
      ) : (
        <p className="text-sm text-muted-foreground">
          {t('catalog.configureReference', { label: label.toLocaleLowerCase(locale) })}
        </p>
      )}
    </fieldset>
  );
  const previewPrice = /^\d+\.\d{2}$/.test(draft.sellingPrice.trim()) ? draft.sellingPrice.trim() : '—';
  return (
    <Drawer label={row ? t('catalog.editProduct') : t('catalog.newProduct')} onClose={onCancel} busy={pending}>
      <form onSubmit={(e) => void submit(e)} className="space-y-5" aria-label={t('catalog.editor')}>
        <h3 className="text-lg font-semibold">
          {row ? t('catalog.editNamed', { name: row.name }) : t('catalog.newProduct')}
        </h3>
        {error ? (
          <p role="alert" className="break-words text-sm text-destructive">
            {serverMessage(error, locale)}
          </p>
        ) : null}
        {!groups || !stations ? (
          <p role="status">{t('catalog.loadingOptions')}</p>
        ) : (
          <fieldset disabled={pending} className="space-y-5">
            <PhotoField
              label={t('catalog.productImage')}
              name={draft.name}
              saved={row?.imageUrl ?? null}
              draft={photo}
              onDraft={setPhoto}
            />
            {field('name', t('catalog.name'), { required: true })}
            {field('description', t('catalog.description'), { maxLength: 2000 })}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="product-categoryId">{t('catalog.category')}</Label>
                <select
                  id="product-categoryId"
                  className={selectClass}
                  value={draft.categoryId}
                  required
                  onChange={(e) => set('categoryId', e.target.value)}
                >
                  <option value="">
                    {t('catalog.selectReference', { label: t('catalog.category').toLocaleLowerCase(locale) })}
                  </option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.active ? '' : ` (${t('common.inactive')})`}
                    </option>
                  ))}
                </select>
              </div>
              {field('sellingPrice', t('catalog.sellingPrice'), { required: true, decimal: true })}
              {field('taxRate', t('catalog.taxRate'), { required: true, decimal: true })}
              <div className="space-y-2">
                <Label htmlFor="product-taxMode">{t('catalog.taxMode')}</Label>
                <select
                  id="product-taxMode"
                  className={selectClass}
                  value={draft.taxMode}
                  required
                  onChange={(e) => set('taxMode', e.target.value)}
                >
                  <option value="">{t('catalog.selectTaxMode')}</option>
                  <option value="INCLUSIVE">{t('catalog.taxIncluded')}</option>
                  <option value="EXCLUSIVE">{t('catalog.taxExcluded')}</option>
                </select>
              </div>
              {field('sku', t('catalog.sku'), { required: true, maxLength: 80 })}
              {field('barcode', t('catalog.barcode'), { maxLength: 80 })}
              {field('sortOrder', t('catalog.sortOrder'), { required: true, type: 'number' })}
            </div>
            <p className="text-sm text-muted-foreground">{t('catalog.decimalHint')}</p>
            <div className="menu-toggles">
              <label className="flex min-h-11 items-center gap-3 text-sm">
                <input type="checkbox" checked={draft.active} onChange={(e) => set('active', e.target.checked)} />
                <span>
                  {t('catalog.active')}
                  <small className="block text-muted-foreground">{t('catalog.activeHint')}</small>
                </span>
              </label>
              <label className="flex min-h-11 items-center gap-3 text-sm">
                <input type="checkbox" checked={draft.soldOut} onChange={(e) => set('soldOut', e.target.checked)} />
                <span>
                  {t('catalog.soldOut')}
                  <small className="block text-muted-foreground">{t('catalog.soldOutHint')}</small>
                </span>
              </label>
              <label className="flex min-h-11 items-center gap-3 text-sm">
                <input type="checkbox" checked={draft.featured} onChange={(e) => set('featured', e.target.checked)} />
                <span>
                  {t('catalog.featured')}
                  <small className="block text-muted-foreground">{t('catalog.featuredHint')}</small>
                </span>
              </label>
            </div>
            {checklist('kitchenStationIds', t('catalog.kitchenStations'), stations)}
            {checklist('modifierGroupIds', t('catalog.modifierGroups'), groups)}
            <details className="riza-details">
              <summary>{t('catalog.imageUrl')}</summary>
              <div className="space-y-2 pt-3">
                <Input
                  aria-label={t('catalog.imageUrl')}
                  value={photo.kind === 'current' ? (photo.path ?? '') : ''}
                  maxLength={2048}
                  onChange={(e) => setPhoto(currentPhoto(e.target.value || null))}
                />
                <p className="text-sm text-muted-foreground">{t('catalog.imageHint')}</p>
              </div>
            </details>
            <section className="menu-preview" aria-label={t('catalog.preview')}>
              <h4 className="font-semibold">{t('catalog.preview')}</h4>
              <p className="text-sm text-muted-foreground">{t('catalog.previewHint')}</p>
              <article className={`product-card${draft.soldOut ? ' is-sold-out' : ''}`}>
                <div className="product-select">
                  <ProductImage
                    name={draft.name || '—'}
                    src={photo.kind === 'selected' ? photo.preview : photo.path}
                  />
                  <div className="product-copy">
                    <h3>{draft.name || '—'}</h3>
                    {draft.description ? <p>{draft.description}</p> : null}
                  </div>
                </div>
                <div className="product-footer">
                  <PriceTag price={previewPrice} offer={row?.activeOffer} />
                  {draft.soldOut ? <span className="sold-out-badge">{t('catalog.badgeSoldOut')}</span> : null}
                </div>
              </article>
            </section>
            <div className="flex flex-wrap gap-3">
              <Button type="submit">{pending ? t('catalog.saving') : t('catalog.saveChanges')}</Button>
              <Button type="button" variant="outline" onClick={onCancel}>
                {t('catalog.cancel')}
              </Button>
              {row ? (
                <Button type="button" variant="destructive" onClick={() => setConfirmArchive(true)}>
                  {t('catalog.archive')}
                </Button>
              ) : null}
            </div>
            {confirmArchive ? (
              <div className="space-y-3 rounded-md border p-4">
                <p>{t('catalog.archivePrompt')}</p>
                <Button type="button" variant="destructive" onClick={() => void archive()}>
                  {t('catalog.confirmArchive')}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setConfirmArchive(false)}>
                  {t('catalog.keep')}
                </Button>
              </div>
            ) : null}
          </fieldset>
        )}
        {!groups || !stations ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('catalog.cancel')}
          </Button>
        ) : null}
      </form>
    </Drawer>
  );
}
