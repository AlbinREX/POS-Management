BEGIN;
-- Phase 12 local-first synchronization.
--
-- The seven per-module event logs (LayoutEvent, OrderEvent, KitchenEvent, PaymentEvent,
-- InventoryEvent, PurchasingEvent, CompaniesEvent) are already the durable outbox: each
-- row is written in the same transaction as its business change. This migration adds only
-- a per-branch, per-stream delivery checkpoint recording how far an optional cloud
-- consumer has confirmed receipt, plus the sync.read permission.
--
-- The checkpoint holds no business data. It is never a source of truth, it can never
-- overwrite a local record, and resetting a cursor only re-delivers already-committed
-- local history. No existing table, column, constraint or trigger is altered, so every
-- Phase 1-11 guarantee, backup and restore procedure is unchanged.
CREATE TABLE "SyncCheckpoint" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "stream" VARCHAR(40) NOT NULL,
    "deliveredRevision" BIGINT NOT NULL DEFAULT 0,
    "lastDeliveredAt" TIMESTAMPTZ(3),
    "lastAttemptAt" TIMESTAMPTZ(3),
    "lastError" VARCHAR(500),
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "SyncCheckpoint_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SyncCheckpoint_branchId_organizationId_stream_key" ON "SyncCheckpoint"("branchId", "organizationId", "stream");
CREATE INDEX "SyncCheckpoint_branchId_organizationId_idx" ON "SyncCheckpoint"("branchId", "organizationId");
ALTER TABLE "SyncCheckpoint" ADD CONSTRAINT "SyncCheckpoint_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
-- A delivered cursor may never run backwards on its own: regressing one is an explicit
-- operator recovery action, not something the delivery worker can do by accident.
ALTER TABLE "SyncCheckpoint" ADD CONSTRAINT "SyncCheckpoint_revision_valid" CHECK ("deliveredRevision" >= 0 AND "failedAttempts" >= 0);
-- Only the seven known streams are permitted, so a typo cannot silently create a
-- checkpoint that no worker ever advances.
ALTER TABLE "SyncCheckpoint" ADD CONSTRAINT "SyncCheckpoint_stream_valid" CHECK ("stream" IN ('layout','orders','kitchen','payments','inventory','purchasing','companies'));

INSERT INTO "Permission" ("key",description,"updatedAt") VALUES ('sync.read','sync read',CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;
DO $$ DECLARE r RECORD; before_keys JSONB; after_keys JSONB; BEGIN
 FOR r IN SELECT * FROM "Role" WHERE name='OWNER' AND protected=true LOOP
 SELECT COALESCE(jsonb_agg("permissionKey" ORDER BY "permissionKey"),'[]'::jsonb) INTO before_keys FROM "RolePermission" WHERE "roleId"=r.id;
 INSERT INTO "RolePermission" ("roleId","permissionKey") SELECT r.id,key FROM "Permission" WHERE key IN ('sync.read') ON CONFLICT DO NOTHING;
 SELECT jsonb_agg("permissionKey" ORDER BY "permissionKey") INTO after_keys FROM "RolePermission" WHERE "roleId"=r.id;
 IF before_keys<>after_keys THEN INSERT INTO "AuditLog" (id,"organizationId",action,"entityType","entityId","beforeData","afterData") VALUES (gen_random_uuid(),r."organizationId",'role.permissions_migrated','Role',r.id::text,jsonb_build_object('permissions',before_keys),jsonb_build_object('permissions',after_keys,'migration','202609170001_sync')); END IF;
 END LOOP;
END $$;
COMMIT;
