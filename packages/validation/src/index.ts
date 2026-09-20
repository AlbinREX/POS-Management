export * from './companies';
export * from './reporting';
export * from './sync';
export * from './fiscal';
export * from './purchasing';
export * from './inventory';
import { z } from 'zod';
import { PERMISSIONS } from '@restaurant/shared-types';
export const id = z.uuid();
export const password = z.string().min(12).max(128);
export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1).max(128), newPassword: password })
  .strict()
  .refine((value) => value.currentPassword !== value.newPassword);
export const email = z
  .email()
  .max(254)
  .transform((value) => value.trim().toLowerCase());
export const loginSchema = z
  .object({
    organization: z.string().min(1).max(80),
    branch: z.string().min(1).max(40),
    email,
    password: z.string().min(1).max(128),
    terminalId: id.optional(),
  })
  .strict();
export const createUserSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email,
    password,
    roleIds: z.array(id).min(1).max(20),
  })
  .strict();
export const updateUserSchema = z.object({ active: z.boolean() }).strict();
export const assignRolesSchema = z.object({ roleIds: z.array(id).min(1).max(20) }).strict();
export const createRoleSchema = z
  .object({
    name: z.string().trim().min(1).max(50),
    permissions: z.array(z.enum(PERMISSIONS)).max(100),
  })
  .strict();
export const rolePermissionsSchema = z
  .object({ permissions: z.array(z.enum(PERMISSIONS)).max(100) })
  .strict();
export const terminalSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    type: z.enum(['POS', 'KDS', 'WAITER', 'ADMIN', 'OWNER', 'KIOSK']),
  })
  .strict();
export const updateTerminalSchema = z
  .object({ name: z.string().trim().min(1).max(100).optional(), active: z.boolean().optional() })
  .strict()
  .refine((value) => Object.keys(value).length > 0);
export const decimalAmountSchema = z.string().regex(/^(0|[1-9]\d{0,11})\.\d{2}$/);

export const signedAmountSchema = z
  .string()
  .regex(/^-?(0|[1-9]\d{0,11})\.\d{2}$/)
  .refine((value) => value !== '-0.00', 'Use 0.00 for zero');
export const taxRateSchema = z.string().regex(/^(\d|[1-9]\d)\.\d{2}$|^100\.00$/);
export const menuKindSchema = z.enum([
  'categories',
  'products',
  'modifier-groups',
  'modifiers',
  'kitchen-stations',
]);
const commonMenu = {
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).nullable().default(null),
  sortOrder: z.number().int().min(0).max(1000000).default(0),
  active: z.boolean().default(true),
};
const uniqueIds = z
  .array(id)
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length, 'Duplicate IDs');
export const categorySchema = z.object({ ...commonMenu, kind: z.literal('categories') }).strict();
export const stationSchema = z
  .object({ ...commonMenu, kind: z.literal('kitchen-stations') })
  .strict();
export const modifierGroupSchema = z
  .object({
    ...commonMenu,
    kind: z.literal('modifier-groups'),
    minSelections: z.number().int().min(0).max(100),
    maxSelections: z.number().int().min(1).max(100),
  })
  .strict()
  .refine((v) => v.minSelections <= v.maxSelections, 'Minimum exceeds maximum');
export const modifierSchema = z
  .object({
    ...commonMenu,
    kind: z.literal('modifiers'),
    groupId: id,
    priceAdjustment: signedAmountSchema,
  })
  .strict();
export const productSchema = z
  .object({
    ...commonMenu,
    kind: z.literal('products'),
    sku: z.string().trim().min(1).max(80),
    barcode: z.string().trim().min(1).max(80).nullable().default(null),
    categoryId: id,
    sellingPrice: decimalAmountSchema,
    taxRate: taxRateSchema,
    taxMode: z.enum(['INCLUSIVE', 'EXCLUSIVE']),
    imageUrl: z
      .string()
      .trim()
      .max(2048)
      .refine(
        // An absolute http(s) URL can point at a restaurant's own LAN host, and a
        // root-relative path lets images bundled with the app stay portable across
        // localhost, a LAN address and any deployment without rewriting stored rows.
        // Protocol-relative ("//host") and scheme-bearing values such as javascript:
        // or data: remain rejected, so this widens storage without widening risk.
        (url) => /^https?:\/\/[^/]/i.test(url) || /^\/[^/]/.test(url),
        'Use an HTTP or HTTPS image URL, or an app path such as /food/burger.webp',
      )
      .nullable()
      .default(null),
    modifierGroupIds: uniqueIds.default([]),
    kitchenStationIds: uniqueIds.default([]),
  })
  .strict();
export const menuInputSchema = z.discriminatedUnion('kind', [
  categorySchema,
  stationSchema,
  modifierGroupSchema,
  modifierSchema,
  productSchema,
]);
export type MenuInput = z.infer<typeof menuInputSchema>;
export const menuUpdateSchema = z
  .object({ version: z.number().int().positive(), data: menuInputSchema })
  .strict();
export const menuArchiveSchema = z.object({ version: z.number().int().positive() }).strict();
export const menuListSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    search: z.string().trim().max(160).default(''),
    archived: z.enum(['false', 'true']).default('false'),
  })
  .strict();

const layoutVersion = z.number().int().min(1).max(2147483647);
export const layoutVersionSchema = z.object({ version: layoutVersion }).strict();
export const areaInputSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2000).nullable().default(null),
    sortOrder: z.number().int().min(0).max(1000000).default(0),
    canvasWidth: z.number().int().min(200).max(10000).default(1200),
    canvasHeight: z.number().int().min(200).max(10000).default(800),
    active: z.boolean().default(true),
  })
  .strict();
const geometryFields = {
  positionX: z.number().int().min(0).max(10000),
  positionY: z.number().int().min(0).max(10000),
  width: z.number().int().min(44).max(1000),
  height: z.number().int().min(44).max(1000),
  shape: z.enum(['RECTANGLE', 'SQUARE', 'CIRCLE']),
};
const validGeometry = (v: {
  shape: string;
  width: number;
  height: number;
  positionX: number;
  positionY: number;
}) =>
  (v.shape === 'RECTANGLE' || v.width === v.height) &&
  v.positionX + v.width <= 10000 &&
  v.positionY + v.height <= 10000;
export const tableInputSchema = z
  .object({
    areaId: id,
    name: z.string().trim().min(1).max(100),
    number: z.number().int().min(1).max(99999),
    capacity: z.number().int().min(1).max(100),
    ...geometryFields,
  })
  .strict()
  .refine(validGeometry, 'Square/circle dimensions must match and geometry must fit layout bounds');
export const areaUpdateSchema = z
  .object({ version: layoutVersion, data: areaInputSchema })
  .strict();
export const tableUpdateSchema = z
  .object({ version: layoutVersion, data: tableInputSchema })
  .strict();
export const tableGeometrySchema = z
  .object({ version: layoutVersion, ...geometryFields })
  .strict()
  .refine(validGeometry, 'Invalid table geometry');
export const tableStatusSchema = z
  .object({ version: layoutVersion, status: z.enum(['FREE', 'RESERVED', 'DISABLED']) })
  .strict();
export const layoutListSchema = menuListSchema;
export const tableListSchema = menuListSchema.extend({ areaId: id.optional() });
export const layoutChangesSchema = z
  .object({
    after: z
      .string()
      .regex(/^(0|[1-9]\d{0,18})$/)
      .refine((s) => /^\d{1,19}$/.test(s) && BigInt(s) <= 9223372036854775807n)
      .default('0'),
    limit: z.coerce.number().int().min(1).max(100).default(100),
  })
  .strict();
export type AreaInput = z.infer<typeof areaInputSchema>;
export type TableInput = z.infer<typeof tableInputSchema>;
export type TableGeometryInput = z.infer<typeof tableGeometrySchema>;

export const orderCreateSchema = z
  .object({
    commandId: id,
    type: z.enum(['DINE_IN', 'TAKEAWAY']),
    tableId: id.nullable().default(null),
    waiterId: id.nullable().default(null),
    notes: z.string().trim().max(2000).default(''),
  })
  .strict()
  .refine(
    (v) => (v.type === 'DINE_IN') === (v.tableId !== null),
    'Dine-in requires a table; takeaway cannot have one',
  );
const command = { commandId: id, version: layoutVersion };
const reason = z.string().trim().min(1).max(500);
export const orderCommandSchema = z.discriminatedUnion('action', [
  z
    .object({
      ...command,
      action: z.literal('add_item'),
      productId: id,
      quantity: z.number().int().min(1).max(999),
      modifierIds: uniqueIds.default([]),
      notes: z.string().trim().max(2000).default(''),
    })
    .strict(),
  z
    .object({
      ...command,
      action: z.literal('update_item'),
      itemId: id,
      quantity: z.number().int().min(1).max(999),
      notes: z.string().trim().max(2000).default(''),
    })
    .strict(),
  z.object({ ...command, action: z.literal('void_item'), itemId: id, reason }).strict(),
  z
    .object({ ...command, action: z.literal('discount'), amount: decimalAmountSchema, reason })
    .strict(),
  z
    .object({
      ...command,
      action: z.literal('status'),
      status: z.enum(['OPEN', 'WAITING_PAYMENT']),
    })
    .strict(),
  z.object({ ...command, action: z.literal('cancel'), reason }).strict(),
  z.object({ ...command, action: z.literal('assign_waiter'), waiterId: id.nullable() }).strict(),
  z.object({ ...command, action: z.literal('notes'), notes: z.string().trim().max(2000) }).strict(),
]);
export const orderListSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    status: z
      .enum([
        'DRAFT',
        'OPEN',
        'SENT_TO_KITCHEN',
        'PREPARING',
        'READY',
        'WAITING_PAYMENT',
        'PAID',
        'CANCELLED',
      ])
      .optional(),
  })
  .strict();
export type OrderCreateInput = z.infer<typeof orderCreateSchema>;
export type OrderCommandInput = z.infer<typeof orderCommandSchema>;

export const kitchenSubmitSchema = z.object(command).strict();
export const kitchenStateSchema = z
  .object({ ...command, status: z.enum(['PREPARING', 'READY', 'COMPLETED']) })
  .strict();
export const kitchenListSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    stationId: id.optional(),
    view: z.enum(['active', 'history']).default('active'),
  })
  .strict();

const positiveMoney = decimalAmountSchema.refine((v) => /[1-9]/.test(v), 'Amount must be positive');
// References identify an external terminal receipt; never accept payment-card credentials.
const paymentReference = z
  .string()
  .trim()
  .min(3)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/)
  .refine((v) => !/^\d{12,19}$/.test(v), 'Use a terminal receipt reference, not a card number');
const selectedUnits = z
  .array(z.object({ itemId: id, quantity: z.number().int().min(1).max(999) }).strict())
  .min(1)
  .max(100)
  .refine(
    (v) =>
      new Set(v.map((i) => i.itemId)).size === v.length &&
      v.reduce((n, i) => n + i.quantity, 0) <= 2000,
    'Duplicate items or too many units',
  );
const tender = z
  .object({
    method: z.enum(['CASH', 'CARD', 'COMPANY_ACCOUNT']),
    amount: positiveMoney.optional(),
    items: selectedUnits.optional(),
    tendered: decimalAmountSchema.optional(),
    shiftId: id.optional(),
    transactionReference: paymentReference.optional(),
    companyId: id.optional(),
    companyEmployeeId: id.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    // Exhaustive per method: an unhandled method must never pass unvalidated.
    const company = v.companyId !== undefined || v.companyEmployeeId !== undefined;
    const invalid =
      v.method === 'CASH'
        ? !v.tendered || !v.shiftId || v.transactionReference || company
        : v.method === 'CARD'
          ? !v.transactionReference || v.tendered !== undefined || v.shiftId !== undefined || company
          : !v.companyId ||
            v.tendered !== undefined ||
            v.shiftId !== undefined ||
            v.transactionReference !== undefined;
    if (invalid)
      ctx.addIssue({
        code: 'custom',
        message:
          'Cash requires tendered cash and a shift; card requires only an external reference; a company account requires only its company',
      });
  });
export const paymentCollectSchema = z
  .object({
    ...command,
    mode: z.enum(['AMOUNT', 'ITEMS']),
    tenders: z.array(tender).min(1).max(20),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.tenders.some((t) =>
        v.mode === 'AMOUNT'
          ? !t.amount || t.items !== undefined
          : !t.items || t.amount !== undefined,
      )
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Use amounts or item selections according to bill mode',
      });
  });
export const paymentZeroSchema = z.object(command).strict();
export const paymentReverseSchema = z
  .object({
    commandId: id,
    kind: z.enum(['CANCELLATION', 'REFUND']),
    amount: positiveMoney,
    reason,
    shiftId: id.optional(),
    transactionReference: paymentReference.optional(),
  })
  .strict()
  .refine(
    (v) => v.shiftId === undefined || v.transactionReference === undefined,
    'A reversal uses the original method: a cash shift or an external reference, never both',
  );
export const shiftOpenSchema = z
  .object({ commandId: id, terminalId: id, openingAmount: decimalAmountSchema })
  .strict();
export const shiftCommandSchema = z.discriminatedUnion('action', [
  z
    .object({
      ...command,
      action: z.literal('close'),
      closingAmount: decimalAmountSchema,
      reason: z.string().trim().max(500).default(''),
    })
    .strict(),
  z.object({ ...command, action: z.literal('cash_in'), amount: positiveMoney, reason }).strict(),
  z.object({ ...command, action: z.literal('cash_out'), amount: positiveMoney, reason }).strict(),
]);
export const paymentPageSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
