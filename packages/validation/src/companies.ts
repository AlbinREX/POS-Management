import { z } from 'zod';
const id = z.uuid();
const command = { commandId: id };
const version = z.number().int().positive();
const text = (max: number) => z.string().trim().max(max);
const date = z.iso
  .date()
  .refine(
    (v) => !Number.isNaN(new Date(v).getTime()) && new Date(v).toISOString().slice(0, 10) === v,
    'Invalid date',
  );
const money = z.string().regex(/^(0|[1-9][0-9]{0,11})\.[0-9]{2}$/);
const positiveMoney = money.refine((v) => /[1-9]/.test(v), 'Amount must be positive');
export const companySchema = z
  .object({
    ...command,
    name: text(160).min(1),
    businessNumber: text(80).default(''),
    taxNumber: text(80).default(''),
    address: text(500).default(''),
    phone: text(60).default(''),
    email: z.union([z.email().max(254), z.literal('')]).default(''),
    contactPerson: text(160).default(''),
  })
  .strict();
export const companyUpdateSchema = companySchema.extend({ version, active: z.boolean() });
export const companyVersionSchema = z.object({ ...command, version }).strict();
export const contractSchema = z
  .object({
    ...command,
    companyId: id,
    contractNumber: text(80).min(1),
    startDate: date,
    endDate: date.nullable().default(null),
    creditLimit: money,
    discountPercentage: z
      .string()
      .regex(/^(0|[1-9][0-9]?|100)(\.[0-9]{1,2})?$/)
      .refine((v) => Number(v) <= 100, 'Discount cannot exceed 100 percent'),
    paymentTermsDays: z.number().int().min(0).max(365),
    billingCycle: z.enum(['MONTHLY', 'BIWEEKLY', 'WEEKLY']),
    notes: text(2000).default(''),
  })
  .strict()
  .refine((v) => !v.endDate || v.endDate >= v.startDate, 'End date precedes start date');
export const contractUpdateSchema = contractSchema.extend({ version });
export const contractStatusSchema = z
  .object({
    ...command,
    version,
    status: z.enum(['DRAFT', 'ACTIVE', 'EXPIRED', 'SUSPENDED', 'TERMINATED']),
    reason: text(500).default(''),
  })
  .strict();
export const companyEmployeeSchema = z
  .object({
    ...command,
    companyId: id,
    name: text(160).min(1),
    code: text(60).default(''),
    email: z.union([z.email().max(254), z.literal('')]).default(''),
    phone: text(60).default(''),
  })
  .strict();
export const companyEmployeeUpdateSchema = companyEmployeeSchema.extend({
  version,
  active: z.boolean(),
});
export const companyPaymentSchema = z
  .object({
    ...command,
    companyId: id,
    amount: positiveMoney,
    method: z.enum(['BANK_TRANSFER', 'CASH', 'CARD', 'OTHER']),
    reference: text(120).min(1),
    reason: text(500).min(1),
  })
  .strict();
export const companyReverseSchema = z.object({ ...command, reason: text(500).min(1) }).strict();
export const statementSchema = z
  .object({ ...command, companyId: id, periodStart: date, periodEnd: date })
  .strict()
  .refine((v) => v.periodEnd >= v.periodStart, 'Period end precedes period start');
export const companyListSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    search: text(160).default(''),
    companyId: id.optional(),
    contractId: id.optional(),
    status: z.enum(['DRAFT', 'ACTIVE', 'EXPIRED', 'SUSPENDED', 'TERMINATED']).optional(),
    includeArchived: z.enum(['true', 'false']).default('false'),
  })
  .strict();
export type CompanyInput = z.infer<typeof companySchema>;
export type CompanyUpdate = z.infer<typeof companyUpdateSchema>;
export type ContractInput = z.infer<typeof contractSchema>;
export type ContractUpdate = z.infer<typeof contractUpdateSchema>;
export type ContractStatusInput = z.infer<typeof contractStatusSchema>;
export type CompanyEmployeeInput = z.infer<typeof companyEmployeeSchema>;
export type CompanyEmployeeUpdate = z.infer<typeof companyEmployeeUpdateSchema>;
export type CompanyPaymentInput = z.infer<typeof companyPaymentSchema>;
export type StatementInput = z.infer<typeof statementSchema>;
export type CompanyListInput = z.infer<typeof companyListSchema>;
