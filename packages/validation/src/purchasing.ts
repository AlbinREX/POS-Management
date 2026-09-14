import { z } from 'zod';
import { inventoryUnitSchema } from './inventory';
const id = z.uuid();
const command = { commandId: id };
const version = z.number().int().positive();
const text = (max: number) => z.string().trim().max(max);
const date = z.iso
  .date()
  .refine((v) => !Number.isNaN(new Date(v).getTime()) && new Date(v).toISOString().slice(0, 10) === v, 'Invalid date');
const quantity = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/)
  .refine((v) => /[1-9]/.test(v), 'Quantity must be positive');
const money = z.string().regex(/^(0|[1-9][0-9]{0,11})\.[0-9]{2}$/);
export const supplierSchema = z
  .object({
    ...command,
    name: text(160).min(1),
    businessNumber: text(80).default(''),
    taxNumber: text(80).default(''),
    contactPerson: text(160).default(''),
    phone: text(60).default(''),
    email: z.union([z.email().max(254), z.literal('')]).default(''),
    address: text(500).default(''),
    notes: text(2000).default(''),
  })
  .strict();
export const supplierUpdateSchema = supplierSchema.extend({ version, active: z.boolean() });
export const purchasingVersionSchema = z.object({ ...command, version }).strict();
export const purchaseDraftSchema = z
  .object({
    ...command,
    supplierId: id,
    warehouseId: id,
    reference: text(120).default(''),
    notes: text(2000).default(''),
    expectedDate: date.nullable().default(null),
    items: z
      .array(
        z
          .object({
            itemId: id,
            quantity,
            unitCode: inventoryUnitSchema,
            unitPrice: z.string().regex(/^(0|[1-9][0-9]{0,9})(\.[0-9]{1,4})?$/),
            taxRate: z
              .string()
              .regex(/^(0|[1-9][0-9]?|100)(\.[0-9]{1,2})?$/)
              .refine((v) => Number(v) <= 100),
          })
          .strict(),
      )
      .min(1)
      .max(100)
      .refine((v) => new Set(v.map((i) => i.itemId)).size === v.length, 'Use each item once'),
  })
  .strict();
export const purchaseUpdateSchema = purchaseDraftSchema.extend({ version });
export const purchaseCancelSchema = purchasingVersionSchema.extend({ reason: text(500).min(1) });
export const goodsReceiptSchema = z
  .object({
    ...command,
    version,
    reference: text(120).min(1),
    invoiceNumber: text(120).min(1).nullable().default(null),
    invoiceDate: date.nullable().default(null),
    dueDate: date.nullable().default(null),
    documentReference: z
      .union([z.url({ protocol: /^https$/ }).max(1000), z.literal('')])
      .default(''),
    notes: text(2000).default(''),
    items: z
      .array(z.object({ purchaseItemId: id, quantity }).strict())
      .min(1)
      .max(100)
      .refine(
        (v) => new Set(v.map((i) => i.purchaseItemId)).size === v.length,
        'Duplicate receipt lines',
      ),
  })
  .strict()
  .refine(
    (v) => Boolean(v.invoiceNumber) === Boolean(v.invoiceDate),
    'Invoice number and date are required together',
  )
  .refine(
    (v) => !v.dueDate || !v.invoiceDate || v.dueDate >= v.invoiceDate,
    'Due date precedes invoice date',
  );
export const supplierPaymentSchema = z
  .object({
    ...command,
    receiptId: id,
    amount: money.refine((v) => /[1-9]/.test(v), 'Amount must be positive'),
    method: z.enum(['BANK_TRANSFER', 'CASH', 'CARD', 'OTHER']),
    reference: text(120).min(1),
    reason: text(500).min(1),
  })
  .strict();
export const supplierReverseSchema = z.object({ ...command, reason: text(500).min(1) }).strict();
export const purchasingListSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    search: text(160).default(''),
    supplierId: id.optional(),
    purchaseOrderId: id.optional(),
    status: z.enum(['DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED']).optional(),
    includeArchived: z.enum(['true', 'false']).default('false'),
  })
  .strict();
export type SupplierInput = z.infer<typeof supplierSchema>;
export type SupplierUpdate = z.infer<typeof supplierUpdateSchema>;
export type PurchaseDraftInput = z.infer<typeof purchaseDraftSchema>;
export type PurchaseUpdate = z.infer<typeof purchaseUpdateSchema>;
export type GoodsReceiptInput = z.infer<typeof goodsReceiptSchema>;
export type SupplierPaymentInput = z.infer<typeof supplierPaymentSchema>;
export type PurchasingListInput = z.infer<typeof purchasingListSchema>;
