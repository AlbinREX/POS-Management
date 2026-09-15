'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AreaRecord,
  OrderRecord,
  SessionUser,
  TableRecord,
  TableStatus,
} from '@restaurant/shared-types';
import { Button } from '@restaurant/ui/button';
import { api, ApiFailure } from '../lib/api';
import { NavIcon } from './riza-ui';
import { OrdersWorkspace } from './orders-workspace';

// Same vocabulary the floor plan uses, so a waiter and a manager read one language.
const statusLabels: Record<TableStatus, string> = {
  FREE: 'Free',
  RESERVED: 'Reserved',
  DISABLED: 'Disabled',
  OCCUPIED: 'Occupied',
  ORDER_SENT: 'Order sent',
  WAITING_PAYMENT: 'Waiting payment',
};
const colors: Record<TableStatus, string> = {
  FREE: '#193d32',
  RESERVED: '#4a3b20',
  DISABLED: '#2b2d32',
  OCCUPIED: '#233c56',
  ORDER_SENT: '#3d3157',
  WAITING_PAYMENT: '#503823',
};
const OPEN_STATUSES = ['DRAFT', 'OPEN', 'SENT_TO_KITCHEN', 'PREPARING', 'READY', 'WAITING_PAYMENT'];
type View = 'Tables' | 'Orders' | 'Takeaway';
const message = (e: unknown) =>
  e instanceof ApiFailure
    ? e.message
    : 'Cannot reach the local server. Check your restaurant connection.';
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
/**
 * A table carries no order reference, so the live order for a table is resolved from
 * the branch order list. Only non-terminal orders count, and one live order per table
 * is already enforced by a partial unique index in the database.
 */
export function openOrderForTable(orders: OrderRecord[], tableId: string) {
  return orders.find((o) => o.tableId === tableId && OPEN_STATUSES.includes(o.status)) ?? null;
}

export function WaiterApp({ user }: { user: SessionUser }) {
  const can = (key: SessionUser['permissions'][number]) => user.permissions.includes(key);
  const layoutAccess = can('layout.read');
  const [view, setView] = useState<View>(layoutAccess ? 'Tables' : 'Orders');
  const [areas, setAreas] = useState<AreaRecord[]>([]);
  const [tables, setTables] = useState<TableRecord[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [stale, setStale] = useState(true);
  const cursor = useRef('0');
  const generation = useRef(0);

  // The installed shell is precached; authenticated data never is. Registration is
  // production-only so the development server keeps its own hot-reload transport.
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      /* Installability is an enhancement; service is unaffected when it fails. */
    });
  }, []);

  const reload = useCallback(async () => {
    if (!layoutAccess) return;
    const current = ++generation.current;
    try {
      const [areaRows, tableRows, orderRows] = await Promise.all([
        all<AreaRecord>('layout/areas'),
        all<TableRecord>('layout/tables'),
        api<{ items: OrderRecord[] }>('orders?page=1&limit=100'),
      ]);
      if (current !== generation.current) return;
      setAreas(areaRows.filter((a) => a.active));
      setTables(tableRows.filter((t) => !t.deletedAt));
      setOrders(orderRows.items);
      setStale(false);
      setError('');
    } catch (e) {
      if (current !== generation.current) return;
      setStale(true);
      setError(message(e));
    }
  }, [layoutAccess]);

  // Poll the durable layout change feed rather than refetching the floor blindly.
  useEffect(() => {
    if (!layoutAccess) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cycle = async (initial = false) => {
      try {
        if (initial || stale) await reload();
        else {
          const changes = await api<{ events: unknown[]; cursor: string }>(
            `layout/changes?after=${cursor.current}`,
          );
          if (!active) return;
          cursor.current = changes.cursor;
          // Table status also moves through order commands, so refresh either way.
          await reload();
        }
      } finally {
        if (active) timer = setTimeout(() => void cycle(), 5000);
      }
    };
    void cycle(true);
    const counter = generation;
    return () => {
      active = false;
      clearTimeout(timer);
      counter.current++;
    };
  }, [layoutAccess, reload, stale]);

  const openOrder = (id: string) => {
    setSelected(id);
    setView('Orders');
  };
  const views: View[] = [...(layoutAccess ? (['Tables'] as View[]) : []), 'Orders', 'Takeaway'];

  return (
    <div className="waiter-shell">
      {error ? <p className="waiter-notice">{error}</p> : null}
      {notice ? <p className="waiter-notice">{notice}</p> : null}
      {view === 'Tables' ? (
        <section aria-label="Restaurant tables" className="waiter-areas">
          <div className="waiter-header">
            <h2>Tables</h2>
            <Button type="button" variant="outline" onClick={() => void reload()}>
              Refresh
            </Button>
          </div>
          {areas.length ? (
            areas.map((area) => {
              const areaTables = tables
                .filter((t) => t.areaId === area.id)
                .sort((a, b) => a.number - b.number);
              return (
                <div key={area.id} className="waiter-area">
                  <h2>{area.name}</h2>
                  {areaTables.length ? (
                    <div className="waiter-table-grid">
                      {areaTables.map((table) => {
                        const live = openOrderForTable(orders, table.id);
                        return (
                          <button
                            key={table.id}
                            type="button"
                            className="waiter-table"
                            data-busy={live ? 'true' : 'false'}
                            style={{ background: colors[table.status] }}
                            disabled={table.status === 'DISABLED'}
                            aria-label={`Table ${table.name}, ${statusLabels[table.status]}`}
                            onClick={() => {
                              if (live) openOrder(live.id);
                              else {
                                setSelected('');
                                setNotice(
                                  `Start a dine-in order for ${table.name} from the Orders tab.`,
                                );
                                setView('Orders');
                              }
                            }}
                          >
                            <strong>{table.name}</strong>
                            <span>{statusLabels[table.status]}</span>
                            <span>
                              {live
                                ? `Order ${live.orderNumber} · ${live.total}`
                                : `Seats ${table.capacity}`}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="waiter-notice">No tables in this area.</p>
                  )}
                </div>
              );
            })
          ) : (
            <p className="waiter-notice">
              {stale ? 'Loading the floor plan…' : 'No areas are configured for this branch.'}
            </p>
          )}
        </section>
      ) : null}
      {view === 'Orders' || view === 'Takeaway' ? (
        <section aria-label={view === 'Takeaway' ? 'Takeaway ordering' : 'Table ordering'}>
          <OrdersWorkspace
            key={view}
            user={user}
            view="pos"
            initialOrderId={view === 'Orders' ? selected : ''}
            onPayment={() =>
              setNotice('Payment requested. The cashier collects this bill in Payments.')
            }
          />
        </section>
      ) : null}
      <nav aria-label="Waiter views" className="waiter-tabs">
        {views.map((item) => (
          <button
            key={item}
            type="button"
            aria-current={view === item}
            onClick={() => {
              setNotice('');
              setView(item);
            }}
          >
            <NavIcon name={item === 'Tables' ? 'Layout' : item === 'Orders' ? 'Orders' : 'POS'} />
            {item}
          </button>
        ))}
      </nav>
    </div>
  );
}
