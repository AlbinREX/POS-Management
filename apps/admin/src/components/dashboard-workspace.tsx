'use client';
import { useCallback, useEffect, useState } from 'react';
import type {
  CashReport,
  CompaniesReport,
  DashboardOverview,
  FiscalHandoffRecord,
  FiscalStatusSummary,
  OpsStatus,
  InventoryReport,
  OrdersReport,
  ProductsReport,
  PurchasingReport,
  ReportKind,
  ReportPreset,
  SessionUser,
  StaffReport,
} from '@restaurant/shared-types';
import { Button } from '@restaurant/ui/button';
import { Input } from '@restaurant/ui/input';
import { api, apiBlob, ApiFailure } from '../lib/api';
import { useI18n, serverMessage, formatDateTime, type MessageKey, type Translate } from '../lib/i18n';
import { REPORT_LABEL_KEYS, REPORT_ENUM_KEYS } from '../lib/i18n/report-messages';

type View =
  | 'Overview'
  | 'Orders'
  | 'Products'
  | 'Staff'
  | 'Cash'
  | 'Inventory'
  | 'Purchasing'
  | 'Companies'
  | 'Fiscal';
interface Reports {
  Orders?: OrdersReport;
  Products?: ProductsReport;
  Staff?: StaffReport;
  Cash?: CashReport;
  Inventory?: InventoryReport;
  Purchasing?: PurchasingReport;
  Companies?: CompaniesReport;
}
type Column = { key: string; header: string; numeric?: boolean };
const views: View[] = [
  'Overview',
  'Orders',
  'Products',
  'Staff',
  'Cash',
  'Inventory',
  'Purchasing',
  'Companies',
  'Fiscal',
];
const presets: { key: ReportPreset; label: MessageKey }[] = [
  { key: 'today', label: 'report.today' },
  { key: 'yesterday', label: 'report.yesterday' },
  { key: 'week', label: 'report.thisWeek' },
  { key: 'month', label: 'report.thisMonth' },
  { key: 'custom', label: 'report.custom' },
];
const enumLabel = (v: string, t: Translate) => {
  const key = REPORT_ENUM_KEYS[v as keyof typeof REPORT_ENUM_KEYS];
  return key ? t(key) : v;
};
const today = () => new Date().toISOString().slice(0, 10);
const cell = (v: unknown, t: Translate) =>
  v === null || v === undefined || v === ''
    ? '—'
    : typeof v === 'boolean'
      ? v
        ? t('report.yes')
        : t('report.no')
      : String(v);
const col = (key: string, header: string, numeric = false): Column => ({ key, header, numeric });

// Figures are rendered exactly as the API reports them. Numbers are parsed only to size
// chart bars, never to display or sum a value.
function Bars({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; value: string; count: number }[];
}) {
  const { t } = useI18n();
  const max = Math.max(0, ...rows.map((r) => Number(r.value)));
  if (!rows.some((r) => r.count > 0))
    return <p className="purchase-empty">{t('report.noSettledSalesInThisRange')}</p>;
  return (
    <ol className="report-bars" aria-label={title}>
      {rows.map((r) => (
        <li key={r.label} title={`${r.label}: ${r.value} (${t('report.orderCount', { count: r.count })})`}>
          <span
            className="report-bar"
            style={{
              height: `${max > 0 ? Math.max(2, Math.round((Number(r.value) / max) * 100)) : 2}%`,
            }}
          />
          <span className="report-bar-label">{r.label}</span>
        </li>
      ))}
    </ol>
  );
}
function Table({
  title,
  columns,
  rows,
  empty,
  onRow,
}: {
  title: string;
  columns: Column[];
  rows: readonly object[];
  empty: string;
  onRow?: (row: Record<string, unknown>) => void;
}) {
  const { t, locale } = useI18n();
  if (!rows.length) return <p className="purchase-empty">{empty}</p>;
  const records = rows as Record<string, unknown>[];
  return (
    <div className="report-table-wrap">
      <table className="report-table" aria-label={title}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.numeric ? 'report-num' : ''}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.map((row, i) => (
            <tr
              key={String(row.id ?? row.key ?? i)}
              className={onRow ? 'report-row-link' : ''}
              tabIndex={onRow ? 0 : undefined}
              onClick={onRow ? () => onRow(row) : undefined}
              onKeyDown={onRow ? (e) => (e.key === 'Enter' ? onRow(row) : undefined) : undefined}
            >
              {columns.map((c) => (
                <td key={c.key} className={c.numeric ? 'report-num' : ''}>
                  {['type', 'status', 'contractStatus', 'state', 'kind'].includes(c.key)
                    ? enumLabel(String(row[c.key] ?? '—'), t)
                    : c.key === 'lastError' ? serverMessage(String(row[c.key] ?? '—'), locale)
                    : ['openedAt', 'closedAt', 'settledAt', 'createdAt'].includes(c.key) ? formatDateTime(row[c.key] as string | null, locale) || '—'
                    : cell(row[c.key], t)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function DashboardWorkspace({ user }: { user: SessionUser }) {
  const { t, locale } = useI18n();
  const label = (value: string) => enumLabel(value, t);
  const [view, setView] = useState<View>('Overview');
  const [preset, setPreset] = useState<ReportPreset>('today');
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [applied, setApplied] = useState({ from: today(), to: today() });
  const [page, setPage] = useState(1);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [ops, setOps] = useState<OpsStatus | null>(null);
  const [fiscal, setFiscal] = useState<FiscalStatusSummary | null>(null);
  const [handoffs, setHandoffs] = useState<FiscalHandoffRecord[]>([]);
  const [retrying, setRetrying] = useState('');
  const [reports, setReports] = useState<Reports>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const query =
    preset === 'custom'
      ? `preset=custom&from=${applied.from}&to=${applied.to}`
      : `preset=${preset}`;
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setOverview(await api<DashboardOverview>(`reports/overview?${query}`));
      // Operational status is owner/admin information and is optional: a reader without
      // ops.read simply sees no operations line rather than an error.
      if (user.permissions.includes('ops.read'))
        setOps(await api<OpsStatus>('ops/status').catch(() => null));
      // Fiscal handoff state is operational, not a report, so it loads on its own.
      if (view === 'Fiscal' && user.permissions.includes('fiscal.read')) {
        setFiscal(await api<FiscalStatusSummary>('fiscal/status'));
        setHandoffs(await api<FiscalHandoffRecord[]>('fiscal/handoffs'));
      }
      if (view !== 'Overview' && view !== 'Fiscal') {
        const extra = view === 'Inventory' ? `&page=${page}&limit=25` : '';
        // Fiscal is operational state rather than a report, so it is excluded here.
        const result = await api<Reports[Exclude<View, 'Overview' | 'Fiscal'>]>(
          `reports/${view.toLowerCase()}?${query}${extra}`,
        );
        setReports((r) => ({ ...r, [view]: result }));
      }
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : 'Reports are unavailable. Try again.');
    } finally {
      setLoading(false);
    }
  }, [query, view, page, user.permissions]);
  useEffect(() => {
    void load();
  }, [load]);
  const currency = overview?.currency ?? '';
  const money = (v: string) => `${v} ${currency}`.trim();
  const drillDay = (date: string) => {
    setFrom(date);
    setTo(date);
    setApplied({ from: date, to: date });
    setPreset('custom');
  };
  const open = (next: View) => {
    setPage(1);
    setView(next);
  };
  const exportCsv = async () => {
    const kind: ReportKind = view === 'Overview' ? 'sales' : (view.toLowerCase() as ReportKind);
    setNotice('');
    try {
      const { blob, filename } = await apiBlob(`reports/${kind}/export?${query}`);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(`Exported ${filename}.`);
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : 'The export could not be downloaded.');
    }
  };
  const customValid =
    /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && to >= from;
  const sales = overview?.sales;
  const kpi = (title: string, value: string, target?: View, hint?: string) => (
    <button
      type="button"
      key={title}
      className="report-kpi"
      aria-label={`${title}: ${value}`}
      onClick={target ? () => open(target) : undefined}
      disabled={!target}
    >
      <span>{title}</span>
      <strong>{value}</strong>
      {hint ? <small>{hint}</small> : null}
    </button>
  );
  const orders = reports.Orders,
    products = reports.Products,
    staff = reports.Staff,
    cash = reports.Cash,
    inventory = reports.Inventory,
    purchasing = reports.Purchasing,
    companies = reports.Companies;
  return (
    <section className="report-workspace" aria-label={t('report.ownerDashboard')}>
      <div role="group" aria-label={t('report.reportRange')} className="purchase-filters">
        {presets.map((p) => (
          <Button
            key={p.key}
            type="button"
            variant={preset === p.key ? 'default' : 'outline'}
            onClick={() => {
              setPage(1);
              setPreset(p.key);
            }}
          >
            {t(p.label)}
          </Button>
        ))}
        {preset === 'custom' ? (
          <>
            <label>{t('report.from')}<Input
                type="date"
                aria-label={t('report.fromDate')}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label>{t('report.to')}<Input
                type="date"
                aria-label={t('report.toDate')}
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
            <Button
              type="button"
              disabled={!customValid || loading}
              onClick={() => {
                setPage(1);
                setApplied({ from, to });
              }}
            >{t('report.apply')}</Button>
          </>
        ) : null}
        <Button type="button" variant="outline" disabled={loading} onClick={() => void load()}>{t('report.refresh')}</Button>
        <Button
          type="button"
          variant="outline"
          disabled={loading || !overview}
          onClick={() => void exportCsv()}
        >{t('report.exportCsv')}</Button>
      </div>
      <p className="report-range">
        {overview
          ? `${overview.branchName} · ${overview.range.fromDate} → ${overview.range.toDate} · ${overview.timezone}`
          : user.branchName}
      </p>
      {error ? (
        <p className="purchase-notice" role="alert">
          {serverMessage(error, locale)}
        </p>
      ) : null}
      {notice ? <p className="purchase-notice">{serverMessage(notice, locale)}</p> : null}
      {loading ? (
        <p role="status" aria-busy="true" className="report-loading">{t('report.loadingReports')}</p>
      ) : null}
      {sales && overview ? (
        <div className="report-kpis">
          {ops ? (
            <button
              type="button"
              className="report-kpi"
              data-ops={ops.severity}
              aria-label={`${t('report.operations')}: ${serverMessage(ops.severity === 'ok' ? 'Healthy' : ops.severity, locale)}`}
              disabled
            >
              <span>{t('report.operations')}</span>
              <strong>{serverMessage(ops.severity === 'ok' ? 'Healthy' : ops.severity, locale)}</strong>
              <small>
                {ops.checks
                  .filter((c) => c.severity !== 'ok')
                  .map((c) => serverMessage(c.summary, locale))
                  .join(' ') || t('report.databaseBackupSyncAndStorageAreHealthy')}
              </small>
            </button>
          ) : null}
          {kpi(
            t('report.sales'),
            money(sales.salesAfterDiscount),
            'Orders',
            t('report.settledCount', { count: sales.orderCount }),
          )}
          {kpi(t('report.netSalesExTax'), money(sales.netSales), 'Orders', t('report.taxHint', { amount: money(sales.tax) }))}
          {kpi(t('report.averageOrder'), money(sales.averageOrderValue), 'Orders')}
          {kpi(t('report.discounts'), money(sales.discounts), 'Orders', t('report.grossHint', { amount: money(sales.grossSales) }))}
          {kpi(
            t('report.refunds'),
            money(sales.refunds),
            'Cash',
            t('report.cancelledHint', { amount: money(sales.cancellations) }),
          )}
          {kpi(
            t('report.netReceipts'),
            money(sales.netReceipts),
            'Cash',
            t('report.collectedHint', { amount: money(sales.collected) }),
          )}
          {kpi(t('report.dineIn'), `${sales.dineIn.count}`, 'Orders', money(sales.dineIn.total))}
          {kpi(t('report.takeaway'), `${sales.takeaway.count}`, 'Orders', money(sales.takeaway.total))}
          {sales.byMethod.map((m) =>
            kpi(
              label(m.method),
              money(m.net),
              'Cash',
              t('report.paymentCount', { count: m.count, amount: m.refunded }),
            ),
          )}
          {kpi(t('report.openShifts'), `${overview.openShifts}`, 'Cash')}
          {kpi(
            t('report.lowStock'),
            `${overview.lowStock}`,
            'Inventory',
            t('report.stockCount', { negative: overview.negativeStock, positions: overview.positions }),
          )}
          {kpi(t('report.companyExposure'), money(overview.companyExposure), 'Companies')}
          {kpi(t('report.supplierOutstanding'), money(overview.supplierOutstanding), 'Purchasing')}
        </div>
      ) : null}
      <div role="group" aria-label={t('report.reportViews')} className="purchase-filters">
        {views.map((item) => (
          <Button
            key={item}
            type="button"
            variant={view === item ? 'default' : 'outline'}
            onClick={() => open(item)}
          >
            {t(REPORT_LABEL_KEYS[item])}
          </Button>
        ))}
      </div>
      <section aria-label={t('report.viewTitle', { view: t(REPORT_LABEL_KEYS[view]) })} className="purchase-detail report-detail">
        {view === 'Overview' ? (
          <>
            <h2>{t('report.overview')}</h2>
            <p className="text-sm text-muted-foreground">{t('report.salesAreRecognizedAtSettlementTimeInTheBranchTimezonePaymentMixIsByTenderTimeAndRefundsAppearOnTheDayTheyWereRecordedSelectACardToOpenItsReport')}</p>
          </>
        ) : null}
        {view === 'Orders' && orders ? (
          <>
            <h2>{t('report.salesByDay')}</h2>
            <Bars
              title={t('report.salesByDay')}
              rows={orders.byDay.map((d) => ({
                label: d.date.slice(5),
                value: d.total,
                count: d.orderCount,
              }))}
            />
            <Table
              title={t('report.dailySales')}
              columns={[
                col('date', t('report.date')),
                col('orderCount', t('report.orders'), true),
                col('grossSales', t('report.gross'), true),
                col('discounts', t('report.discounts'), true),
                col('tax', t('report.tax'), true),
                col('total', t('report.total'), true),
                col('netSales', t('report.netExTax'), true),
              ]}
              rows={orders.byDay}
              empty={t('report.noDaysInRange')}
              onRow={(row) => drillDay(String(row.date))}
            />
            <h2>{t('report.salesByHour')}</h2>
            <Bars
              title={t('report.salesByHour')}
              rows={orders.byHour.map((h) => ({
                label: String(h.hour).padStart(2, '0'),
                value: h.total,
                count: h.orderCount,
              }))}
            />
            <h2>{t('report.ordersByStatusAndType')}</h2>
            <dl className="purchase-totals report-totals">
              {orders.byStatus.map((s) => (
                <div key={s.status}>
                  <dt>{label(s.status)}</dt>
                  <dd>{s.count}</dd>
                </div>
              ))}
              {orders.byType.map((t) => (
                <div key={t.type}>
                  <dt>{label(t.type)}</dt>
                  <dd>
                    {t.count} · {money(t.total)}
                  </dd>
                </div>
              ))}
              <div>
                <dt>{t('report.voidedItems')}</dt>
                <dd>{orders.voidedItems}</dd>
              </div>
            </dl>
            <h2>{t('report.topOrders')}</h2>
            <Table
              title={t('report.topOrders')}
              columns={[
                col('orderNumber', t('report.order')),
                col('type', t('report.type')),
                col('tableName', t('report.table')),
                col('waiterName', t('report.waiter')),
                col('total', t('report.total'), true),
                col('settledAt', t('report.settled')),
              ]}
              rows={orders.topOrders}
              empty={t('report.noSettledOrdersInThisRange')}
            />
            <h2>{t('report.tableUsage')}</h2>
            <Table
              title={t('report.tableUsage')}
              columns={[
                col('tableName', t('report.table')),
                col('orders', t('report.orders'), true),
                col('total', t('report.total'), true),
              ]}
              rows={orders.tableUsage.map((t) => ({ ...t, id: t.tableId }))}
              empty={t('report.noDineInSettlementsInThisRange')}
            />
          </>
        ) : null}
        {view === 'Products' && products ? (
          <>
            <dl className="purchase-totals report-totals">
              <div>
                <dt>{t('report.productsSold')}</dt>
                <dd>{products.productCount}</dd>
              </div>
              <div>
                <dt>{t('report.units')}</dt>
                <dd>{products.quantity}</dd>
              </div>
              <div>
                <dt>{t('report.productSales')}</dt>
                <dd>{money(products.sales)}</dd>
              </div>
            </dl>
            <h2>{t('report.topSellers')}</h2>
            <Table
              title={t('report.topSellers')}
              columns={[
                col('productName', t('report.product')),
                col('categoryName', t('report.category')),
                col('quantity', t('report.qty'), true),
                col('lines', t('report.lines'), true),
                col('sales', t('report.sales'), true),
              ]}
              rows={products.top.map((r) => ({ ...r, id: r.productId + r.productName }))}
              empty={t('report.noProductSalesInThisRange')}
            />
            <h2>{t('report.lowPerformers')}</h2>
            <Table
              title={t('report.lowPerformers')}
              columns={[
                col('productName', t('report.product')),
                col('categoryName', t('report.category')),
                col('quantity', t('report.qty'), true),
                col('sales', t('report.sales'), true),
              ]}
              rows={products.low.map((r) => ({ ...r, id: r.productId + r.productName }))}
              empty={t('report.noProductSalesInThisRange')}
            />
            <h2>{t('report.byCategory')}</h2>
            <Table
              title={t('report.salesByCategory')}
              columns={[
                col('categoryName', t('report.category')),
                col('quantity', t('report.qty'), true),
                col('sales', t('report.sales'), true),
              ]}
              rows={products.byCategory.map((c) => ({ ...c, id: c.categoryName }))}
              empty={t('report.noCategorySalesInThisRange')}
            />
            <h2>{t('report.modifierUsage')}</h2>
            <Table
              title={t('report.modifierUsage')}
              columns={[
                col('groupName', t('report.group')),
                col('name', t('report.modifier')),
                col('lines', t('report.lines'), true),
              ]}
              rows={products.modifiers.map((m) => ({ ...m, id: m.groupName + m.name }))}
              empty={t('report.noModifiersWereSoldInThisRange')}
            />
          </>
        ) : null}
        {view === 'Staff' && staff ? (
          <>
            <h2>{t('report.waiters')}</h2>
            <Table
              title={t('report.waiterSales')}
              columns={[
                col('name', t('report.waiter')),
                col('orders', t('report.orders'), true),
                col('sales', t('report.sales'), true),
                col('averageTicket', t('report.averageTicket'), true),
                col('dineIn', t('report.dineIn'), true),
                col('takeaway', t('report.takeaway'), true),
              ]}
              rows={staff.waiters.map((w) => ({ ...w, id: w.userId ?? 'unassigned' }))}
              empty={t('report.noSettledOrdersInThisRange')}
            />
            <h2>{t('report.cashiers')}</h2>
            <Table
              title={t('report.cashierSettlements')}
              columns={[
                col('name', t('report.cashier')),
                col('orders', t('report.settlements'), true),
                col('sales', t('report.settled'), true),
                col('averageTicket', t('report.average'), true),
              ]}
              rows={staff.cashiers.map((c) => ({ ...c, id: c.userId ?? 'unknown' }))}
              empty={t('report.noSettlementsInThisRange')}
            />
            <p className="text-sm text-muted-foreground">{t('report.onlyFiguresTheLedgerRecordsAreShownOrdersAttributedToAWaiterAndSettlementsPerformedByACashier')}</p>
          </>
        ) : null}
        {view === 'Cash' && cash ? (
          <>
            <h2>{t('report.paymentsByMethod')}</h2>
            <Table
              title={t('report.paymentsByMethod')}
              columns={[
                col('method', t('report.method')),
                col('count', t('report.payments'), true),
                col('collected', t('report.collected'), true),
                col('cancelled', t('report.cancelled'), true),
                col('refunded', t('report.refunded'), true),
                col('net', t('report.net'), true),
              ]}
              rows={cash.byMethod.map((m) => ({ ...m, id: m.method, method: label(m.method) }))}
              empty={t('report.noPaymentsInThisRange')}
            />
            <dl className="purchase-totals report-totals">
              <div>
                <dt>{t('report.shifts')}</dt>
                <dd>
                  {cash.totals.shifts} · {cash.totals.openShifts}{t('report.open')}</dd>
              </div>
              <div>
                <dt>{t('report.openingFloat')}</dt>
                <dd>{money(cash.totals.openingFloat)}</dd>
              </div>
              <div>
                <dt>{t('report.cashInOut')}</dt>
                <dd>
                  {cash.totals.cashIn} / {cash.totals.cashOut}
                </dd>
              </div>
              <div>
                <dt>{t('report.expected')}</dt>
                <dd>{money(cash.totals.expected)}</dd>
              </div>
              <div>
                <dt>{t('report.counted')}</dt>
                <dd>{money(cash.totals.counted)}</dd>
              </div>
              <div>
                <dt>{t('report.discrepancies')}</dt>
                <dd>
                  {cash.totals.discrepancies} · {money(cash.totals.difference)}
                </dd>
              </div>
            </dl>
            <h2>{t('report.shifts')}</h2>
            <Table
              title={t('report.cashShifts')}
              columns={[
                col('cashierName', t('report.cashier')),
                col('terminalName', t('report.terminal')),
                col('status', t('report.status')),
                col('openedAt', t('report.opened')),
                col('closedAt', t('report.closed')),
                col('openingAmount', t('report.opening'), true),
                col('cashIn', t('report.cashIn'), true),
                col('cashOut', t('report.cashOut'), true),
                col('cashPayments', t('report.cashSales'), true),
                col('cashReversals', t('report.reversals'), true),
                col('expectedAmount', t('report.expected'), true),
                col('closingAmount', t('report.counted'), true),
                col('difference', t('report.difference'), true),
                col('closingReason', t('report.reason')),
              ]}
              rows={cash.shifts}
              empty={t('report.noCashShiftsOverlapThisRange')}
            />
          </>
        ) : null}
        {view === 'Inventory' && inventory ? (
          <>
            <dl className="purchase-totals report-totals">
              <div>
                <dt>{t('report.positions')}</dt>
                <dd>{inventory.positions}</dd>
              </div>
              <div>
                <dt>{t('report.lowStock')}</dt>
                <dd>{inventory.lowStock}</dd>
              </div>
              <div>
                <dt>{t('report.negativeStock')}</dt>
                <dd>{inventory.negativeStock}</dd>
              </div>
              {inventory.movements.map((m) => (
                <div key={m.kind}>
                  <dt>{label(m.kind)}</dt>
                  <dd>{m.count}</dd>
                </div>
              ))}
            </dl>
            <h2>{t('report.currentStock')}</h2>
            <Table
              title={t('report.currentStock')}
              columns={[
                col('itemName', t('report.item')),
                col('sku', t('report.sku')),
                col('warehouseName', t('report.warehouse')),
                col('quantity', t('report.quantity'), true),
                col('unitCode', t('report.unit')),
                col('lowStockThreshold', t('report.alertAt'), true),
                col('lowStock', t('report.low')),
                col('negative', t('report.negative')),
              ]}
              rows={inventory.stock.items.map((r) => ({ ...r, id: r.positionId }))}
              empty={t('report.noStockPositionsMatch')}
            />
            <div className="purchase-filters">
              <Button
                type="button"
                variant="outline"
                disabled={page <= 1 || loading}
                onClick={() => setPage(page - 1)}
              >{t('report.previous')}</Button>
              <span className="text-sm text-muted-foreground">{t('report.page')}{inventory.stock.page}</span>
              <Button
                type="button"
                variant="outline"
                disabled={!inventory.stock.hasMore || loading}
                onClick={() => setPage(page + 1)}
              >{t('report.next')}</Button>
            </div>
            <h2>{t('report.movementsInRange')}</h2>
            <Table
              title={t('report.stockMovementsByItem')}
              columns={[
                col('kind', t('report.kind')),
                col('itemName', t('report.item')),
                col('warehouseName', t('report.warehouse')),
                col('count', t('report.entries'), true),
                col('quantity', t('report.quantity'), true),
                col('unitCode', t('report.unit')),
              ]}
              rows={inventory.byItem.map((m) => ({
                ...m,
                id: m.positionId + m.kind,
                kind: label(m.kind),
              }))}
              empty={t('report.noStockMovementsInThisRange')}
            />
          </>
        ) : null}
        {view === 'Purchasing' && purchasing ? (
          <>
            <dl className="purchase-totals report-totals">
              <div>
                <dt>{t('report.receiptsInRange')}</dt>
                <dd>{purchasing.receiptsInRange}</dd>
              </div>
              <div>
                <dt>{t('report.receivedValue')}</dt>
                <dd>{money(purchasing.receivedInRange)}</dd>
              </div>
              <div>
                <dt>{t('report.paymentsRecordedLedger')}</dt>
                <dd>{money(purchasing.paidInRange)}</dd>
              </div>
              <div>
                <dt>{t('report.outstanding')}</dt>
                <dd>{money(purchasing.outstanding)}</dd>
              </div>
              {purchasing.ordersByStatus.map((o) => (
                <div key={o.status}>
                  <dt>{t('report.po')}{label(o.status)}</dt>
                  <dd>{o.count}</dd>
                </div>
              ))}
            </dl>
            <h2>{t('report.suppliers')}</h2>
            <Table
              title={t('report.supplierBalances')}
              columns={[
                col('supplierName', t('report.supplier')),
                col('receipts', t('report.receipts'), true),
                col('receivedValue', t('report.received'), true),
                col('payments', t('report.paymentsLedger'), true),
                col('outstanding', t('report.outstanding'), true),
                col('receivedInRange', t('report.receivedInRange'), true),
              ]}
              rows={purchasing.suppliers.map((s) => ({ ...s, id: s.supplierId }))}
              empty={t('report.noSuppliersAreConfigured')}
            />
            <h2>{t('report.recentReceipts')}</h2>
            <Table
              title={t('report.recentReceipts')}
              columns={[
                col('supplierName', t('report.supplier')),
                col('reference', t('report.reference')),
                col('invoiceNumber', t('report.invoice')),
                col('total', t('report.total'), true),
                col('outstanding', t('report.outstanding'), true),
                col('createdAt', t('report.received')),
              ]}
              rows={purchasing.recentReceipts}
              empty={t('report.noGoodsWereReceivedInThisRange')}
            />
          </>
        ) : null}
        {view === 'Companies' && companies ? (
          <>
            <dl className="purchase-totals report-totals">
              <div>
                <dt>{t('report.companies')}</dt>
                <dd>{companies.totals.companies}</dd>
              </div>
              <div>
                <dt>{t('report.chargedInRange')}</dt>
                <dd>{money(companies.totals.chargedInRange)}</dd>
              </div>
              <div>
                <dt>{t('report.creditLimits')}</dt>
                <dd>{money(companies.totals.creditLimit)}</dd>
              </div>
              <div>
                <dt>{t('report.available')}</dt>
                <dd>{money(companies.totals.available)}</dd>
              </div>
              <div>
                <dt>{t('report.overdue')}</dt>
                <dd>{money(companies.totals.overdue)}</dd>
              </div>
              <div>
                <dt>{t('report.exposure')}</dt>
                <dd>{money(companies.totals.exposure)}</dd>
              </div>
            </dl>
            <h2>{t('report.accounts')}</h2>
            <Table
              title={t('report.companyAccounts')}
              columns={[
                col('companyName', t('report.company')),
                col('contractStatus', t('report.contract')),
                col('creditLimit', t('report.limit'), true),
                col('charged', t('report.charged'), true),
                col('paid', t('report.paidLedger'), true),
                col('balance', t('report.balance'), true),
                col('available', t('report.available'), true),
                col('chargedInRange', t('report.chargedInRange'), true),
                col('ordersInRange', t('report.orders'), true),
                col('overdue', t('report.overdue'), true),
              ]}
              rows={companies.companies.map((c) => ({ ...c, id: c.companyId }))}
              empty={t('report.noCompanyAccountsAreConfigured')}
            />
            <h2>{t('report.statements')}</h2>
            <Table
              title={t('report.companyStatements')}
              columns={[
                col('companyName', t('report.company')),
                col('number', t('report.statement')),
                col('periodStart', t('report.from')),
                col('periodEnd', t('report.to')),
                col('dueDate', t('report.due')),
                col('closingBalance', t('report.closing'), true),
                col('overdue', t('report.overdue')),
              ]}
              rows={companies.statements}
              empty={t('report.noStatementsWereIssuedInThisRangeAndNoneAreOverdue')}
            />
          </>
        ) : null}
        {view === 'Fiscal' ? (
          <>
            <h2>{t('report.fiscalHandoff')}</h2>
            <p className="fiscal-note">{t('report.fastfoodRizaDoesNotFiscalizeEnternetOperatesTheFiscalDeviceAndFLinkSoftwareThisViewShowsOnlyWhetherAFinalizedSaleHasBeenHandedOffToThemAFailedHandoffNeverChangesAPaidSale')}</p>
            {fiscal?.transportPending ? (
              <p className="purchase-notice">{t('report.noFiscalProviderTransportIsConfiguredSalesRemainRecordedAndUnresolvedHereUntilTheEnternetFLinkIntegrationSpecificationIsSupplied')}</p>
            ) : null}
            <dl className="purchase-totals report-totals">
              <div>
                <dt>{t('report.provider')}</dt>
                <dd>{fiscal?.provider && fiscal.provider !== 'unconfigured' ? fiscal.provider : t('report.notConfigured')}</dd>
              </div>
              <div>
                <dt>{t('report.unresolved')}</dt>
                <dd>{fiscal?.unresolved ?? 0}</dd>
              </div>
              {fiscal
                ? Object.entries(fiscal.counts).map(([state, n]) => (
                    <div key={state}>
                      <dt>{label(state)}</dt>
                      <dd>{n}</dd>
                    </div>
                  ))
                : null}
            </dl>
            <Table
              title={t('report.fiscalHandoffs')}
              columns={[
                col('orderNumber', t('report.order')),
                col('state', t('report.state')),
                col('provider', t('report.provider')),
                col('attempts', t('report.attempts'), true),
                col('total', t('report.total'), true),
                col('settledAt', t('report.settled')),
                col('providerReference', t('report.providerReference')),
                col('lastError', t('report.lastError')),
              ]}
              rows={handoffs.map((h) => ({ ...h, state: label(h.state) }))}
              empty={t('report.noSalesHaveBeenRegisteredForFiscalHandoff')}
            />
            {user.permissions.includes('fiscal.retry') ? (
              <div className="purchase-filters">
                {handoffs
                  .filter((h) => h.state !== 'CONFIRMED' && h.state !== 'SENT')
                  .slice(0, 10)
                  .map((h) => (
                    <Button
                      key={h.id}
                      type="button"
                      variant="outline"
                      disabled={retrying === h.orderId}
                      onClick={() => {
                        setRetrying(h.orderId);
                        void api(`fiscal/orders/${h.orderId}/retry`, 'POST', {})
                          .catch(() => undefined)
                          .finally(() => {
                            setRetrying('');
                            void load();
                          });
                      }}
                    >{t('report.retryOrder')}{h.orderNumber}
                    </Button>
                  ))}
              </div>
            ) : null}
          </>
        ) : null}
        {view !== 'Overview' && view !== 'Fiscal' && !reports[view] && !loading && !error ? (
          <p className="purchase-empty">{t('report.noReportData')}</p>
        ) : null}
      </section>
    </section>
  );
}
