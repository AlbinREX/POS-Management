BEGIN;

-- CreateEnum
CREATE TYPE "InventoryItemKind" AS ENUM ('INGREDIENT', 'STOCK_ITEM');

-- CreateEnum
CREATE TYPE "StockMovementKind" AS ENUM ('ADJUSTMENT', 'WASTE', 'SALE_CONSUMPTION');

-- CreateTable
CREATE TABLE "InventoryUnit" (
    "code" VARCHAR(3) NOT NULL,
    "dimension" VARCHAR(10) NOT NULL,
    "factor" INTEGER NOT NULL,

    CONSTRAINT "InventoryUnit_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "sku" VARCHAR(80) NOT NULL,
    "kind" "InventoryItemKind" NOT NULL,
    "unitCode" VARCHAR(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(1000) NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockPosition" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "lowStockThreshold" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "StockPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recipe" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Recipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeVersion" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "recipeId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "warehouseId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecipeVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeItem" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "recipeVersionId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecipeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryPlan" (
    "orderId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryPlan_pkey" PRIMARY KEY ("orderId")
);

-- CreateTable
CREATE TABLE "InventoryPlanItem" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "positionId" UUID NOT NULL,
    "recipeItemId" UUID NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "positionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "StockMovementKind" NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "enteredQuantity" VARCHAR(32) NOT NULL,
    "enteredUnit" VARCHAR(3) NOT NULL,
    "planItemId" UUID,
    "orderId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryRevision" (
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "revision" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "InventoryRevision_pkey" PRIMARY KEY ("branchId")
);

-- CreateTable
CREATE TABLE "InventoryEvent" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "commandId" UUID NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "entityId" UUID NOT NULL,
    "revision" BIGINT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryItem_branchId_organizationId_deletedAt_name_id_idx" ON "InventoryItem"("branchId", "organizationId", "deletedAt", "name", "id");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_id_branchId_organizationId_key" ON "InventoryItem"("id", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_branchId_sku_key" ON "InventoryItem"("branchId", "sku");

-- CreateIndex
CREATE INDEX "Warehouse_branchId_organizationId_deletedAt_id_idx" ON "Warehouse"("branchId", "organizationId", "deletedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_id_branchId_organizationId_key" ON "Warehouse"("id", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_branchId_name_key" ON "Warehouse"("branchId", "name");

-- CreateIndex
CREATE INDEX "StockPosition_itemId_branchId_organizationId_idx" ON "StockPosition"("itemId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "StockPosition_id_branchId_organizationId_key" ON "StockPosition"("id", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "StockPosition_warehouseId_itemId_branchId_organizationId_key" ON "StockPosition"("warehouseId", "itemId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Recipe_productId_key" ON "Recipe"("productId");

-- CreateIndex
CREATE INDEX "Recipe_branchId_organizationId_active_id_idx" ON "Recipe"("branchId", "organizationId", "active", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Recipe_productId_branchId_organizationId_key" ON "Recipe"("productId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Recipe_id_branchId_organizationId_key" ON "Recipe"("id", "branchId", "organizationId");

-- CreateIndex
CREATE INDEX "RecipeVersion_warehouseId_branchId_organizationId_idx" ON "RecipeVersion"("warehouseId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeVersion_id_branchId_organizationId_key" ON "RecipeVersion"("id", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeVersion_recipeId_version_key" ON "RecipeVersion"("recipeId", "version");

-- CreateIndex
CREATE INDEX "RecipeItem_itemId_branchId_organizationId_idx" ON "RecipeItem"("itemId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeItem_id_branchId_organizationId_key" ON "RecipeItem"("id", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeItem_recipeVersionId_itemId_key" ON "RecipeItem"("recipeVersionId", "itemId");

-- CreateIndex
CREATE INDEX "InventoryPlan_userId_branchId_organizationId_idx" ON "InventoryPlan"("userId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryPlan_orderId_branchId_organizationId_key" ON "InventoryPlan"("orderId", "branchId", "organizationId");

-- CreateIndex
CREATE INDEX "InventoryPlanItem_orderId_branchId_organizationId_idx" ON "InventoryPlanItem"("orderId", "branchId", "organizationId");

-- CreateIndex
CREATE INDEX "InventoryPlanItem_positionId_branchId_organizationId_idx" ON "InventoryPlanItem"("positionId", "branchId", "organizationId");

-- CreateIndex
CREATE INDEX "InventoryPlanItem_recipeItemId_branchId_organizationId_idx" ON "InventoryPlanItem"("recipeItemId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryPlanItem_id_branchId_organizationId_key" ON "InventoryPlanItem"("id", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryPlanItem_orderItemId_recipeItemId_key" ON "InventoryPlanItem"("orderItemId", "recipeItemId");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_planItemId_key" ON "StockMovement"("planItemId");

-- CreateIndex
CREATE INDEX "StockMovement_positionId_branchId_organizationId_createdAt__idx" ON "StockMovement"("positionId", "branchId", "organizationId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "StockMovement_branchId_organizationId_createdAt_id_idx" ON "StockMovement"("branchId", "organizationId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "StockMovement_userId_branchId_organizationId_idx" ON "StockMovement"("userId", "branchId", "organizationId");

-- CreateIndex
CREATE INDEX "StockMovement_orderId_branchId_organizationId_idx" ON "StockMovement"("orderId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_planItemId_branchId_organizationId_key" ON "StockMovement"("planItemId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryRevision_branchId_organizationId_key" ON "InventoryRevision"("branchId", "organizationId");

-- CreateIndex
CREATE INDEX "InventoryEvent_branchId_organizationId_revision_idx" ON "InventoryEvent"("branchId", "organizationId", "revision");

-- CreateIndex
CREATE INDEX "InventoryEvent_userId_branchId_organizationId_idx" ON "InventoryEvent"("userId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryEvent_branchId_commandId_key" ON "InventoryEvent"("branchId", "commandId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryEvent_branchId_revision_key" ON "InventoryEvent"("branchId", "revision");

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_unitCode_fkey" FOREIGN KEY ("unitCode") REFERENCES "InventoryUnit"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockPosition" ADD CONSTRAINT "StockPosition_warehouseId_branchId_organizationId_fkey" FOREIGN KEY ("warehouseId", "branchId", "organizationId") REFERENCES "Warehouse"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockPosition" ADD CONSTRAINT "StockPosition_itemId_branchId_organizationId_fkey" FOREIGN KEY ("itemId", "branchId", "organizationId") REFERENCES "InventoryItem"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_productId_branchId_organizationId_fkey" FOREIGN KEY ("productId", "branchId", "organizationId") REFERENCES "Product"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeVersion" ADD CONSTRAINT "RecipeVersion_recipeId_branchId_organizationId_fkey" FOREIGN KEY ("recipeId", "branchId", "organizationId") REFERENCES "Recipe"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeVersion" ADD CONSTRAINT "RecipeVersion_warehouseId_branchId_organizationId_fkey" FOREIGN KEY ("warehouseId", "branchId", "organizationId") REFERENCES "Warehouse"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeItem" ADD CONSTRAINT "RecipeItem_recipeVersionId_branchId_organizationId_fkey" FOREIGN KEY ("recipeVersionId", "branchId", "organizationId") REFERENCES "RecipeVersion"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeItem" ADD CONSTRAINT "RecipeItem_itemId_branchId_organizationId_fkey" FOREIGN KEY ("itemId", "branchId", "organizationId") REFERENCES "InventoryItem"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryPlan" ADD CONSTRAINT "InventoryPlan_orderId_branchId_organizationId_fkey" FOREIGN KEY ("orderId", "branchId", "organizationId") REFERENCES "OrderBill"("orderId", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryPlan" ADD CONSTRAINT "InventoryPlan_userId_branchId_organizationId_fkey" FOREIGN KEY ("userId", "branchId", "organizationId") REFERENCES "BranchMembership"("userId", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryPlanItem" ADD CONSTRAINT "InventoryPlanItem_orderId_branchId_organizationId_fkey" FOREIGN KEY ("orderId", "branchId", "organizationId") REFERENCES "InventoryPlan"("orderId", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryPlanItem" ADD CONSTRAINT "InventoryPlanItem_orderItemId_orderId_branchId_organizatio_fkey" FOREIGN KEY ("orderItemId", "orderId", "branchId", "organizationId") REFERENCES "OrderItem"("id", "orderId", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryPlanItem" ADD CONSTRAINT "InventoryPlanItem_positionId_branchId_organizationId_fkey" FOREIGN KEY ("positionId", "branchId", "organizationId") REFERENCES "StockPosition"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryPlanItem" ADD CONSTRAINT "InventoryPlanItem_recipeItemId_branchId_organizationId_fkey" FOREIGN KEY ("recipeItemId", "branchId", "organizationId") REFERENCES "RecipeItem"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_positionId_branchId_organizationId_fkey" FOREIGN KEY ("positionId", "branchId", "organizationId") REFERENCES "StockPosition"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_userId_branchId_organizationId_fkey" FOREIGN KEY ("userId", "branchId", "organizationId") REFERENCES "BranchMembership"("userId", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_planItemId_branchId_organizationId_fkey" FOREIGN KEY ("planItemId", "branchId", "organizationId") REFERENCES "InventoryPlanItem"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_orderId_branchId_organizationId_fkey" FOREIGN KEY ("orderId", "branchId", "organizationId") REFERENCES "OrderSettlement"("orderId", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryRevision" ADD CONSTRAINT "InventoryRevision_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryEvent" ADD CONSTRAINT "InventoryEvent_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryEvent" ADD CONSTRAINT "InventoryEvent_userId_branchId_organizationId_fkey" FOREIGN KEY ("userId", "branchId", "organizationId") REFERENCES "BranchMembership"("userId", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "InventoryUnit" (code,dimension,factor) VALUES ('kg','MASS',1000),('g','MASS',1),('l','VOLUME',1000),('ml','VOLUME',1),('pcs','COUNT',1);
ALTER TABLE "InventoryUnit" ADD CONSTRAINT inventory_known_units CHECK ((code,dimension,factor) IN (('kg','MASS',1000),('g','MASS',1),('l','VOLUME',1000),('ml','VOLUME',1),('pcs','COUNT',1)));
ALTER TABLE "InventoryItem" ADD CONSTRAINT inventory_item_valid CHECK (version>0 AND length(trim(name))>0 AND length(trim(sku))>0 AND ("deletedAt" IS NULL OR NOT active));
ALTER TABLE "Warehouse" ADD CONSTRAINT inventory_warehouse_valid CHECK (version>0 AND length(trim(name))>0 AND ("deletedAt" IS NULL OR NOT active));
ALTER TABLE "StockPosition" ADD CONSTRAINT stock_threshold_valid CHECK (version>0 AND "lowStockThreshold">=0);
ALTER TABLE "Recipe" ADD CONSTRAINT recipe_version_positive CHECK (version>0);
ALTER TABLE "RecipeVersion" ADD CONSTRAINT recipe_revision_positive CHECK (version>0);
ALTER TABLE "RecipeItem" ADD CONSTRAINT recipe_quantity_positive CHECK (quantity>0);
ALTER TABLE "InventoryPlanItem" ADD CONSTRAINT plan_quantity_positive CHECK (quantity>0);
ALTER TABLE "StockMovement" ADD CONSTRAINT stock_movement_valid CHECK (quantity<>0 AND length(trim(reason))>0 AND "enteredUnit" IN ('kg','g','l','ml','pcs') AND ((kind='ADJUSTMENT' AND "planItemId" IS NULL AND "orderId" IS NULL) OR (kind='WASTE' AND quantity<0 AND "planItemId" IS NULL AND "orderId" IS NULL) OR (kind='SALE_CONSUMPTION' AND quantity<0 AND "planItemId" IS NOT NULL AND "orderId" IS NOT NULL)));

CREATE FUNCTION reject_inventory_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Inventory history is immutable' USING ERRCODE='42501'; END; $$;
DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['InventoryUnit','RecipeVersion','RecipeItem','InventoryPlan','InventoryPlanItem','StockMovement','InventoryEvent'] LOOP
  EXECUTE format('CREATE TRIGGER inventory_no_change BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_inventory_mutation()',t);
  EXECUTE format('CREATE TRIGGER inventory_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION reject_inventory_mutation()',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['InventoryItem','Warehouse','Recipe','StockPosition'] LOOP
  EXECUTE format('CREATE TRIGGER inventory_no_delete BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_inventory_mutation()',t);
  EXECUTE format('CREATE TRIGGER inventory_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION reject_inventory_mutation()',t);
 END LOOP;
END $$;

CREATE FUNCTION guard_inventory_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (NEW.id,NEW."branchId",NEW."organizationId",NEW."createdAt") IS DISTINCT FROM (OLD.id,OLD."branchId",OLD."organizationId",OLD."createdAt") OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Inventory identity/version is immutable' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='InventoryItem' THEN
  IF (NEW."unitCode",NEW.sku,NEW.kind) IS DISTINCT FROM (OLD."unitCode",OLD.sku,OLD.kind) OR OLD."deletedAt" IS NOT NULL THEN RAISE EXCEPTION 'Inventory stock unit and historical identity are immutable' USING ERRCODE='42501'; END IF;
 ELSIF TG_TABLE_NAME='Warehouse' THEN
  IF OLD."deletedAt" IS NOT NULL THEN RAISE EXCEPTION 'Archived warehouse is immutable' USING ERRCODE='42501'; END IF;
 ELSIF TG_TABLE_NAME='Recipe' THEN
  IF NEW."productId"<>OLD."productId" THEN RAISE EXCEPTION 'Recipe product is immutable' USING ERRCODE='42501'; END IF;
 ELSIF TG_TABLE_NAME='StockPosition' THEN
  IF (NEW."warehouseId",NEW."itemId") IS DISTINCT FROM (OLD."warehouseId",OLD."itemId") THEN RAISE EXCEPTION 'Stock identity is immutable' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t TEXT; BEGIN FOREACH t IN ARRAY ARRAY['InventoryItem','Warehouse','Recipe','StockPosition'] LOOP
 EXECUTE format('CREATE TRIGGER inventory_identity BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION guard_inventory_identity()',t);
END LOOP; END $$;

CREATE FUNCTION guard_inventory_plan_line() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE r RECORD; BEGIN
 SELECT ri.quantity AS per_product, oi.quantity AS product_quantity, oi."voidedAt", sp."itemId" AS stock_item, ri."itemId" AS recipe_item, sp."warehouseId" AS stock_warehouse, rv."warehouseId" AS recipe_warehouse, recipe."productId" AS recipe_product, oi."productId" AS order_product, plan.xmin::text AS created_tx INTO r
 FROM "InventoryPlan" plan JOIN "OrderItem" oi ON oi.id=NEW."orderItemId" AND oi."orderId"=plan."orderId"
 JOIN "RecipeItem" ri ON ri.id=NEW."recipeItemId" JOIN "RecipeVersion" rv ON rv.id=ri."recipeVersionId"
 JOIN "Recipe" recipe ON recipe.id=rv."recipeId" JOIN "StockPosition" sp ON sp.id=NEW."positionId" WHERE plan."orderId"=NEW."orderId";
 IF NOT FOUND OR r.created_tx<>(txid_current()%4294967296)::text OR r."voidedAt" IS NOT NULL OR r.stock_item<>r.recipe_item OR r.stock_warehouse<>r.recipe_warehouse OR r.recipe_product<>r.order_product OR NEW.quantity<>r.per_product*r.product_quantity THEN RAISE EXCEPTION 'Inventory plan must match the frozen order and recipe' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER inventory_plan_line_insert BEFORE INSERT ON "InventoryPlanItem" FOR EACH ROW EXECUTE FUNCTION guard_inventory_plan_line();

CREATE FUNCTION guard_recipe_line_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM "RecipeVersion" WHERE id=NEW."recipeVersionId" AND xmin::text=(txid_current()%4294967296)::text) THEN RAISE EXCEPTION 'Cannot append to a committed recipe version' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recipe_line_insert BEFORE INSERT ON "RecipeItem" FOR EACH ROW EXECUTE FUNCTION guard_recipe_line_insert();

CREATE FUNCTION check_recipe_complete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM "RecipeVersion" rv JOIN "RecipeItem" ri ON ri."recipeVersionId"=rv.id WHERE rv."recipeId"=NEW.id AND rv.version=NEW.version) THEN RAISE EXCEPTION 'Recipe revision must contain ingredients' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER recipe_complete AFTER INSERT OR UPDATE ON "Recipe" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_recipe_complete();

CREATE FUNCTION guard_sale_stock_movement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.kind='SALE_CONSUMPTION' AND NOT EXISTS (SELECT 1 FROM "InventoryPlanItem" WHERE id=NEW."planItemId" AND "orderId"=NEW."orderId" AND "positionId"=NEW."positionId" AND quantity=-NEW.quantity) THEN RAISE EXCEPTION 'Sale movement must match inventory plan' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sale_stock_source BEFORE INSERT ON "StockMovement" FOR EACH ROW EXECUTE FUNCTION guard_sale_stock_movement();

CREATE FUNCTION check_inventory_settlement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM "InventoryPlan" WHERE "orderId"=NEW."orderId") OR EXISTS (SELECT 1 FROM "InventoryPlanItem" line LEFT JOIN "StockMovement" movement ON movement."planItemId"=line.id WHERE line."orderId"=NEW."orderId" AND movement.id IS NULL) THEN RAISE EXCEPTION 'Settlement requires complete inventory consumption' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER settlement_inventory_complete AFTER INSERT ON "OrderSettlement" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_inventory_settlement();

ALTER TABLE "StockMovement" ADD COLUMN snapshot JSONB NOT NULL;
ALTER TABLE "StockMovement" ADD CONSTRAINT stock_snapshot_valid CHECK (jsonb_typeof(snapshot->'ingredientName')='string' AND snapshot ? 'ingredientName' AND jsonb_typeof(snapshot->'warehouseName')='string' AND snapshot ? 'warehouseName' AND snapshot ? 'unitCode' AND snapshot->>'unitCode' IN ('kg','g','l','ml','pcs'));

CREATE FUNCTION check_inventory_plan_complete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS (
  SELECT 1 FROM "OrderItem" oi JOIN "Recipe" r ON r."productId"=oi."productId" AND r.active
  JOIN "RecipeVersion" rv ON rv."recipeId"=r.id AND rv.version=r.version
  JOIN "RecipeItem" ri ON ri."recipeVersionId"=rv.id
  WHERE oi."orderId"=NEW."orderId" AND oi."voidedAt" IS NULL AND NOT EXISTS
   (SELECT 1 FROM "InventoryPlanItem" line WHERE line."orderId"=NEW."orderId" AND line."orderItemId"=oi.id AND line."recipeItemId"=ri.id)
 ) THEN RAISE EXCEPTION 'Inventory plan is missing recipe ingredients' USING ERRCODE='23514'; END IF;
 IF EXISTS (
  SELECT 1 FROM "InventoryPlanItem" line JOIN "RecipeItem" ri ON ri.id=line."recipeItemId"
  JOIN "RecipeVersion" rv ON rv.id=ri."recipeVersionId" JOIN "Recipe" r ON r.id=rv."recipeId"
  WHERE line."orderId"=NEW."orderId" AND (NOT r.active OR rv.version<>r.version)
 ) THEN RAISE EXCEPTION 'Inventory plan must use the active recipe revision at freeze time' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER inventory_plan_complete AFTER INSERT ON "InventoryPlan" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_inventory_plan_complete();

INSERT INTO "Permission" ("key",description,"updatedAt") VALUES ('inventory.read','inventory read',CURRENT_TIMESTAMP),('inventory.manage','inventory configuration',CURRENT_TIMESTAMP),('inventory.adjust','inventory adjustment',CURRENT_TIMESTAMP),('inventory.waste','inventory waste',CURRENT_TIMESTAMP),('recipe.manage','recipe management',CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;
DO $$ DECLARE r RECORD; before_keys JSONB; after_keys JSONB; BEGIN
 FOR r IN SELECT * FROM "Role" WHERE name='OWNER' AND protected=true LOOP
 SELECT COALESCE(jsonb_agg("permissionKey" ORDER BY "permissionKey"),'[]'::jsonb) INTO before_keys FROM "RolePermission" WHERE "roleId"=r.id;
 INSERT INTO "RolePermission" ("roleId","permissionKey") SELECT r.id,key FROM "Permission" WHERE key IN ('inventory.read','inventory.manage','inventory.adjust','inventory.waste','recipe.manage') ON CONFLICT DO NOTHING;
 SELECT jsonb_agg("permissionKey" ORDER BY "permissionKey") INTO after_keys FROM "RolePermission" WHERE "roleId"=r.id;
 IF before_keys<>after_keys THEN INSERT INTO "AuditLog" (id,"organizationId",action,"entityType","entityId","beforeData","afterData") VALUES (gen_random_uuid(),r."organizationId",'role.permissions_migrated','Role',r.id::text,jsonb_build_object('permissions',before_keys),jsonb_build_object('permissions',after_keys,'migration','202609130001_inventory')); END IF;
 END LOOP;
END $$;
COMMIT;
