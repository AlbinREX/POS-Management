BEGIN;
-- Phase 14 fiscal handoff delivery state.
--
-- FastFood Riza does not perform Kosovo fiscalization. EnterNet operates the fiscal
-- device and F-LINK software and remains responsible for ATK rules, fiscal signing,
-- certificates, fiscal numbering and device protocol. This migration adds only a record
-- of whether a finalized sale has been handed off to that provider.
--
-- The table stores no fiscal document, no fiscal receipt number and no tax-authority
-- identifier. `providerReference` holds a value the provider supplies, verbatim, and is
-- null until one is received; this system never generates it.
--
-- Delivery state is strictly separate from financial truth. The row references an
-- existing settlement, which exists only for a PAID order, and no trigger, constraint or
-- grant here can alter an order, payment, settlement or ledger row.
CREATE TABLE "FiscalHandoff" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "correlationKey" VARCHAR(120) NOT NULL,
    "provider" VARCHAR(60) NOT NULL,
    "state" VARCHAR(20) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "payloadFingerprint" VARCHAR(32),
    "providerReference" VARCHAR(160),
    "lastError" VARCHAR(500),
    "lastAttemptAt" TIMESTAMPTZ(3),
    "confirmedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "FiscalHandoff_pkey" PRIMARY KEY ("id")
);
-- One handoff per order: a settled sale can never be handed off twice.
CREATE UNIQUE INDEX "FiscalHandoff_orderId_key" ON "FiscalHandoff"("orderId");
CREATE UNIQUE INDEX "FiscalHandoff_orderId_branchId_organizationId_key" ON "FiscalHandoff"("orderId", "branchId", "organizationId");
-- The correlation key is the idempotency identity presented to the provider, unique per
-- branch so a retry can never create a second delivery identity.
CREATE UNIQUE INDEX "FiscalHandoff_branchId_organizationId_correlationKey_key" ON "FiscalHandoff"("branchId", "organizationId", "correlationKey");
CREATE INDEX "FiscalHandoff_branchId_organizationId_state_createdAt_id_idx" ON "FiscalHandoff"("branchId", "organizationId", "state", "createdAt", "id");
-- Composite foreign keys preserve branch and organization isolation, and RESTRICT keeps
-- a settlement from being removed while a handoff references it.
ALTER TABLE "FiscalHandoff" ADD CONSTRAINT "FiscalHandoff_orderId_branchId_organizationId_fkey" FOREIGN KEY ("orderId", "branchId", "organizationId") REFERENCES "OrderSettlement"("orderId", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FiscalHandoff" ADD CONSTRAINT "FiscalHandoff_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Only the five known delivery states are permitted, so a typo cannot create a row that
-- no operator view surfaces and no worker advances.
ALTER TABLE "FiscalHandoff" ADD CONSTRAINT "FiscalHandoff_state_valid" CHECK ("state" IN ('PENDING','SENT','CONFIRMED','FAILED','RETRY_REQUIRED'));
ALTER TABLE "FiscalHandoff" ADD CONSTRAINT "FiscalHandoff_attempts_valid" CHECK ("attempts" >= 0);
-- A confirmed handoff must carry its confirmation time, and an unconfirmed one must not
-- claim to have been confirmed.
ALTER TABLE "FiscalHandoff" ADD CONSTRAINT "FiscalHandoff_confirmed_valid" CHECK (("state" = 'CONFIRMED') = ("confirmedAt" IS NOT NULL));

INSERT INTO "Permission" ("key",description,"updatedAt") VALUES ('fiscal.read','fiscal read',CURRENT_TIMESTAMP), ('fiscal.retry','fiscal retry',CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;
DO $$ DECLARE r RECORD; before_keys JSONB; after_keys JSONB; BEGIN
 FOR r IN SELECT * FROM "Role" WHERE name='OWNER' AND protected=true LOOP
 SELECT COALESCE(jsonb_agg("permissionKey" ORDER BY "permissionKey"),'[]'::jsonb) INTO before_keys FROM "RolePermission" WHERE "roleId"=r.id;
 INSERT INTO "RolePermission" ("roleId","permissionKey") SELECT r.id,key FROM "Permission" WHERE key IN ('fiscal.read','fiscal.retry') ON CONFLICT DO NOTHING;
 SELECT jsonb_agg("permissionKey" ORDER BY "permissionKey") INTO after_keys FROM "RolePermission" WHERE "roleId"=r.id;
 IF before_keys<>after_keys THEN INSERT INTO "AuditLog" (id,"organizationId",action,"entityType","entityId","beforeData","afterData") VALUES (gen_random_uuid(),r."organizationId",'role.permissions_migrated','Role',r.id::text,jsonb_build_object('permissions',before_keys),jsonb_build_object('permissions',after_keys,'migration','202609190001_fiscal')); END IF;
 END LOOP;
END $$;
COMMIT;
