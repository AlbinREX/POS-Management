import { z } from 'zod';

export const inventoryUnitSchema = z.enum(['kg', 'g', 'l', 'ml', 'pcs']);
const id = z.uuid();
const quantity = z.string().regex(/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/);
const positive = quantity.refine((v) => /[1-9]/.test(v), 'Quantity must be positive');
const signed = z
  .string()
  .regex(/^-?(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/)
  .refine((v) => /[1-9]/.test(v), 'Quantity must be nonzero');
const name = z.string().trim().min(1).max(160);
const command = { commandId: id };
const version = z.number().int().positive();
export const inventoryItemSchema = z
  .object({
    ...command,
    name,
    sku: z.string().trim().min(1).max(80),
    kind: z.enum(['INGREDIENT', 'STOCK_ITEM']),
    unitCode: inventoryUnitSchema,
  })
  .strict();
export const inventoryItemUpdateSchema = z
  .object({ ...command, version, name, active: z.boolean() })
  .strict();
export const warehouseSchema = z
  .object({ ...command, name, description: z.string().trim().max(1000).default('') })
  .strict();
export const warehouseUpdateSchema = warehouseSchema.extend({ version, active: z.boolean() });
export const inventoryArchiveSchema = z.object({ ...command, version }).strict();
export const recipeSchema = z
  .object({
    ...command,
    productId: id,
    warehouseId: id,
    version: z.number().int().min(0),
    active: z.boolean().default(true),
    items: z
      .array(z.object({ itemId: id, quantity: positive, unitCode: inventoryUnitSchema }).strict())
      .min(1)
      .max(100),
  })
  .strict()
  .refine(
    (v) => new Set(v.items.map((i) => i.itemId)).size === v.items.length,
    'Use each ingredient once',
  );
export const stockMovementSchema = z
  .object({
    ...command,
    warehouseId: id,
    itemId: id,
    kind: z.enum(['ADJUSTMENT', 'WASTE']),
    quantity: signed,
    unitCode: inventoryUnitSchema,
    reason: z.string().trim().min(1).max(500),
  })
  .strict()
  .refine(
    (v) => v.kind !== 'WASTE' || !v.quantity.startsWith('-'),
    'Enter waste as a positive quantity',
  );
export const stockThresholdSchema = z
  .object({
    ...command,
    warehouseId: id,
    itemId: id,
    version: z.number().int().min(0),
    lowStockThreshold: quantity,
    unitCode: inventoryUnitSchema,
  })
  .strict();
export const inventoryListSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    search: z.string().trim().max(160).default(''),
    warehouseId: id.optional(),
    itemId: id.optional(),
    includeArchived: z.enum(['true', 'false']).default('false'),
  })
  .strict();
export type InventoryItemInput = z.infer<typeof inventoryItemSchema>;
export type InventoryItemUpdate = z.infer<typeof inventoryItemUpdateSchema>;
export type WarehouseInput = z.infer<typeof warehouseSchema>;
export type WarehouseUpdate = z.infer<typeof warehouseUpdateSchema>;
export type InventoryArchiveInput = z.infer<typeof inventoryArchiveSchema>;
export type RecipeInput = z.infer<typeof recipeSchema>;
export type StockMovementInput = z.infer<typeof stockMovementSchema>;
export type StockThresholdInput = z.infer<typeof stockThresholdSchema>;
export type InventoryListInput = z.infer<typeof inventoryListSchema>;
