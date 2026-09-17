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
const presets: { key: ReportPreset; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'custom', label: 'Custom' },
];
const label = (v: string) => v.toLowerCase().replaceAll('_', ' ');
const today = () => new Date().toISOString().slice(0, 10);
const cell = (v: unknown) =>
  v === null || v === undefined || v === ''
    ? '—'
    : typeof v === 'boolean'
      ? v
        ? 'Yes'
        : 'No'
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
  const max = Math.max(0, ...rows.map((r) => Number(r.value)));
  if (!rows.some((r) => r.count > 0))
    return <p className="purchase-empty">No settled sales in this range.</p>;
  return (
    <ol className="report-bars" aria-label={title}>
      {rows.map((r) => (
        <li key={r.label} title={`${r.label}: ${r.value} (${r.count} orders)`}>
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
                  {cell(row[c.key])}
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
    <section className="report-workspace" aria-label="Owner dashboard">
      <div role="group" aria-label="Report range" className="purchase-filters">
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
            {p.label}
          </Button>
        ))}
        {preset === 'custom' ? (
          <>
            <label>
              From
              <Input
                type="date"
                aria-label="From date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label>
              To
              <Input
                type="date"
                aria-label="To date"
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
            >
              Apply
            </Button>
          </>
        ) : null}
        <Button type="button" variant="outline" disabled={loading} onClick={() => void load()}>
          Refresh
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={loading || !overview}
          onClick={() => void exportCsv()}
        >
          Export CSV
        </Button>
      </div>
      <p className="report-range">
        {overview
          ? `${overview.branchName} · ${overview.range.fromDate} → ${overview.range.toDate} · ${overview.timezone}`
          : user.branchName}
      </p>
      {error ? (
        <p className="purchase-notice" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? <p className="purchase-notice">{notice}</p> : null}
      {loading ? (
        <p role="status" aria-busy="true" className="report-loading">
          Loading reports…
        </p>
      ) : null}
      {sales && overview ? (
        <div className="report-kpis">
          {ops ? (
            <button
              type="button"
              className="report-kpi"
              data-ops={ops.severity}
              aria-label={`Operations: ${ops.severity}`}
              disabled
            >
              <span>Operations</span>
              <strong>{ops.severity === 'ok' ? 'Healthy' : ops.severity}</strong>
              <small>
                {ops.checks
                  .filter((c) => c.severity !== 'ok')
                  .map((c) => c.summary)
                  .join(' ') || 'Database, backup, sync and storage are healthy.'}
              </small>
            </button>
          ) : null}
          {kpi(
            'Sales',
            money(sales.salesAfterDiscount),
            'Orders',
            `${sales.orderCount} settled orders`,
          )}
          {kpi('Net sales ex-tax', money(sales.netSales), 'Orders', `tax ${money(sales.tax)}`)}
          {kpi('Average order', money(sales.averageOrderValue), 'Orders')}
          {kpi('Discounts', money(sales.discounts), 'Orders', `gross ${money(sales.grossSales)}`)}
          {kpi(
            'Refunds',
            money(sales.refunds),
            'Cash',
            `cancellations ${money(sales.cancellations)}`,
          )}
          {kpi(
            'Net receipts',
            money(sales.netReceipts),
            'Cash',
            `collected ${money(sales.collected)}`,
          )}
          {kpi('Dine-in', `${sales.dineIn.count}`, 'Orders', money(sales.dineIn.total))}
          {kpi('Takeaway', `${sales.takeaway.count}`, 'Orders', money(sales.takeaway.total))}
          {sales.byMethod.map((m) =>
            kpi(
              label(m.method),
              money(m.net),
              'Cash',
              `${m.count} payments · refunded ${m.refunded}`,
            ),
          )}
          {kpi('Open shifts', `${overview.openShifts}`, 'Cash')}
          {kpi(
            'Low stock',
            `${overview.lowStock}`,
            'Inventory',
            `${overview.negativeStock} negative · ${overview.positions} positions`,
          )}
          {kpi('Company exposure', money(overview.companyExposure), 'Companies')}
          {kpi('Supplier outstanding', money(overview.supplierOutstanding), 'Purchasing')}
        </div>
      ) : null}
      <div role="group" aria-label="Report views" className="purchase-filters">
        {views.map((item) => (
          <Button
            key={item}
            type="button"
            variant={view === item ? 'default' : 'outline'}
            onClick={() => open(item)}
          >
            {item}
          </Button>
        ))}
      </div>
      <section aria-label={`${view} report`} className="purchase-detail report-detail">
        {view === 'Overview' ? (
          <>
            <h2>Overview</h2>
            <p className="text-sm text-muted-foreground">
              Sales are recognized at settlement time in the branch timezone. Payment mix is by
              tender time and refunds appear on the day they were recorded. Select a card to open
              its report.
            </p>
          </>
        ) : null}
        {view === 'Orders' && orders ? (
          <>
            <h2>Sales by day</h2>
            <Bars
              title="Sales by day"
              rows={orders.byDay.map((d) => ({
                label: d.date.slice(5),
                value: d.total,
                count: d.orderCount,
              }))}
            />
            <Table
              title="Daily sales"
              columns={[
                col('date', 'Date'),
                col('orderCount', 'Orders', true),
                col('grossSales', 'Gross', true),
                col('discounts', 'Discounts', true),
                col('tax', 'Tax', true),
                col('total', 'Total', true),
                col('netSales', 'Net ex-tax', true),
              ]}
              rows={orders.byDay}
              empty="No days in range."
              onRow={(row) => drillDay(String(row.date))}
            />
            <h2>Sales by hour</h2>
            <Bars
              title="Sales by hour"
              rows={orders.byHour.map((h) => ({
                label: String(h.hour).padStart(2, '0'),
                value: h.total,
                count: h.orderCount,
              }))}
            />
            <h2>Orders by status and type</h2>
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
                <dt>Voided items</dt>
                <dd>{orders.voidedItems}</dd>
              </div>
            </dl>
            <h2>Top orders</h2>
            <Table
              title="Top orders"
              columns={[
                col('orderNumber', 'Order'),
                col('type', 'Type'),
                col('tableName', 'Table'),
                col('waiterName', 'Waiter'),
                col('total', 'Total', true),
                col('settledAt', 'Settled'),
              ]}
              rows={orders.topOrders}
              empty="No settled orders in this range."
            />
            <h2>Table usage</h2>
            <Table
              title="Table usage"
              columns={[
                col('tableName', 'Table'),
                col('orders', 'Orders', true),
                col('total', 'Total', true),
              ]}
              rows={orders.tableUsage.map((t) => ({ ...t, id: t.tableId }))}
              empty="No dine-in settlements in this range."
            />
          </>
        ) : null}
        {view === 'Products' && products ? (
          <>
            <dl className="purchase-totals report-totals">
              <div>
                <dt>Products sold</dt>
                <dd>{products.productCount}</dd>
              </div>
              <div>
                <dt>Units</dt>
                <dd>{products.quantity}</dd>
              </div>
              <div>
                <dt>Product sales</dt>
                <dd>{money(products.sales)}</dd>
              </div>
            </dl>
            <h2>Top sellers</h2>
            <Table
              title="Top sellers"
              columns={[
                col('productName', 'Product'),
                col('categoryName', 'Category'),
                col('quantity', 'Qty', true),
                col('lines', 'Lines', true),
                col('sales', 'Sales', true),
              ]}
              rows={products.top.map((r) => ({ ...r, id: r.productId + r.productName }))}
              empty="No product sales in this range."
            />
            <h2>Low performers</h2>
            <Table
              title="Low performers"
              columns={[
                col('productName', 'Product'),
                col('categoryName', 'Category'),
                col('quantity', 'Qty', true),
                col('sales', 'Sales', true),
              ]}
              rows={products.low.map((r) => ({ ...r, id: r.productId + r.productName }))}
              empty="No product sales in this range."
            />
            <h2>By category</h2>
            <Table
              title="Sales by category"
              columns={[
                col('categoryName', 'Category'),
                col('quantity', 'Qty', true),
                col('sales', 'Sales', true),
              ]}
              rows={products.byCategory.map((c) => ({ ...c, id: c.categoryName }))}
              empty="No category sales in this range."
            />
            <h2>Modifier usage</h2>
            <Table
              title="Modifier usage"
              columns={[
                col('groupName', 'Group'),
                col('name', 'Modifier'),
                col('lines', 'Lines', true),
              ]}
              rows={products.modifiers.map((m) => ({ ...m, id: m.groupName + m.name }))}
              empty="No modifiers were sold in this range."
            />
          </>
        ) : null}
        {view === 'Staff' && staff ? (
          <>
            <h2>Waiters</h2>
            <Table
              title="Waiter sales"
              columns={[
                col('name', 'Waiter'),
                col('orders', 'Orders', true),
                col('sales', 'Sales', true),
                col('averageTicket', 'Average ticket', true),
                col('dineIn', 'Dine-in', true),
                col('takeaway', 'Takeaway', true),
              ]}
              rows={staff.waiters.map((w) => ({ ...w, id: w.userId ?? 'unassigned' }))}
              empty="No settled orders in this range."
            />
            <h2>Cashiers</h2>
            <Table
              title="Cashier settlements"
              columns={[
                col('name', 'Cashier'),
                col('orders', 'Settlements', true),
                col('sales', 'Settled', true),
                col('averageTicket', 'Average', true),
              ]}
              rows={staff.cashiers.map((c) => ({ ...c, id: c.userId ?? 'unknown' }))}
              empty="No settlements in this range."
            />
            <p className="text-sm text-muted-foreground">
              Only figures the ledger records are shown: orders attributed to a waiter and
              settlements performed by a cashier.
            </p>
          </>
        ) : null}
        {view === 'Cash' && cash ? (
          <>
            <h2>Payments by method</h2>
            <Table
              title="Payments by method"
              columns={[
                col('method', 'Method'),
                col('count', 'Payments', true),
                col('collected', 'Collected', true),
                col('cancelled', 'Cancelled', true),
                col('refunded', 'Refunded', true),
                col('net', 'Net', true),
              ]}
              rows={cash.byMethod.map((m) => ({ ...m, id: m.method, method: label(m.method) }))}
              empty="No payments in this range."
            />
            <dl className="purchase-totals report-totals">
              <div>
                <dt>Shifts</dt>
                <dd>
                  {cash.totals.shifts} · {cash.totals.openShifts} open
                </dd>
              </div>
              <div>
                <dt>Opening float</dt>
                <dd>{money(cash.totals.openingFloat)}</dd>
              </div>
              <div>
                <dt>Cash in / out</dt>
                <dd>
                  {cash.totals.cashIn} / {cash.totals.cashOut}
                </dd>
              </div>
              <div>
                <dt>Expected</dt>
                <dd>{money(cash.totals.expected)}</dd>
              </div>
              <div>
                <dt>Counted</dt>
                <dd>{money(cash.totals.counted)}</dd>
              </div>
              <div>
                <dt>Discrepancies</dt>
                <dd>
                  {cash.totals.discrepancies} · {money(cash.totals.difference)}
                </dd>
              </div>
            </dl>
            <h2>Shifts</h2>
            <Table
              title="Cash shifts"
              columns={[
                col('cashierName', 'Cashier'),
                col('terminalName', 'Terminal'),
                col('status', 'Status'),
                col('openedAt', 'Opened'),
                col('closedAt', 'Closed'),
                col('openingAmount', 'Opening', true),
                col('cashIn', 'Cash in', true),
                col('cashOut', 'Cash out', true),
                col('cashPayments', 'Cash sales', true),
                col('cashReversals', 'Reversals', true),
                col('expectedAmount', 'Expected', true),
                col('closingAmount', 'Counted', true),
                col('difference', 'Difference', true),
                col('closingReason', 'Reason'),
              ]}
              rows={cash.shifts}
              empty="No cash shifts overlap this range."
            />
          </>
        ) : null}
        {view === 'Inventory' && inventory ? (
          <>
            <dl className="purchase-totals report-totals">
              <div>
                <dt>Positions</dt>
                <dd>{inventory.positions}</dd>
              </div>
              <div>
                <dt>Low stock</dt>
                <dd>{inventory.lowStock}</dd>
              </div>
              <div>
                <dt>Negative stock</dt>
                <dd>{inventory.negativeStock}</dd>
              </div>
              {inventory.movements.map((m) => (
                <div key={m.kind}>
                  <dt>{label(m.kind)}</dt>
                  <dd>{m.count}</dd>
                </div>
              ))}
            </dl>
            <h2>Current stock</h2>
            <Table
              title="Current stock"
              columns={[
                col('itemName', 'Item'),
                col('sku', 'SKU'),
                col('warehouseName', 'Warehouse'),
                col('quantity', 'Quantity', true),
                col('unitCode', 'Unit'),
                col('lowStockThreshold', 'Alert at', true),
                col('lowStock', 'Low'),
                col('negative', 'Negative'),
              ]}
              rows={inventory.stock.items.map((r) => ({ ...r, id: r.positionId }))}
              empty="No stock positions match."
            />
            <div className="purchase-filters">
              <Button
                type="button"
                variant="outline"
                disabled={page <= 1 || loading}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">Page {inventory.stock.page}</span>
              <Button
                type="button"
                variant="outline"
                disabled={!inventory.stock.hasMore || loading}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
            <h2>Movements in range</h2>
            <Table
              title="Stock movements by item"
              columns={[
                col('kind', 'Kind'),
                col('itemName', 'Item'),
                col('warehouseName', 'Warehouse'),
                col('count', 'Entries', true),
                col('quantity', 'Quantity', true),
                col('unitCode', 'Unit'),
              ]}
              rows={inventory.byItem.map((m) => ({
                ...m,
                id: m.positionId + m.kind,
                kind: label(m.kind),
              }))}
              empty="No stock movements in this range."
            />
          </>
        ) : null}
        {view === 'Purchasing' && purchasing ? (
          <>
            <dl className="purchase-totals report-totals">
              <div>
                <dt>Receipts in range</dt>
                <dd>{purchasing.receiptsInRange}</dd>
              </div>
              <div>
                <dt>Received value</dt>
                <dd>{money(purchasing.receivedInRange)}</dd>
              </div>
              <div>
                <dt>Payments recorded (ledger)</dt>
                <dd>{money(purchasing.paidInRange)}</dd>
              </div>
              <div>
                <dt>Outstanding</dt>
                <dd>{money(purchasing.outstanding)}</dd>
              </div>
              {purchasing.ordersByStatus.map((o) => (
                <div key={o.status}>
                  <dt>PO {label(o.status)}</dt>
                  <dd>{o.count}</dd>
                </div>
              ))}
            </dl>
            <h2>Suppliers</h2>
            <Table
              title="Supplier balances"
              columns={[
                col('supplierName', 'Supplier'),
                col('receipts', 'Receipts', true),
                col('receivedValue', 'Received', true),
                col('payments', 'Payments (ledger)', true),
                col('outstanding', 'Outstanding', true),
                col('receivedInRange', 'Received in range', true),
              ]}
              rows={purchasing.suppliers.map((s) => ({ ...s, id: s.supplierId }))}
              empty="No suppliers are configured."
            />
            <h2>Recent receipts</h2>
            <Table
              title="Recent receipts"
              columns={[
                col('supplierName', 'Supplier'),
                col('reference', 'Reference'),
                col('invoiceNumber', 'Invoice'),
                col('total', 'Total', true),
                col('outstanding', 'Outstanding', true),
                col('createdAt', 'Received'),
              ]}
              rows={purchasing.recentReceipts}
              empty="No goods were received in this range."
            />
          </>
        ) : null}
        {view === 'Companies' && companies ? (
          <>
            <dl className="purchase-totals report-totals">
              <div>
                <dt>Companies</dt>
                <dd>{companies.totals.companies}</dd>
              </div>
              <div>
                <dt>Charged in range</dt>
                <dd>{money(companies.totals.chargedInRange)}</dd>
              </div>
              <div>
                <dt>Credit limits</dt>
                <dd>{money(companies.totals.creditLimit)}</dd>
              </div>
              <div>
                <dt>Available</dt>
                <dd>{money(companies.totals.available)}</dd>
              </div>
              <div>
                <dt>Overdue</dt>
                <dd>{money(companies.totals.overdue)}</dd>
              </div>
              <div>
                <dt>Exposure</dt>
                <dd>{money(companies.totals.exposure)}</dd>
              </div>
            </dl>
            <h2>Accounts</h2>
            <Table
              title="Company accounts"
              columns={[
                col('companyName', 'Company'),
                col('contractStatus', 'Contract'),
                col('creditLimit', 'Limit', true),
                col('charged', 'Charged', true),
                col('paid', 'Paid (ledger)', true),
                col('balance', 'Balance', true),
                col('available', 'Available', true),
                col('chargedInRange', 'Charged in range', true),
                col('ordersInRange', 'Orders', true),
                col('overdue', 'Overdue', true),
              ]}
              rows={companies.companies.map((c) => ({ ...c, id: c.companyId }))}
              empty="No company accounts are configured."
            />
            <h2>Statements</h2>
            <Table
              title="Company statements"
              columns={[
                col('companyName', 'Company'),
                col('number', 'Statement'),
                col('periodStart', 'From'),
                col('periodEnd', 'To'),
                col('dueDate', 'Due'),
                col('closingBalance', 'Closing', true),
                col('overdue', 'Overdue'),
              ]}
              rows={companies.statements}
              empty="No statements were issued in this range and none are overdue."
            />
          </>
        ) : null}
        {view === 'Fiscal' ? (
          <>
            <h2>Fiscal handoff</h2>
            <p className="fiscal-note">
              FastFood Riza does not fiscalize. EnterNet operates the fiscal device and F-LINK
              software; this view shows only whether a finalized sale has been handed off to them. A
              failed handoff never changes a paid sale.
            </p>
            {fiscal?.transportPending ? (
              <p className="purchase-notice">
                No fiscal provider transport is configured. Sales remain recorded and unresolved
                here until the EnterNet F-LINK integration specification is supplied.
              </p>
            ) : null}
            <dl className="purchase-totals report-totals">
              <div>
                <dt>Provider</dt>
                <dd>{fiscal?.provider ?? 'Not configured'}</dd>
              </div>
              <div>
                <dt>Unresolved</dt>
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
              title="Fiscal handoffs"
              columns={[
                col('orderNumber', 'Order'),
                col('state', 'State'),
                col('provider', 'Provider'),
                col('attempts', 'Attempts', true),
                col('total', 'Total', true),
                col('settledAt', 'Settled'),
                col('providerReference', 'Provider reference'),
                col('lastError', 'Last error'),
              ]}
              rows={handoffs.map((h) => ({ ...h, state: label(h.state) }))}
              empty="No sales have been registered for fiscal handoff."
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
                    >
                      Retry order {h.orderNumber}
                    </Button>
                  ))}
              </div>
            ) : null}
          </>
        ) : null}
        {view !== 'Overview' && view !== 'Fiscal' && !reports[view] && !loading && !error ? (
          <p className="purchase-empty">No report data.</p>
        ) : null}
      </section>
    </section>
  );
}
