-- CreateEnum
BEGIN;
CREATE TYPE "PriceTaxMode" AS ENUM ('INCLUSIVE', 'EXCLUSIVE');

-- CreateTable
CREATE TABLE "Category" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(2000),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KitchenStation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(2000),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "KitchenStation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModifierGroup" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(2000),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),
    "minSelections" INTEGER NOT NULL DEFAULT 0,
    "maxSelections" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ModifierGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Modifier" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(2000),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),
    "groupId" UUID NOT NULL,
    "priceAdjustment" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "Modifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(2000),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),
    "sku" VARCHAR(80) NOT NULL,
    "barcode" VARCHAR(80),
    "categoryId" UUID NOT NULL,
    "sellingPrice" DECIMAL(14,2) NOT NULL,
    "taxRate" DECIMAL(5,2) NOT NULL,
    "taxMode" "PriceTaxMode" NOT NULL,
    "imageUrl" VARCHAR(2048),

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductModifierGroup" (
    "productId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductModifierGroup_pkey" PRIMARY KEY ("productId","groupId")
);

-- CreateTable
CREATE TABLE "ProductKitchenStation" (
    "productId" UUID NOT NULL,
    "stationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductKitchenStation_pkey" PRIMARY KEY ("productId","stationId")
);

-- CreateIndex
CREATE INDEX "Category_branchId_organizationId_deletedAt_sortOrder_id_idx" ON "Category"("branchId", "organizationId", "deletedAt", "sortOrder", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Category_branchId_name_key" ON "Category"("branchId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Category_id_branchId_organizationId_key" ON "Category"("id", "branchId", "organizationId");

-- CreateIndex
CREATE INDEX "KitchenStation_branchId_organizationId_deletedAt_sortOrder__idx" ON "KitchenStation"("branchId", "organizationId", "deletedAt", "sortOrder", "id");

-- CreateIndex
CREATE UNIQUE INDEX "KitchenStation_branchId_name_key" ON "KitchenStation"("branchId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "KitchenStation_id_branchId_organizationId_key" ON "KitchenStation"("id", "branchId", "organizationId");

-- CreateIndex
CREATE INDEX "ModifierGroup_branchId_organizationId_deletedAt_sortOrder_i_idx" ON "ModifierGroup"("branchId", "organizationId", "deletedAt", "sortOrder", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ModifierGroup_branchId_name_key" ON "ModifierGroup"("branchId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ModifierGroup_id_branchId_organizationId_key" ON "ModifierGroup"("id", "branchId", "organizationId");

-- CreateIndex
CREATE INDEX "Modifier_groupId_branchId_organizationId_idx" ON "Modifier"("groupId", "branchId", "organizationId");

-- CreateIndex
CREATE INDEX "Modifier_branchId_organizationId_deletedAt_sortOrder_id_idx" ON "Modifier"("branchId", "organizationId", "deletedAt", "sortOrder", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Modifier_groupId_name_key" ON "Modifier"("groupId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Modifier_id_branchId_organizationId_key" ON "Modifier"("id", "branchId", "organizationId");

-- CreateIndex
CREATE INDEX "Product_categoryId_branchId_organizationId_idx" ON "Product"("categoryId", "branchId", "organizationId");

-- CreateIndex
CREATE INDEX "Product_branchId_organizationId_deletedAt_sortOrder_id_idx" ON "Product"("branchId", "organizationId", "deletedAt", "sortOrder", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Product_branchId_sku_key" ON "Product"("branchId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "Product_branchId_barcode_key" ON "Product"("branchId", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "Product_id_branchId_organizationId_key" ON "Product"("id", "branchId", "organizationId");

-- CreateIndex
CREATE INDEX "ProductModifierGroup_groupId_branchId_organizationId_idx" ON "ProductModifierGroup"("groupId", "branchId", "organizationId");

-- CreateIndex
CREATE INDEX "ProductKitchenStation_stationId_branchId_organizationId_idx" ON "ProductKitchenStation"("stationId", "branchId", "organizationId");

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenStation" ADD CONSTRAINT "KitchenStation_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModifierGroup" ADD CONSTRAINT "ModifierGroup_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Modifier" ADD CONSTRAINT "Modifier_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Modifier" ADD CONSTRAINT "Modifier_groupId_branchId_organizationId_fkey" FOREIGN KEY ("groupId", "branchId", "organizationId") REFERENCES "ModifierGroup"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_branchId_organizationId_fkey" FOREIGN KEY ("categoryId", "branchId", "organizationId") REFERENCES "Category"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductModifierGroup" ADD CONSTRAINT "ProductModifierGroup_productId_branchId_organizationId_fkey" FOREIGN KEY ("productId", "branchId", "organizationId") REFERENCES "Product"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductModifierGroup" ADD CONSTRAINT "ProductModifierGroup_groupId_branchId_organizationId_fkey" FOREIGN KEY ("groupId", "branchId", "organizationId") REFERENCES "ModifierGroup"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductKitchenStation" ADD CONSTRAINT "ProductKitchenStation_productId_branchId_organizationId_fkey" FOREIGN KEY ("productId", "branchId", "organizationId") REFERENCES "Product"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductKitchenStation" ADD CONSTRAINT "ProductKitchenStation_stationId_branchId_organizationId_fkey" FOREIGN KEY ("stationId", "branchId", "organizationId") REFERENCES "KitchenStation"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Catalog invariants also apply to non-HTTP database clients.
ALTER TABLE "Product" ADD CONSTRAINT "Product_price_tax_valid" CHECK ("sellingPrice" >= 0 AND "taxRate" BETWEEN 0 AND 100);
ALTER TABLE "ModifierGroup" ADD CONSTRAINT "ModifierGroup_selection_valid" CHECK ("minSelections" >= 0 AND "maxSelections" BETWEEN 1 AND 100 AND "minSelections" <= "maxSelections");
ALTER TABLE "Category" ADD CONSTRAINT "Category_lifecycle_valid" CHECK ("version" > 0 AND "sortOrder" BETWEEN 0 AND 1000000 AND ("deletedAt" IS NULL OR NOT "active"));
ALTER TABLE "Product" ADD CONSTRAINT "Product_lifecycle_valid" CHECK ("version" > 0 AND "sortOrder" BETWEEN 0 AND 1000000 AND ("deletedAt" IS NULL OR NOT "active"));
ALTER TABLE "ModifierGroup" ADD CONSTRAINT "ModifierGroup_lifecycle_valid" CHECK ("version" > 0 AND "sortOrder" BETWEEN 0 AND 1000000 AND ("deletedAt" IS NULL OR NOT "active"));
ALTER TABLE "Modifier" ADD CONSTRAINT "Modifier_lifecycle_valid" CHECK ("version" > 0 AND "sortOrder" BETWEEN 0 AND 1000000 AND ("deletedAt" IS NULL OR NOT "active"));
ALTER TABLE "KitchenStation" ADD CONSTRAINT "KitchenStation_lifecycle_valid" CHECK ("version" > 0 AND "sortOrder" BETWEEN 0 AND 1000000 AND ("deletedAt" IS NULL OR NOT "active"));

-- Upgrade only protected OWNER. Existing customized roles require an explicit owner grant.
INSERT INTO "Permission" ("key", "description", "updatedAt") VALUES
('menu.read', 'menu: read', CURRENT_TIMESTAMP),
('menu.manage', 'menu: manage', CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;
DO $$
DECLARE r RECORD; before_keys JSONB; after_keys JSONB;
BEGIN
  FOR r IN SELECT * FROM "Role" WHERE name = 'OWNER' AND protected = true LOOP
    SELECT COALESCE(jsonb_agg("permissionKey" ORDER BY "permissionKey"), '[]'::jsonb) INTO before_keys FROM "RolePermission" WHERE "roleId" = r.id;
    INSERT INTO "RolePermission" ("roleId", "permissionKey") VALUES (r.id, 'menu.read'), (r.id, 'menu.manage') ON CONFLICT DO NOTHING;
    SELECT jsonb_agg("permissionKey" ORDER BY "permissionKey") INTO after_keys FROM "RolePermission" WHERE "roleId" = r.id;
    IF before_keys <> after_keys THEN
      INSERT INTO "AuditLog" (id, "organizationId", action, "entityType", "entityId", "beforeData", "afterData")
      VALUES (gen_random_uuid(), r."organizationId", 'role.permissions_migrated', 'Role', r.id::text,
        jsonb_build_object('permissions', before_keys),
        jsonb_build_object('permissions', after_keys, 'migration', '202609110001_menu'));
    END IF;
  END LOOP;
END $$;
COMMIT;
