'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { MenuRecord, OfferRecord, OfferStatus } from '@restaurant/shared-types';
import { offerInputSchema, offerUnitPrice, type OfferKind } from '@restaurant/validation';
import { Button } from '@restaurant/ui/button';
import { Input } from '@restaurant/ui/input';
import { Label } from '@restaurant/ui/label';
import { api } from '../lib/api';
import { formatDateTime, serverMessage, useI18n, type MessageKey } from '../lib/i18n';
import { Drawer, failure, ImageField, loadAll, selectClass } from './menu-shared';
import { ProductImage } from './riza-ui';

const STATUS_KEYS: Record<OfferStatus, MessageKey> = {
  LIVE: 'catalog.statusLive',
  SCHEDULED: 'catalog.statusScheduled',
  EXPIRED: 'catalog.statusExpired',
  INACTIVE: 'catalog.statusOfferInactive',
  ARCHIVED: 'catalog.statusArchived',
};
// datetime-local works in the browser's local time; the API stores exact instants.
const pad = (n: number) => String(n).padStart(2, '0');
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (value: string) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
};

/** Settings → Menu → Offers. Promotions never rewrite a product's normal price. */
export function OffersPanel({ canManage }: { canManage: boolean }) {
  const { t, locale } = useI18n();
  const [offers, setOffers] = useState<OfferRecord[]>([]);
  const [products, setProducts] = useState<MenuRecord[]>([]);
  const [archived, setArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<OfferRecord | 'new' | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true);
    Promise.all([api<OfferRecord[]>(`offers?archived=${archived}`), loadAll<MenuRecord>('products')])
      .then(([rows, items]) => {
        if (!current) return;
        setOffers(rows);
        setProducts(items);
        setError('');
      })
      .catch((e: unknown) => current && setError(failure(e)))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [archived, revision]);
  const close = useCallback(() => setEditing(null), []);
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{t('catalog.offers')}</h2>
        {canManage && !archived ? (
          <Button
            onClick={() => {
              setEditing('new');
              setNotice('');
            }}
          >
            {t('catalog.addOffer')}
          </Button>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">{t('catalog.offerNoStack')}</p>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
        {t('catalog.showArchived')}
      </label>
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
      {loading ? (
        <p role="status">{t('catalog.loading')}</p>
      ) : !offers.length ? (
        <p className="rounded-md border p-6 text-muted-foreground">{t('catalog.noOffers')}</p>
      ) : (
        <ul className="divide-y rounded-md border bg-card">
          {offers.map((offer) => (
            <li key={offer.id} className="menu-product-row" aria-label={offer.name}>
              <div className="menu-thumbnail">
                <ProductImage
                  name={offer.name}
                  src={offer.imageUrl ?? products.find((p) => p.id === offer.products[0]?.id)?.imageUrl}
                />
              </div>
              <div className="min-w-0 flex-1 break-words">
                <p className="font-medium">
                  {offer.name}{' '}
                  <span className="offer-status" data-status={offer.status}>
                    {t(STATUS_KEYS[offer.status])}
                  </span>
                </p>
                <p className="text-sm text-muted-foreground">
                  {offer.kind === 'PERCENT_OFF'
                    ? t('catalog.offerDiscount', { percent: offer.percentOff ?? '' })
                    : offer.offerPrice}
                  {' · '}
                  {t('catalog.offerWindow', {
                    start: formatDateTime(offer.startsAt, locale),
                    end: formatDateTime(offer.endsAt, locale),
                  })}
                </p>
                <ul className="text-sm">
                  {offer.products.map((p) => (
                    <li key={p.id}>
                      {p.name}: <s>{p.basePrice}</s> <strong>{p.offerPrice}</strong>
                    </li>
                  ))}
                </ul>
              </div>
              {canManage && !offer.deletedAt ? (
                <Button
                  variant="outline"
                  aria-label={t('catalog.editNamed', { name: offer.name })}
                  onClick={() => {
                    setEditing(offer);
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
      {editing ? (
        <OfferEditor
          key={editing === 'new' ? 'new' : `${editing.id}-${editing.version}`}
          row={editing === 'new' ? undefined : editing}
          products={products}
          onSaved={() => {
            setEditing(null);
            setNotice(t('catalog.offerSaved'));
            setRevision((v) => v + 1);
          }}
          onCancel={close}
        />
      ) : null}
    </section>
  );
}

function OfferEditor({
  row,
  products,
  onSaved,
  onCancel,
}: {
  row?: OfferRecord;
  products: MenuRecord[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { t, locale } = useI18n();
  const now = new Date();
  const week = new Date(now.getTime() + 7 * 86400000);
  const [name, setName] = useState(row?.name ?? '');
  const [description, setDescription] = useState(row?.description ?? '');
  const [imageUrl, setImageUrl] = useState<string | null>(row?.imageUrl ?? null);
  const [active, setActive] = useState(row?.active ?? true);
  const [kind, setKind] = useState<OfferKind>(row?.kind ?? 'FIXED_PRICE');
  const [offerPrice, setOfferPrice] = useState(row?.offerPrice ?? '');
  const [percentOff, setPercentOff] = useState(row?.percentOff ?? '');
  const [startsAt, setStartsAt] = useState(toLocalInput(row?.startsAt ?? now.toISOString()));
  const [endsAt, setEndsAt] = useState(toLocalInput(row?.endsAt ?? week.toISOString()));
  const [productIds, setProductIds] = useState<string[]>(row?.products.map((p) => p.id) ?? []);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const selectable = products.filter((p) => !p.deletedAt);
  const value = kind === 'FIXED_PRICE' ? offerPrice.trim() : percentOff.trim();
  const valid = kind === 'FIXED_PRICE' ? /^\d+\.\d{2}$/.test(value) : /^\d{1,2}\.\d{2}$/.test(value) && value !== '0.00';
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = offerInputSchema.safeParse({
      name: name.trim(),
      description: description.trim() || null,
      imageUrl,
      active,
      kind,
      offerPrice: kind === 'FIXED_PRICE' ? offerPrice.trim() : null,
      percentOff: kind === 'PERCENT_OFF' ? percentOff.trim() : null,
      startsAt: fromLocalInput(startsAt),
      endsAt: fromLocalInput(endsAt),
      productIds,
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      return;
    }
    setPending(true);
    setError('');
    try {
      await api(
        `offers${row ? `/${row.id}` : ''}`,
        row ? 'PUT' : 'POST',
        row ? { version: row.version, data: parsed.data } : parsed.data,
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
      await api(`offers/${row.id}/archive`, 'POST', { version: row.version });
      onSaved();
    } catch (e) {
      setError(failure(e));
      setPending(false);
    }
  }
  return (
    <Drawer label={row ? t('catalog.editNamed', { name: row.name }) : t('catalog.newOffer')} onClose={onCancel}>
      <form onSubmit={(e) => void submit(e)} className="space-y-5" aria-label={t('catalog.offerEditor')}>
        <h3 className="text-lg font-semibold">
          {row ? t('catalog.editNamed', { name: row.name }) : t('catalog.newOffer')}
        </h3>
        {error ? (
          <p role="alert" className="break-words text-sm text-destructive">
            {serverMessage(error, locale)}
          </p>
        ) : null}
        <fieldset disabled={pending} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="offer-name">{t('catalog.name')}</Label>
            <Input id="offer-name" value={name} maxLength={160} required onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="offer-description">{t('catalog.description')}</Label>
            <Input id="offer-description" value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="offer-kind">{t('catalog.offerKind')}</Label>
              <select id="offer-kind" className={selectClass} value={kind} onChange={(e) => setKind(e.target.value as OfferKind)}>
                <option value="FIXED_PRICE">{t('catalog.kindFixed')}</option>
                <option value="PERCENT_OFF">{t('catalog.kindPercent')}</option>
              </select>
            </div>
            {kind === 'FIXED_PRICE' ? (
              <div className="space-y-2">
                <Label htmlFor="offer-price">{t('catalog.offerPrice')}</Label>
                <Input id="offer-price" inputMode="decimal" value={offerPrice} required onChange={(e) => setOfferPrice(e.target.value)} />
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="offer-percent">{t('catalog.percentOff')}</Label>
                <Input id="offer-percent" inputMode="decimal" value={percentOff} required onChange={(e) => setPercentOff(e.target.value)} />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="offer-starts">{t('catalog.startsAt')}</Label>
              <Input id="offer-starts" type="datetime-local" value={startsAt} required onChange={(e) => setStartsAt(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="offer-ends">{t('catalog.endsAt')}</Label>
              <Input id="offer-ends" type="datetime-local" value={endsAt} required onChange={(e) => setEndsAt(e.target.value)} />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">{t('catalog.decimalHint')}</p>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            {t('catalog.active')}
          </label>
          <fieldset className="space-y-2 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">{t('catalog.offerProducts')}</legend>
            {selectable.map((p) => {
              const checked = productIds.includes(p.id);
              return (
                <label key={p.id} className="flex min-h-11 flex-wrap items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) =>
                      setProductIds((ids) => (e.target.checked ? [...ids, p.id] : ids.filter((id) => id !== p.id)))
                    }
                  />
                  <span className="min-w-0 flex-1">{p.name}</span>
                  {/* The preview uses the same exact pricing the API charges with. */}
                  {checked && valid && p.sellingPrice ? (
                    <span className="price-tag has-offer">
                      <s aria-label={t('catalog.normalPrice', { price: p.sellingPrice })}>{p.sellingPrice}</s>
                      <strong>
                        {offerUnitPrice(p.sellingPrice, {
                          kind,
                          offerPrice: kind === 'FIXED_PRICE' ? value : null,
                          percentOff: kind === 'PERCENT_OFF' ? value : null,
                        })}
                      </strong>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{p.sellingPrice}</span>
                  )}
                </label>
              );
            })}
          </fieldset>
          <ImageField label={t('catalog.offerImage')} name={name} value={imageUrl} onChange={setImageUrl} />
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
      </form>
    </Drawer>
  );
}
