BEGIN;
-- Phase 13 operational status is derived entirely from existing runtime state: database
-- health, the backup status file written by scripts/backup.ps1, the Phase 12 sync
-- checkpoints and container filesystem headroom.
-- This migration is data-only: it registers the ops.read permission and grants it to
-- protected OWNER roles with an audit record. It creates and alters no table, column,
-- index, constraint or trigger, so the schema and every backup/restore procedure are
-- unchanged.
INSERT INTO "Permission" ("key",description,"updatedAt") VALUES ('ops.read','ops read',CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;
DO $$ DECLARE r RECORD; before_keys JSONB; after_keys JSONB; BEGIN
 FOR r IN SELECT * FROM "Role" WHERE name='OWNER' AND protected=true LOOP
 SELECT COALESCE(jsonb_agg("permissionKey" ORDER BY "permissionKey"),'[]'::jsonb) INTO before_keys FROM "RolePermission" WHERE "roleId"=r.id;
 INSERT INTO "RolePermission" ("roleId","permissionKey") SELECT r.id,key FROM "Permission" WHERE key IN ('ops.read') ON CONFLICT DO NOTHING;
 SELECT jsonb_agg("permissionKey" ORDER BY "permissionKey") INTO after_keys FROM "RolePermission" WHERE "roleId"=r.id;
 IF before_keys<>after_keys THEN INSERT INTO "AuditLog" (id,"organizationId",action,"entityType","entityId","beforeData","afterData") VALUES (gen_random_uuid(),r."organizationId",'role.permissions_migrated','Role',r.id::text,jsonb_build_object('permissions',before_keys),jsonb_build_object('permissions',after_keys,'migration','202609180001_ops')); END IF;
 END LOOP;
END $$;
COMMIT;
