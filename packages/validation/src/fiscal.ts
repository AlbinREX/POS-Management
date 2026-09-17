import { z } from 'zod';
import { FISCAL_HANDOFF_STATES } from '@restaurant/shared-types';
// Fiscal reads are branch-scoped through the session. No branch, organization, provider
// reference or fiscal identifier is ever accepted from a client: this POS does not
// produce fiscal identifiers, and the provider's own reference is stored only as the
// adapter reports it.
export const fiscalListSchema = z
  .object({ state: z.enum(FISCAL_HANDOFF_STATES).optional() })
  .strict();
/** A retry carries no payload: the sale data is rebuilt from immutable records. */
export const fiscalRetrySchema = z.object({}).strict();
export type FiscalListInput = z.infer<typeof fiscalListSchema>;
