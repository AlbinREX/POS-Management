'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { MenuKind, MenuPage, MenuRecord } from '@restaurant/shared-types';
import { menuInputSchema } from '@restaurant/validation';
import { Button } from '@restaurant/ui/button';
import { Input } from '@restaurant/ui/input';
import { Label } from '@restaurant/ui/label';
import { api, ApiFailure } from '../lib/api';
import { serverMessage, useI18n, type MessageKey } from '../lib/i18n';
import { OffersPanel } from './menu-offers';
import { ProductsPanel } from './menu-products';
import { ReorderList } from './menu-shared';

type GenericKind = Exclude<MenuKind, 'products'>;
type View = MenuKind | 'offers';
const kinds = {
  categories: 'catalog.categories',
  'modifier-groups': 'catalog.modifierGroups',
  modifiers: 'catalog.modifiers',
  'kitchen-stations': 'catalog.kitchenStations',
} as const;
const addLabels = {
  categories: 'catalog.addCategory',
  'modifier-groups': 'catalog.addGroup',
  modifiers: 'catalog.addModifier',
  'kitchen-stations': 'catalog.addStation',
} as const;
// Products, categories and offers are the day-to-day menu work; the rest is set-up.
const primary: [View, MessageKey][] = [
  ['products', 'catalog.products'],
  ['categories', 'catalog.categories'],
  ['offers', 'catalog.offers'],
];
const secondary: [View, MessageKey][] = [
  ['modifier-groups', 'catalog.modifierGroups'],
  ['modifiers', 'catalog.modifiers'],
  ['kitchen-stations', 'catalog.kitchenStations'],
];
const selectClass = 'min-h-11 w-full rounded-md border bg-background px-3 text-sm';
const message = (error: unknown) =>
  error instanceof ApiFailure ? error.message : 'Cannot reach the local server. Try again.';
async function references(kind: MenuKind) {
  const rows: MenuRecord[] = [];
  for (let page = 1; ; page++) {
    const result = await api<MenuPage>(`menu/${kind}?limit=100&page=${page}`);
    rows.push(...result.items);
    if (!result.hasMore) return rows;
  }
}

export function MenuCatalog({ canManage }: { canManage: boolean }) {
  const { t } = useI18n();
  const [view, setView] = useState<View>('products');
  const tab = ([value, label]: [View, MessageKey]) => (
    <Button
      key={value}
      variant={view === value ? 'secondary' : 'outline'}
      aria-current={view === value ? 'page' : undefined}
      onClick={() => setView(value)}
    >
      {t(label)}
    </Button>
  );
  return (
    <section className="space-y-5">
      <nav aria-label={t('catalog.navigation')} className="menu-tabs">
        <div className="flex flex-wrap gap-2">{primary.map(tab)}</div>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('catalog.moreCatalog')}>
          {secondary.map(tab)}
        </div>
      </nav>
      {view === 'products' ? (
        <ProductsPanel canManage={canManage} />
      ) : view === 'offers' ? (
        <OffersPanel canManage={canManage} />
      ) : (
        <GenericCatalog key={view} kind={view} canManage={canManage} />
      )}
    </section>
  );
}

/** Categories, modifier groups, modifiers and kitchen stations share one list and editor. */
function GenericCatalog({ kind, canManage }: { kind: GenericKind; canManage: boolean }) {
  const { t, locale } = useI18n();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<MenuPage>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<MenuRecord | 'new' | null>(null);
  const [notice, setNotice] = useState('');
  const [reordering, setReordering] = useState(false);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    api<MenuPage>(
      `menu/${kind}?page=${page}&search=${encodeURIComponent(search)}&archived=${archived}`,
    )
      .then((data) => {
        if (current) setResult(data);
      })
      .catch((e: unknown) => {
        if (current) setError(message(e));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [kind, page, search, archived, revision]);
  function saved(text: string = t('catalog.saved')) {
    setEditing(null);
    setReordering(false);
    setRevision((v) => v + 1);
    setNotice(text);
  }
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{t(kinds[kind])}</h2>
        <div className="flex flex-wrap gap-2">
          {canManage && !archived && kind === 'categories' ? (
            <Button
              variant="outline"
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
              {t(addLabels[kind])}
            </Button>
          ) : null}
        </div>
      </div>
      <form
        className="flex flex-wrap items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(String(new FormData(e.currentTarget).get('search') ?? ''));
          setPage(1);
        }}
      >
        <Input
          name="search"
          aria-label={t('catalog.searchLabel')}
          placeholder={t('catalog.searchPlaceholder')}
          className="max-w-sm"
          maxLength={160}
          defaultValue={search}
        />
        <Button variant="outline" type="submit">
          {t('catalog.search')}
        </Button>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => {
              setArchived(e.target.checked);
              setPage(1);
              setEditing(null);
              setReordering(false);
            }}
          />
          {t('catalog.showArchived')}
        </label>
        <Button
          variant="ghost"
          type="button"
          onClick={() => {
            setRevision((v) => v + 1);
            setEditing(null);
          }}
        >
          {t('catalog.reload')}
        </Button>
      </form>
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
      {reordering && kind === 'categories' ? (
        <ReorderMenu
          kind={kind}
          onSaved={() => saved(t('catalog.orderSaved'))}
          onCancel={() => setReordering(false)}
        />
      ) : null}
      {editing ? (
        <CatalogEditor
          key={typeof editing === 'string' ? `new-${kind}` : `${editing.id}-${editing.version}`}
          kind={kind}
          row={editing === 'new' ? undefined : editing}
          onSaved={() => saved()}
          onCancel={() => setEditing(null)}
        />
      ) : null}
      {loading ? (
        <p role="status">{t('catalog.loading')}</p>
      ) : !error ? (
        <>
          {!result?.items.length ? (
            <p className="rounded-md border p-6 text-muted-foreground">
              {t('catalog.noResults', { kind: t(kinds[kind]).toLocaleLowerCase(locale) })}
            </p>
          ) : (
            <ul className="divide-y rounded-md border bg-card">
              {result.items.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-4 p-4">
                  <div className="min-w-0 flex-1 break-words">
                    <p className="font-medium">
                      {row.name}{' '}
                      {!row.active ? (
                        <span className="text-sm text-muted-foreground">
                          ({row.deletedAt ? t('common.archived') : t('common.inactive')})
                        </span>
                      ) : null}
                    </p>
                    {row.description ? (
                      <p className="text-sm text-muted-foreground">{row.description}</p>
                    ) : null}
                    {row.priceAdjustment ? (
                      <p className="text-sm">{t('catalog.adjustmentAmount', { amount: row.priceAdjustment })}</p>
                    ) : null}
                    {row.minSelections !== undefined ? (
                      <p className="text-sm">
                        {t('catalog.chooseRange', { min: row.minSelections, max: row.maxSelections ?? 0 })}
                      </p>
                    ) : null}
                  </div>
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
          )}
          <div className="flex items-center gap-4">
            <Button variant="outline" disabled={page === 1} onClick={() => setPage((v) => v - 1)}>
              {t('catalog.previous')}
            </Button>
            <span className="text-sm">{t('catalog.page', { page })}</span>
            <Button
              variant="outline"
              disabled={!result?.hasMore}
              onClick={() => setPage((v) => v + 1)}
            >
              {t('catalog.next')}
            </Button>
          </div>
        </>
      ) : null}
    </section>
  );
}

/** The complete current list is loaded, so a saved order always covers every row. */
function ReorderMenu({
  kind,
  onSaved,
  onCancel,
}: {
  kind: 'categories';
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<MenuRecord[]>();
  const [error, setError] = useState('');
  useEffect(() => {
    references(kind).then(setRows, (e: unknown) => setError(message(e)));
  }, [kind]);
  if (error)
    return (
      <p role="alert" className="text-destructive">
        {serverMessage(error, locale)}
      </p>
    );
  if (!rows) return <p role="status">{t('catalog.loading')}</p>;
  return (
    <ReorderList
      items={[...rows].sort((a, b) => a.sortOrder - b.sortOrder)}
      name={(row) => row.name}
      render={(row) => (row.active ? row.name : `${row.name} (${t('common.inactive')})`)}
      onCancel={onCancel}
      onSave={async (ordered) => {
        await api(`menu/${kind}/reorder`, 'POST', {
          items: ordered.map((row) => ({ id: row.id, version: row.version })),
        });
        onSaved();
      }}
    />
  );
}

function TextField({
  name,
  label,
  value,
  required = false,
  maxLength = 160,
  decimal = false,
  type = 'text',
}: {
  name: string;
  label: string;
  value?: string | number | null;
  required?: boolean;
  maxLength?: number;
  decimal?: boolean;
  type?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={`menu-${name}`}>{label}</Label>
      <Input
        id={`menu-${name}`}
        name={name}
        defaultValue={value ?? ''}
        required={required}
        maxLength={maxLength}
        inputMode={decimal ? 'decimal' : undefined}
        type={type}
      />
    </div>
  );
}
function CatalogEditor({
  kind,
  row,
  onSaved,
  onCancel,
}: {
  kind: GenericKind;
  row?: MenuRecord;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { t, locale } = useI18n();
  const [refs, setRefs] = useState<Partial<Record<MenuKind, MenuRecord[]>>>({});
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  useEffect(() => {
    let current = true;
    const needed: MenuKind[] = kind === 'modifiers' ? ['modifier-groups'] : [];
    Promise.all(needed.map(async (key) => [key, await references(key)] as const))
      .then((values) => {
        if (current) {
          setRefs(Object.fromEntries(values));
          setReady(true);
        }
      })
      .catch((e: unknown) => {
        if (current) setError(message(e));
      });
    return () => {
      current = false;
    };
  }, [kind]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const text = (key: string) => String(form.get(key) ?? '').trim();
    const data = {
      kind,
      name: text('name'),
      description: text('description') || null,
      sortOrder: Number(text('sortOrder')),
      active: form.has('active'),
      ...(kind === 'modifier-groups'
        ? {
            minSelections: Number(text('minSelections')),
            maxSelections: Number(text('maxSelections')),
          }
        : {}),
      ...(kind === 'modifiers'
        ? { groupId: row?.groupId ?? text('groupId'), priceAdjustment: text('priceAdjustment') }
        : {}),
    };
    const parsed = menuInputSchema.safeParse(data);
    if (!parsed.success) {
      setError(
        parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
      );
      return;
    }
    setPending(true);
    setError('');
    try {
      await api(
        `menu/${kind}${row ? `/${row.id}` : ''}`,
        row ? 'PUT' : 'POST',
        row ? { version: row.version, data: parsed.data } : parsed.data,
      );
      onSaved();
    } catch (e) {
      setError(message(e));
    } finally {
      setPending(false);
    }
  }
  async function archive() {
    if (!row) return;
    setPending(true);
    setError('');
    try {
      await api(`menu/${kind}/${row.id}/archive`, 'POST', { version: row.version });
      onSaved();
    } catch (e) {
      setError(message(e));
    } finally {
      setPending(false);
    }
  }
  function select(name: string, label: string, refKind: MenuKind, value?: string) {
    return (
      <div className="space-y-2">
        <Label htmlFor={`menu-${name}`}>{label}</Label>
        <select
          id={`menu-${name}`}
          name={name}
          defaultValue={value ?? ''}
          required
          className={selectClass}
          disabled={name === 'groupId' && !!row}
        >
          <option value="">{t('catalog.selectReference', { label: label.toLocaleLowerCase(locale) })}</option>
          {refs[refKind]?.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
              {item.active ? '' : ` (${t('common.inactive')})`}
            </option>
          ))}
        </select>
      </div>
    );
  }
  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="space-y-5 rounded-lg border bg-card p-5"
      aria-label={t('catalog.editor')}
    >
      <h3 className="text-lg font-semibold">{row ? t('catalog.editNamed', { name: row.name }) : t('catalog.newEntry')}</h3>
      {error ? (
        <p role="alert" className="break-words text-sm text-destructive">
          {serverMessage(error, locale)}
        </p>
      ) : null}
      {!ready ? (
        <p role="status">{t('catalog.loadingOptions')}</p>
      ) : (
        <fieldset disabled={pending} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="name" label={t('catalog.name')} value={row?.name} required />
            <TextField
              name="sortOrder"
              label={t('catalog.sortOrder')}
              value={row?.sortOrder ?? 0}
              type="number"
              required
            />
          </div>
          <TextField
            name="description"
            label={t('catalog.description')}
            value={row?.description}
            maxLength={2000}
          />
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input name="active" type="checkbox" defaultChecked={row?.active ?? true} />
            {t('catalog.active')}
          </label>
          {kind === 'modifier-groups' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                name="minSelections"
                label={t('catalog.minSelections')}
                value={row?.minSelections ?? 0}
                type="number"
                required
              />
              <TextField
                name="maxSelections"
                label={t('catalog.maxSelections')}
                value={row?.maxSelections ?? 1}
                type="number"
                required
              />
            </div>
          ) : null}
          {kind === 'modifiers' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {select('groupId', t('catalog.modifierGroup'), 'modifier-groups', row?.groupId)}
              <TextField
                name="priceAdjustment"
                label={t('catalog.priceAdjustment')}
                value={row?.priceAdjustment ?? '0.00'}
                decimal
                required
              />
            </div>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button type="submit">{pending ? t('catalog.saving') : t('catalog.save')}</Button>
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
      {!ready ? (
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('catalog.cancel')}
        </Button>
      ) : null}
    </form>
  );
}
