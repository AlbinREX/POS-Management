import type { InventoryUnitCode } from './inventory';
export type PurchaseStatus = 'DRAFT' | 'ORDERED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';
export interface SupplierRecord {
  id: string;
  name: string;
  businessNumber: string;
  taxNumber: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  active: boolean;
  deletedAt: string | null;
  version: number;
}
export interface PurchaseItemRecord {
  id: string;
  itemId: string;
  itemName: string;
  sku: string;
  stockUnit: InventoryUnitCode;
  unitCode: InventoryUnitCode;
  quantity: string;
  stockQuantity: string;
  unitPrice: string;
  taxRate: string;
  subtotal: string;
  tax: string;
  total: string;
  receivedQuantity: string;
  remainingQuantity: string;
}
export interface PurchaseRecord {
  cancellationReason: string | null;
  id: string;
  number: string;
  status: PurchaseStatus;
  version: number;
  supplierId: string;
  supplierName: string;
  warehouseId: string;
  warehouseName: string;
  currency: string;
  reference: string;
  notes: string;
  expectedDate: string | null;
  subtotal: string;
  tax: string;
  total: string;
  createdAt: string;
  items: PurchaseItemRecord[];
}
export interface ReceiptItemRecord {
  id: string;
  purchaseItemId: string;
  itemName: string;
  unitCode: InventoryUnitCode;
  stockUnit: InventoryUnitCode;
  quantity: string;
  stockQuantity: string;
  unitPrice: string;
  taxRate: string;
  subtotal: string;
  tax: string;
  total: string;
}
export interface ReceiptRecord {
  id: string;
  purchaseOrderId: string;
  purchaseNumber: string;
  supplierId: string;
  supplierName: string;
  warehouseName: string;
  reference: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  documentReference: string;
  notes: string;
  currency: string;
  subtotal: string;
  tax: string;
  total: string;
  outstanding: string;
  receivedBy: string;
  createdAt: string;
  items: ReceiptItemRecord[];
}
export interface SupplierEntryRecord {
  id: string;
  receiptId: string;
  receiptReference: string;
  kind: 'CHARGE' | 'PAYMENT' | 'PAYMENT_REVERSAL';
  amount: string;
  method: string | null;
  reference: string | null;
  reason: string;
  reversesId: string | null;
  reversed: boolean;
  createdAt: string;
  userName: string;
}
export interface SupplierAccount {
  supplierId: string;
  currency: string;
  receivedValue: string;
  outstanding: string;
  lastReceiptAt: string | null;
  receiptCount: number;
  items: SupplierEntryRecord[];
  hasMore: boolean;
}
