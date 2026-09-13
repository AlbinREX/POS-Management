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
