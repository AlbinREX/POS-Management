export * from './companies';
export * from './reporting';
export * from './sync';
export * from './ops';
export * from './purchasing';
export * from './inventory';
export const PERMISSIONS = [
  'company.read',
  'company.manage',
  'contract.manage',
  'company.charge',
  'company.payment.record',
  'company.payment.reverse',
  'company.statement.manage',
  'supplier.read',
  'supplier.manage',
  'purchase.read',
  'purchase.manage',
  'purchase.receive',
  'supplier.payment.record',
  'supplier.payment.reverse',
  'inventory.read',
  'inventory.manage',
  'inventory.adjust',
  'inventory.waste',
  'recipe.manage',

  'payment.read',
  'payment.collect',
  'payment.cancel',
  'payment.refund',
  'cash.shift.read',
  'cash.shift.manage',
  'cash.movement.manage',
  'organization.read',
  'branch.read',
  'user.read',
  'user.manage',
  'role.read',
  'role.manage',
  'terminal.read',
  'terminal.manage',
  'audit.read',
  'menu.read',
  'menu.manage',
  'layout.read',
  'layout.manage',
  'layout.status.manage',
  'order.read',
  'order.manage',
  'order.discount',
  'order.cancel',
  'order.assign',
  'order.submit_kitchen',
  'kitchen.read',
  'kitchen.manage',
  'report.read',
  'sync.read',
  'ops.read',
] as const;
export type PermissionKey = (typeof PERMISSIONS)[number];
export const ROLE_NAMES = [
  'OWNER',
  'ADMIN',
  'MANAGER',
  'CASHIER',
  'WAITER',
  'KITCHEN',
  'STOREKEEPER',
] as const;
export type RoleName = (typeof ROLE_NAMES)[number];
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleName, readonly PermissionKey[]> = {
  OWNER: PERMISSIONS,
  ADMIN: [
    'company.read',
    'company.manage',
    'contract.manage',
    'company.charge',
    'company.payment.record',
    'company.payment.reverse',
    'company.statement.manage',
    'supplier.read',
    'supplier.manage',
    'purchase.read',
    'purchase.manage',
    'purchase.receive',
    'supplier.payment.record',
    'supplier.payment.reverse',
    'inventory.read',
    'inventory.manage',
    'inventory.adjust',
    'inventory.waste',
    'recipe.manage',

    'payment.read',
    'payment.collect',
    'payment.cancel',
    'payment.refund',
    'cash.shift.read',
    'cash.shift.manage',
    'cash.movement.manage',
    'order.submit_kitchen',
    'kitchen.read',
    'kitchen.manage',
    'order.read',
    'order.manage',
    'order.discount',
    'order.cancel',
    'order.assign',
    'organization.read',
    'branch.read',
    'user.read',
    'user.manage',
    'role.read',
    'role.manage',
    'terminal.read',
    'terminal.manage',
    'audit.read',
    'menu.read',
    'menu.manage',
    'layout.read',
    'layout.manage',
    'layout.status.manage',
    'report.read',
    'sync.read',
    'ops.read',
  ],
  // Managers may operate manual table statuses but do not redesign the floor plan.
  MANAGER: [
    'company.read',
    'company.manage',
    'contract.manage',
    'company.charge',
    'company.payment.record',
    'company.payment.reverse',
    'company.statement.manage',
    'supplier.read',
    'supplier.manage',
    'purchase.read',
    'purchase.manage',
    'purchase.receive',
    'supplier.payment.record',
    'supplier.payment.reverse',
    'inventory.read',
    'inventory.manage',
    'inventory.adjust',
    'inventory.waste',
    'recipe.manage',

    'payment.read',
    'payment.collect',
    'payment.cancel',
    'payment.refund',
    'cash.shift.read',
    'cash.shift.manage',
    'cash.movement.manage',
    'order.submit_kitchen',
    'kitchen.read',
    'kitchen.manage',
    'order.read',
    'order.manage',
    'order.discount',
    'order.cancel',
    'order.assign',
    'organization.read',
    'branch.read',
    'user.read',
    'role.read',
    'terminal.read',
    'menu.read',
    'layout.read',
    'layout.status.manage',
    'report.read',
    'sync.read',
    'ops.read',
  ],
  CASHIER: [
    'company.read',
    'company.charge',
    'order.read',
    'payment.read',
    'payment.collect',
    'cash.shift.read',
    'cash.shift.manage',
    'cash.movement.manage',
  ],
  WAITER: ['menu.read', 'layout.read', 'order.read', 'order.manage', 'order.submit_kitchen'],
  KITCHEN: ['kitchen.read', 'kitchen.manage'],
  STOREKEEPER: [
    'supplier.read',
    'supplier.manage',
    'purchase.read',
    'purchase.manage',
    'purchase.receive',
    'inventory.read',
    'inventory.manage',
    'inventory.adjust',
    'inventory.waste',
    'recipe.manage',
  ],
};
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  organizationId: string;
  branchId: string;
  branchName: string;
  permissions: PermissionKey[];
}
export interface AuthResult {
  accessToken: string;
  expiresIn: number;
  user: SessionUser;
}
export interface ApiError {
  statusCode: number;
  code: string;
  message: string;
  requestId: string;
}
/** Money must remain decimal text across JSON boundaries. No JS number representation. */
export type DecimalString = string & { readonly __decimalString: unique symbol };

export interface PaymentRecord {
  id: string;
  orderId: string;
  cashierId: string;
  method: 'CASH' | 'CARD' | 'COMPANY_ACCOUNT';
  companyId?: string | null;
  companyEmployeeId?: string | null;
  amount: string;
  tendered: string | null;
  change: string | null;
  shiftId: string | null;
  transactionReference: string | null;
  createdAt: string;
  allocations: { itemId: string; unitNumber: number; amount: string }[];
  reversals: {
    id: string;
    kind: 'CANCELLATION' | 'REFUND';
    amount: string;
    reason: string;
    cashierId: string;
    shiftId: string | null;
    transactionReference: string | null;
    createdAt: string;
  }[];
}
export interface PaymentSummary {
  order: OrderRecord;
  mode: 'AMOUNT' | 'ITEMS' | null;
  collected: string;
  cancelled: string;
  refunded: string;
  netReceipts: string;
  due: string;
  settledAt: string | null;
  payments: PaymentRecord[];
  units: { itemId: string; remaining: number; remainingAmount: string }[];
}
export interface CashShiftRecord {
  id: string;
  cashierId: string;
  terminalId: string;
  terminalName: string;
  cashierName: string;
  currency: string;
  status: 'OPEN' | 'CLOSED';
  version: number;
  openingAmount: string;
  closingAmount: string | null;
  expectedAmount: string;
  difference: string | null;
  closingReason: string | null;
  openedAt: string;
  closedAt: string | null;
}
export interface CashMovementRecord {
  id: string;
  kind: 'OPENING' | 'CASH_IN' | 'CASH_OUT' | 'PAYMENT' | 'REVERSAL';
  amount: string;
  reason: string;
  paymentId: string | null;
  reversalId: string | null;
  createdAt: string;
}

export type MenuKind =
  'categories' | 'products' | 'modifier-groups' | 'modifiers' | 'kitchen-stations';
/** Prices are fixed-scale decimal strings; optional fields depend on kind. */
export interface MenuRecord {
  id: string;
  kind: MenuKind;
  name: string;
  description: string | null;
  sortOrder: number;
  active: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  sku?: string;
  barcode?: string | null;
  categoryId?: string;
  sellingPrice?: string;
  taxRate?: string;
  taxMode?: 'INCLUSIVE' | 'EXCLUSIVE';
  imageUrl?: string | null;
  modifierGroupIds?: string[];
  kitchenStationIds?: string[];
  minSelections?: number;
  maxSelections?: number;
  groupId?: string;
  priceAdjustment?: string;
}
export interface MenuPage {
  items: MenuRecord[];
  page: number;
  hasMore: boolean;
}

export const TABLE_STATUSES = [
  'FREE',
  'OCCUPIED',
  'ORDER_SENT',
  'WAITING_PAYMENT',
  'RESERVED',
  'DISABLED',
] as const;
export type TableStatus = (typeof TABLE_STATUSES)[number];
export type TableShape = 'RECTANGLE' | 'SQUARE' | 'CIRCLE';
export interface AreaRecord {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  canvasWidth: number;
  canvasHeight: number;
  active: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
export interface TableRecord {
  id: string;
  areaId: string;
  name: string;
  number: number;
  capacity: number;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  shape: TableShape;
  status: TableStatus;
  active: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
export interface LayoutEventRecord {
  id: string;
  revision: string;
  entityType: 'Area' | 'RestaurantTable';
  entityId: string;
  entityVersion: number;
  action: string;
  createdAt: string;
}
export interface LayoutChanges {
  events: LayoutEventRecord[];
  cursor: string;
  hasMore: boolean;
}
export interface AreaMap {
  area: AreaRecord;
  tables: TableRecord[];
  revision: string;
}
export interface LayoutPage<T> {
  items: T[];
  page: number;
  hasMore: boolean;
}

export type OrderStatus =
  | 'DRAFT'
  | 'OPEN'
  | 'SENT_TO_KITCHEN'
  | 'PREPARING'
  | 'READY'
  | 'SERVED'
  | 'WAITING_PAYMENT'
  | 'PAID'
  | 'CANCELLED';
export interface OrderItemRecord {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  categoryName: string;
  unitPrice: string;
  taxRate: string;
  taxMode: 'INCLUSIVE' | 'EXCLUSIVE';
  quantity: number;
  notes: string;
  subtotal: string;
  discount: string;
  tax: string;
  total: string;
  voidedAt: string | null;
  voidReason: string | null;
  modifiers: { modifierId: string; groupName: string; name: string; priceAdjustment: string }[];
}
export interface OrderRecord {
  paymentStarted: boolean;
  kitchenSubmitted: boolean;
  id: string;
  orderNumber: string;
  type: 'DINE_IN' | 'TAKEAWAY';
  status: OrderStatus;
  tableId: string | null;
  areaId: string | null;
  tableName: string | null;
  areaName: string | null;
  waiterId: string | null;
  waiterName: string | null;
  currency: string;
  subtotal: string;
  discount: string;
  tax: string;
  total: string;
  discountReason: string | null;
  cancellationReason: string | null;
  notes: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  items: OrderItemRecord[];
}
export interface OrderChange {
  id: string;
  orderId: string;
  orderVersion: number;
  revision: string;
  action: string;
  createdAt: string;
}
export interface OrderChanges {
  events: OrderChange[];
  cursor: string;
  hasMore: boolean;
}

export type KitchenStatus = 'NEW' | 'PREPARING' | 'READY' | 'COMPLETED';
/** Immutable, money-free content shared by KDS and future printer adapters. */
export interface KitchenTicketContent {
  schemaVersion: 1;
  ticketId: string;
  submissionId: string;
  orderId: string;
  orderNumber: string;
  type: 'DINE_IN' | 'TAKEAWAY';
  stationId: string;
  stationName: string;
  tableName: string | null;
  areaName: string | null;
  waiterName: string | null;
  notes: string;
  submittedAt: string;
  items: {
    orderItemId: string;
    productName: string;
    quantity: number;
    notes: string;
    modifiers: { groupName: string; name: string }[];
  }[];
}
export interface KitchenTicketRecord {
  id: string;
  orderId: string;
  stationId: string;
  status: KitchenStatus;
  version: number;
  content: KitchenTicketContent;
  createdAt: string;
  updatedAt: string;
  preparingAt: string | null;
  readyAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
}
export interface KitchenPrintContract {
  schemaVersion: 1;
  kind: 'KITCHEN_TICKET' | 'KITCHEN_CANCELLATION';
  documentId: string;
  ticketVersion: number;
  content: KitchenTicketContent;
  cancellation: { at: string; reason: string } | null;
}
export interface KitchenPage {
  items: KitchenTicketRecord[];
  page: number;
  hasMore: boolean;
  revision: string;
  serverTime: string;
}
