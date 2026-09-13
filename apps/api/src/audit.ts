import type { Prisma } from '@restaurant/database';
export interface AuditContext {
  organizationId?: string;
  branchId?: string;
  userId?: string;
  terminalId?: string;
  requestId?: string;
  ip?: string;
}
export function audit(
  tx: Prisma.TransactionClient,
  context: AuditContext,
  action: string,
  entityType: string,
  entityId?: string,
  beforeData?: Prisma.InputJsonObject,
  afterData?: Prisma.InputJsonObject,
) {
  // Call sites construct allowlisted snapshots. Never pass request bodies or ORM users here.
  return tx.auditLog.create({
    data: { ...context, action, entityType, entityId, beforeData, afterData },
  });
}
