'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { MenuKind, MenuMediaUpload, MenuPage, ProductOffer } from '@restaurant/shared-types';
import { Button } from '@restaurant/ui/button';
import { api, apiUpload, ApiFailure } from '../lib/api';
import { MESSAGES, serverMessage, useI18n } from '../lib/i18n';
import { ProductImage } from './riza-ui';

export const selectClass = 'min-h-11 w-full rounded-md border bg-background px-3 text-sm';
/** Raw failure text, kept in English in state and translated where it is shown. */
export const failure = (error: unknown) =>
  error instanceof ApiFailure ? error.message : MESSAGES['session.unreachableRetry'].en;

/** Every page of a menu list. Menus are small, so management filters run locally. */
export async function loadAll<T>(kind: MenuKind, archived = false): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; ; page++) {
    const result = await api<MenuPage>(`menu/${kind}?limit=100&page=${page}&archived=${archived}`);
    rows.push(...(result.items as T[]));
    if (!result.hasMore) return rows;
  }
}

/**
 * A side panel for editing. Nothing inside it reaches the server until its form is
 * explicitly submitted; Escape and Cancel simply close it.
 */
export function Drawer({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    // While the panel is open the page behind it must not scroll: on a touch screen a
    // scroll inside the panel would otherwise move the page, and the next tap would land
    // on a different control than the one under the finger.
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = previous;
    };
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div className="menu-drawer-layer">
      <div className="menu-drawer-backdrop" aria-hidden="true" />
      <aside ref={panel} role="dialog" aria-modal="true" aria-label={label} className="menu-drawer">
        {children}
      </aside>
    </div>
  );
}

/** Normal price, or the normal price struck through beside a highlighted offer price. */
export function PriceTag({
  price,
  offer,
  currency = '',
  badge = true,
}: {
  price: string;
  offer?: ProductOffer | null;
  currency?: string;
  /** POS cards show the OFFER badge on the image instead, keeping the price line short. */
  badge?: boolean;
}) {
  const { t } = useI18n();
  if (!offer)
    return (
      <strong className="price-tag">
        {price} <small>{currency}</small>
      </strong>
    );
  return (
    <span className="price-tag has-offer">
      <s aria-label={t('catalog.normalPrice', { price })}>{price}</s>
      <strong aria-label={t('catalog.offerPriceNow', { price: offer.price })}>
        {offer.price} <small>{currency}</small>
      </strong>
      {badge ? <span className="offer-badge">{t('catalog.badgeOffer')}</span> : null}
    </span>
  );
}

/**
 * Choose, replace or remove an image. Choosing uploads and validates the file at once so
 * the preview is exactly what the server stored, but no product or offer changes until
 * the surrounding form is saved; an abandoned upload is cleaned up by the server later.
 */
export function ImageField({
  label,
  name,
  value,
  onChange,
}: {
  label: string;
  name: string;
  value: string | null;
  onChange: (path: string | null) => void;
}) {
  const { t, locale } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function choose(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      onChange((await apiUpload<MenuMediaUpload>('media/menu', file)).path);
    } catch (e) {
      setError(failure(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }
  return (
    <fieldset className="menu-image-field">
      <legend>{label}</legend>
      <div className="menu-image-preview">
        <ProductImage name={name || label} src={value} />
      </div>
      <div className="menu-image-actions">
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          aria-label={value ? t('catalog.replaceImage') : t('catalog.uploadImage')}
          onChange={(e) => void choose(e.target.files?.[0])}
          disabled={busy}
        />
        <Button type="button" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? t('catalog.uploading') : value ? t('catalog.replaceImage') : t('catalog.uploadImage')}
        </Button>
        {value ? (
          <Button type="button" variant="ghost" disabled={busy} onClick={() => onChange(null)}>
            {t('catalog.removeImage')}
          </Button>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">{t('catalog.imageRules')}</p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {serverMessage(error, locale)}
        </p>
      ) : null}
    </fieldset>
  );
}

/**
 * A staged display order. Rows move by dragging or with the Move up and Move down
 * buttons, which keep reordering available by keyboard and on touch screens; nothing is
 * saved until Save order.
 */
export function ReorderList<T extends { id: string; version: number }>({
  items,
  name,
  render,
  onSave,
  onCancel,
}: {
  items: T[];
  name: (item: T) => string;
  render?: (item: T) => ReactNode;
  onSave: (ordered: T[]) => Promise<void>;
  onCancel: () => void;
}) {
  const { t, locale } = useI18n();
  const [order, setOrder] = useState(items);
  const [dragged, setDragged] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const move = (from: number, to: number) =>
    setOrder((rows) => {
      if (to < 0 || to >= rows.length) return rows;
      const next = [...rows];
      const [row] = next.splice(from, 1);
      next.splice(to, 0, row!);
      return next;
    });
  const changed = order.some((row, index) => row.id !== items[index]?.id);
  return (
    <section className="space-y-3 rounded-lg border bg-card p-4" aria-label={t('catalog.displayOrder')}>
      <p className="text-sm text-muted-foreground">{t('catalog.reorderHint')}</p>
      <ol className="reorder-list">
        {order.map((row, index) => (
          <li
            key={row.id}
            draggable
            data-dragging={dragged === row.id || undefined}
            onDragStart={(event) => {
              setDragged(row.id);
              event.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const from = order.findIndex((item) => item.id === dragged);
              if (from > -1) move(from, index);
              setDragged(null);
            }}
            onDragEnd={() => setDragged(null)}
          >
            <span className="reorder-handle" aria-label={t('catalog.dragHandle', { name: name(row) })}>
              ⠿
            </span>
            <span className="reorder-position">{index + 1}</span>
            <span className="min-w-0 flex-1 break-words">{render ? render(row) : name(row)}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={index === 0 || pending}
              aria-label={t('catalog.moveUp', { name: name(row) })}
              onClick={() => move(index, index - 1)}
            >
              ↑
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={index === order.length - 1 || pending}
              aria-label={t('catalog.moveDown', { name: name(row) })}
              onClick={() => move(index, index + 1)}
            >
              ↓
            </Button>
          </li>
        ))}
      </ol>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {serverMessage(error, locale)}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          disabled={!changed || pending}
          onClick={async () => {
            setPending(true);
            setError('');
            try {
              await onSave(order);
            } catch (e) {
              setError(failure(e));
              setPending(false);
            }
          }}
        >
          {t('catalog.saveOrder')}
        </Button>
        <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
          {t('catalog.cancel')}
        </Button>
      </div>
    </section>
  );
}
