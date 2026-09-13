-- CreateEnum
BEGIN;
CREATE TYPE "TableShape" AS ENUM ('RECTANGLE', 'SQUARE', 'CIRCLE');

-- CreateEnum
CREATE TYPE "TableStatus" AS ENUM ('FREE', 'OCCUPIED', 'ORDER_SENT', 'WAITING_PAYMENT', 'RESERVED', 'DISABLED');

-- CreateEnum
CREATE TYPE "LayoutEntityType" AS ENUM ('Area', 'RestaurantTable');

-- CreateTable
CREATE TABLE "Area" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(2000),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "canvasWidth" INTEGER NOT NULL DEFAULT 1200,
    "canvasHeight" INTEGER NOT NULL DEFAULT 800,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Area_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestaurantTable" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "areaId" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "number" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL,
    "positionX" INTEGER NOT NULL,
    "positionY" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "shape" "TableShape" NOT NULL,
    "status" "TableStatus" NOT NULL DEFAULT 'FREE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "RestaurantTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LayoutRevision" (
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "revision" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LayoutRevision_pkey" PRIMARY KEY ("branchId")
);

-- CreateTable
CREATE TABLE "LayoutEvent" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "revision" BIGINT NOT NULL,
    "entityType" "LayoutEntityType" NOT NULL,
    "entityId" UUID NOT NULL,
    "entityVersion" INTEGER NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LayoutEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Area_branchId_organizationId_deletedAt_sortOrder_id_idx" ON "Area"("branchId", "organizationId", "deletedAt", "sortOrder", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Area_id_branchId_organizationId_key" ON "Area"("id", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Area_branchId_name_key" ON "Area"("branchId", "name");

-- CreateIndex
CREATE INDEX "RestaurantTable_areaId_branchId_organizationId_deletedAt_nu_idx" ON "RestaurantTable"("areaId", "branchId", "organizationId", "deletedAt", "number");

-- CreateIndex
CREATE INDEX "RestaurantTable_branchId_organizationId_status_deletedAt_idx" ON "RestaurantTable"("branchId", "organizationId", "status", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RestaurantTable_id_branchId_organizationId_key" ON "RestaurantTable"("id", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "RestaurantTable_branchId_number_key" ON "RestaurantTable"("branchId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "LayoutRevision_branchId_organizationId_key" ON "LayoutRevision"("branchId", "organizationId");

-- CreateIndex
CREATE INDEX "LayoutEvent_branchId_organizationId_revision_idx" ON "LayoutEvent"("branchId", "organizationId", "revision");

-- CreateIndex
CREATE INDEX "LayoutEvent_entityType_entityId_idx" ON "LayoutEvent"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "LayoutEvent_branchId_revision_key" ON "LayoutEvent"("branchId", "revision");

-- AddForeignKey
ALTER TABLE "Area" ADD CONSTRAINT "Area_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestaurantTable" ADD CONSTRAINT "RestaurantTable_areaId_branchId_organizationId_fkey" FOREIGN KEY ("areaId", "branchId", "organizationId") REFERENCES "Area"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LayoutRevision" ADD CONSTRAINT "LayoutRevision_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LayoutEvent" ADD CONSTRAINT "LayoutEvent_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Area" ADD CONSTRAINT "Area_layout_valid" CHECK ("canvasWidth" BETWEEN 200 AND 10000 AND "canvasHeight" BETWEEN 200 AND 10000 AND "sortOrder" BETWEEN 0 AND 1000000 AND "version" > 0 AND ("deletedAt" IS NULL OR NOT active));
ALTER TABLE "RestaurantTable" ADD CONSTRAINT "RestaurantTable_geometry_valid" CHECK ("positionX" >= 0 AND "positionY" >= 0 AND width BETWEEN 44 AND 1000 AND height BETWEEN 44 AND 1000 AND "positionX" + width <= 10000 AND "positionY" + height <= 10000 AND (shape = 'RECTANGLE' OR width = height));
ALTER TABLE "RestaurantTable" ADD CONSTRAINT "RestaurantTable_lifecycle_valid" CHECK ("number" BETWEEN 1 AND 99999 AND capacity BETWEEN 1 AND 100 AND version > 0 AND (active = (status <> 'DISABLED')) AND ("deletedAt" IS NULL OR status = 'DISABLED'));
ALTER TABLE "LayoutRevision" ADD CONSTRAINT "LayoutRevision_nonnegative" CHECK (revision >= 0);
ALTER TABLE "LayoutEvent" ADD CONSTRAINT "LayoutEvent_version_valid" CHECK (revision > 0 AND "entityVersion" > 0);
CREATE FUNCTION reject_layout_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'LayoutEvent is append-only' USING ERRCODE = '42501';
END;
$$;
CREATE TRIGGER layout_event_no_change BEFORE UPDATE OR DELETE ON "LayoutEvent" FOR EACH ROW EXECUTE FUNCTION reject_layout_event_mutation();
CREATE TRIGGER layout_event_no_truncate BEFORE TRUNCATE ON "LayoutEvent" FOR EACH STATEMENT EXECUTE FUNCTION reject_layout_event_mutation();

INSERT INTO "Permission" ("key", description, "updatedAt") VALUES
('layout.read', 'layout: read', CURRENT_TIMESTAMP),
('layout.manage', 'layout: manage', CURRENT_TIMESTAMP),
('layout.status.manage', 'layout: status manage', CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;
DO $$
DECLARE r RECORD; before_keys JSONB; after_keys JSONB;
BEGIN
  FOR r IN SELECT * FROM "Role" WHERE name = 'OWNER' AND protected = true LOOP
    SELECT COALESCE(jsonb_agg("permissionKey" ORDER BY "permissionKey"), '[]'::jsonb) INTO before_keys FROM "RolePermission" WHERE "roleId" = r.id;
    INSERT INTO "RolePermission" ("roleId", "permissionKey") VALUES (r.id, 'layout.read'), (r.id, 'layout.manage'), (r.id, 'layout.status.manage') ON CONFLICT DO NOTHING;
    SELECT jsonb_agg("permissionKey" ORDER BY "permissionKey") INTO after_keys FROM "RolePermission" WHERE "roleId" = r.id;
    IF before_keys <> after_keys THEN
      INSERT INTO "AuditLog" (id, "organizationId", action, "entityType", "entityId", "beforeData", "afterData")
      VALUES (gen_random_uuid(), r."organizationId", 'role.permissions_migrated', 'Role', r.id::text,
        jsonb_build_object('permissions', before_keys),
        jsonb_build_object('permissions', after_keys, 'migration', '202609110002_layout'));
    END IF;
  END LOOP;
END $$;
COMMIT;
