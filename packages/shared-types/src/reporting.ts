import type { ContractStatus } from './companies';
import type { InventoryUnitCode } from './inventory';
export const REPORT_KINDS = [
  'sales',
  'orders',
  'products',
  'staff',
  'cash',
  'inventory',
  'purchasing',
  'companies',
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export type ReportPreset = 'today' | 'yesterday' | 'week' | 'month' | 'custom';
/** The resolved branch-local calendar range every report was computed over. */
export interface ReportRange {
  preset: ReportPreset;
  fromDate: string;
  toDate: string;
  timezone: string;
  from: string;
  to: string;
}
export interface ReportPage<T> {
  items: T[];
  hasMore: boolean;
  page: number;
}
/** Tender mix by payment time. Reversal figures are the signed contra amounts. */
export interface MethodMix {
  method: string;
  count: number;
  collected: string;
  cancelled: string;
  refunded: string;
  net: string;
}
export interface SalesSummary {
  range: ReportRange;
  currency: string;
  orderCount: number;
  grossSales: string;
  discounts: string;
  salesAfterDiscount: string;
  tax: string;
  netSales: string;
  averageOrderValue: string;
  collected: string;
  cancellations: string;
  refunds: string;
  netReceipts: string;
  dineIn: { count: number; total: string };
  takeaway: { count: number; total: string };
  byMethod: MethodMix[];
  companyAccount: { count: number; charged: string };
}
export interface DailySalesRow {
  date: string;
  orderCount: number;
  grossSales: string;
  discounts: string;
  tax: string;
  total: string;
  netSales: string;
}
export interface HourlySalesRow {
  hour: number;
  orderCount: number;
  total: string;
}
export interface TopOrderRow {
  id: string;
  orderNumber: string;
  type: string;
  tableName: string | null;
  waiterName: string | null;
  total: string;
  settledAt: string;
}
export interface OrdersReport {
  range: ReportRange;
  currency: string;
  byDay: DailySalesRow[];
  byHour: HourlySalesRow[];
  byStatus: { status: string; count: number }[];
  byType: { type: string; count: number; total: string }[];
  voidedItems: number;
  tableUsage: { tableId: string; tableName: string; orders: number; total: string }[];
  topOrders: TopOrderRow[];
}
export interface ProductSalesRow {
  productId: string;
  productName: string;
  categoryName: string;
  quantity: number;
  lines: number;
  sales: string;
}
export interface ProductsReport {
  range: ReportRange;
  currency: string;
  productCount: number;
  quantity: number;
  sales: string;
  top: ProductSalesRow[];
  low: ProductSalesRow[];
  byCategory: { categoryName: string; quantity: number; sales: string }[];
  modifiers: { groupName: string; name: string; lines: number }[];
}
export interface StaffRow {
  role: 'WAITER' | 'CASHIER';
  userId: string | null;
  name: string;
  orders: number;
  sales: string;
  averageTicket: string;
  dineIn: number;
  takeaway: number;
}
export interface StaffReport {
  range: ReportRange;
  currency: string;
  waiters: StaffRow[];
  cashiers: StaffRow[];
}
export interface CashShiftRow {
  id: string;
  cashierName: string;
  terminalName: string;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  closedAt: string | null;
  openingAmount: string;
  cashIn: string;
  cashOut: string;
  cashPayments: string;
  cashReversals: string;
  expectedAmount: string;
  closingAmount: string | null;
  difference: string | null;
  closingReason: string | null;
}
export interface CashReport {
  range: ReportRange;
  currency: string;
  byMethod: MethodMix[];
  collected: string;
  cancellations: string;
  refunds: string;
  netReceipts: string;
  companyAccountSettled: string;
  shifts: CashShiftRow[];
  totals: {
    shifts: number;
    openShifts: number;
    openingFloat: string;
    cashIn: string;
    cashOut: string;
    cashPayments: string;
    cashReversals: string;
    expected: string;
    counted: string;
    difference: string;
    discrepancies: number;
  };
}
export interface InventoryStockRow {
  positionId: string;
  itemId: string;
  itemName: string;
  sku: string;
  warehouseId: string;
  warehouseName: string;
  unitCode: InventoryUnitCode;
  quantity: string;
  lowStockThreshold: string;
  lowStock: boolean;
  negative: boolean;
}
export interface InventoryMovementRow {
  positionId: string;
  itemName: string;
  warehouseName: string;
  unitCode: InventoryUnitCode;
  kind: string;
  count: number;
  quantity: string;
}
export interface InventoryReport {
  range: ReportRange;
  positions: number;
  lowStock: number;
  negativeStock: number;
  stock: ReportPage<InventoryStockRow>;
  movements: { kind: string; count: number }[];
  byItem: InventoryMovementRow[];
}
export interface SupplierReportRow {
  supplierId: string;
  supplierName: string;
  receipts: number;
  receivedValue: string;
  payments: string;
  outstanding: string;
  receivedInRange: string;
}
export interface PurchasingReport {
  range: ReportRange;
  currency: string;
  suppliers: SupplierReportRow[];
  ordersByStatus: { status: string; count: number }[];
  receiptsInRange: number;
  receivedInRange: string;
  paidInRange: string;
  outstanding: string;
  recentReceipts: {
    id: string;
    supplierName: string;
    reference: string;
    invoiceNumber: string | null;
    total: string;
    outstanding: string;
    createdAt: string;
  }[];
}
export interface CompanyReportRow {
  companyId: string;
  companyName: string;
  contractStatus: ContractStatus | null;
  creditLimit: string;
  charged: string;
  paid: string;
  balance: string;
  available: string;
  chargedInRange: string;
  ordersInRange: number;
  overdue: string;
}
export interface CompaniesReport {
  range: ReportRange;
  currency: string;
  companies: CompanyReportRow[];
  totals: {
    companies: number;
    exposure: string;
    creditLimit: string;
    available: string;
    overdue: string;
    chargedInRange: string;
  };
  statements: {
    id: string;
    companyName: string;
    number: string;
    periodStart: string;
    periodEnd: string;
    dueDate: string;
    closingBalance: string;
    overdue: boolean;
  }[];
}
export interface DashboardOverview {
  range: ReportRange;
  branchName: string;
  currency: string;
  timezone: string;
  sales: SalesSummary;
  positions: number;
  lowStock: number;
  negativeStock: number;
  openShifts: number;
  companyExposure: string;
  supplierOutstanding: string;
}
