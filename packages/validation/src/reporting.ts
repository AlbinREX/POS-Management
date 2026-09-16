import { z } from 'zod';
import { REPORT_KINDS } from '@restaurant/shared-types';
const id = z.uuid();
const date = z.iso
  .date()
  .refine(
    (v) => !Number.isNaN(new Date(v).getTime()) && new Date(v).toISOString().slice(0, 10) === v,
    'Invalid date',
  );
const dayMs = 24 * 60 * 60 * 1000;
export const reportKindSchema = z.enum(REPORT_KINDS);
// A report range is either a named preset or an explicit inclusive calendar span in the
// branch timezone. Branch and organization are never accepted: scope comes from the session.
export const reportRangeSchema = z
  .object({
    preset: z.enum(['today', 'yesterday', 'week', 'month', 'custom']).default('today'),
    from: date.optional(),
    to: date.optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    search: z.string().trim().max(160).default(''),
    warehouseId: id.optional(),
    supplierId: id.optional(),
    companyId: id.optional(),
  })
  .strict()
  .refine((v) => (v.from === undefined) === (v.to === undefined), 'Provide both from and to')
  .refine(
    (v) => (v.preset === 'custom') === (v.from !== undefined),
    'A custom range requires from and to dates; presets take none',
  )
  .refine((v) => !v.from || !v.to || v.to >= v.from, 'Range end precedes its start')
  .refine(
    (v) =>
      !v.from || !v.to || (new Date(v.to).getTime() - new Date(v.from).getTime()) / dayMs <= 366,
    'A range may span at most 366 days',
  );
export type ReportRangeInput = z.infer<typeof reportRangeSchema>;
