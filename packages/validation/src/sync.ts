import { z } from 'zod';
import { SYNC_STREAMS } from '@restaurant/shared-types';
// Sync reads are branch-scoped through the session; no branch or organization is accepted.
export const syncStatusSchema = z.object({ stream: z.enum(SYNC_STREAMS).optional() }).strict();
export type SyncStatusInput = z.infer<typeof syncStatusSchema>;
