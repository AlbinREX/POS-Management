BEGIN;
-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SupplierEntryKind" AS ENUM ('CHARGE', 'PAYMENT', 'PAYMENT_REVERSAL');

-- AlterEnum
ALTER TYPE "StockMovementKind" ADD VALUE 'PURCHASE';

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "receiptItemId" UUID;

-- CreateTable
CREATE TABLE "Supplier" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "businessNumber" VARCHAR(80) NOT NULL DEFAULT '',
    "taxNumber" VARCHAR(80) NOT NULL DEFAULT '',
    "contactPerson" VARCHAR(160) NOT NULL DEFAULT '',
    "phone" VARCHAR(60) NOT NULL DEFAULT '',
    "email" VARCHAR(254) NOT NULL DEFAULT '',
    "address" VARCHAR(500) NOT NULL DEFAULT '',
    "notes" VARCHAR(2000) NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "number" BIGINT NOT NULL,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" CHAR(3) NOT NULL,
    "reference" VARCHAR(120) NOT NULL DEFAULT '',
    "notes" VARCHAR(2000) NOT NULL DEFAULT '',
    "expectedDate" DATE,
    "supplierSnapshot" JSONB NOT NULL,
    "warehouseName" VARCHAR(160) NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "tax" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "orderedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "cancellationReason" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseItem" (
    "id" UUID NOT NULL,
    "purchaseOrderId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "itemName" VARCHAR(160) NOT NULL,
    "sku" VARCHAR(80) NOT NULL,
    "stockUnit" VARCHAR(3) NOT NULL,
    "unitCode" VARCHAR(3) NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "stockQuantity" DECIMAL(20,6) NOT NULL,
    "unitPrice" DECIMAL(14,4) NOT NULL,
    "taxRate" DECIMAL(5,2) NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "tax" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "voidedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "id" UUID NOT NULL,
    "purchaseOrderId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "receivedBy" UUID NOT NULL,
    "reference" VARCHAR(120) NOT NULL,
    "invoiceNumber" VARCHAR(120),
    "invoiceDate" DATE,
    "dueDate" DATE,
    "documentReference" VARCHAR(1000) NOT NULL DEFAULT '',
    "notes" VARCHAR(2000) NOT NULL DEFAULT '',
    "currency" CHAR(3) NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "tax" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceiptItem" (
    "id" UUID NOT NULL,
    "receiptId" UUID NOT NULL,
    "purchaseOrderId" UUID NOT NULL,
    "purchaseItemId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "stockQuantity" DECIMAL(20,6) NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "tax" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoodsReceiptItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierEntry" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "receiptId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "SupplierEntryKind" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" VARCHAR(20),
    "reference" VARCHAR(120),
    "reason" VARCHAR(500) NOT NULL,
    "reversesId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchasingRevision" (
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "revision" BIGINT NOT NULL DEFAULT 0,
    "nextNumber" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PurchasingRevision_pkey" PRIMARY KEY ("branchId")
);

-- CreateTable
CREATE TABLE "PurchasingEvent" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "commandId" UUID NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "revision" BIGINT NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "entityId" UUID NOT NULL,
    "supplierId" UUID,
    "purchaseOrderId" UUID,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchasingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Supplier_branchId_organizationId_deletedAt_name_id_idx" ON "Supplier"("branchId", "organizationId", "deletedAt", "name", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_id_branchId_organizationId_key" ON "Supplier"("id", "branchId", "organizationId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_branchId_organizationId_status_createdAt_id_idx" ON "PurchaseOrder"("branchId", "organizationId", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplierId_branchId_organizationId_idx" ON "PurchaseOrder"("supplierId", "branchId", "organizationId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_warehouseId_branchId_organizationId_idx" ON "PurchaseOrder"("warehouseId", "branchId", "organizationId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_userId_branchId_organizationId_idx" ON "PurchaseOrder"("userId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_id_branchId_organizationId_key" ON "PurchaseOrder"("id", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_id_supplierId_branchId_organizationId_key" ON "PurchaseOrder"("id", "supplierId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_branchId_number_key" ON "PurchaseOrder"("branchId", "number");

-- CreateIndex
CREATE INDEX "PurchaseItem_purchaseOrderId_branchId_organizationId_idx" ON "PurchaseItem"("purchaseOrderId", "branchId", "organizationId");

-- CreateIndex
CREATE INDEX "PurchaseItem_itemId_branchId_organizationId_idx" ON "PurchaseItem"("itemId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseItem_id_branchId_organizationId_key" ON "PurchaseItem"("id", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseItem_id_purchaseOrderId_branchId_organizationId_key" ON "PurchaseItem"("id", "purchaseOrderId", "branchId", "organizationId");

-- CreateIndex
CREATE INDEX "GoodsReceipt_purchaseOrderId_branchId_organizationId_idx" ON "GoodsReceipt"("purchaseOrderId", "branchId", "organizationId");

-- CreateIndex
CREATE INDEX "GoodsReceipt_branchId_organizationId_createdAt_id_idx" ON "GoodsReceipt"("branchId", "organizationId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "GoodsReceipt_receivedBy_branchId_organizationId_idx" ON "GoodsReceipt"("receivedBy", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_id_branchId_organizationId_key" ON "GoodsReceipt"("id", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_id_purchaseOrderId_branchId_organizationId_key" ON "GoodsReceipt"("id", "purchaseOrderId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_id_supplierId_branchId_organizationId_key" ON "GoodsReceipt"("id", "supplierId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_branchId_supplierId_reference_key" ON "GoodsReceipt"("branchId", "supplierId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_branchId_supplierId_invoiceNumber_key" ON "GoodsReceipt"("branchId", "supplierId", "invoiceNumber");

-- CreateIndex
CREATE INDEX "GoodsReceiptItem_purchaseItemId_purchaseOrderId_branchId_or_idx" ON "GoodsReceiptItem"("purchaseItemId", "purchaseOrderId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceiptItem_id_branchId_organizationId_key" ON "GoodsReceiptItem"("id", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceiptItem_receiptId_purchaseItemId_key" ON "GoodsReceiptItem"("receiptId", "purchaseItemId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierEntry_reversesId_key" ON "SupplierEntry"("reversesId");

-- CreateIndex
CREATE INDEX "SupplierEntry_supplierId_branchId_organizationId_createdAt__idx" ON "SupplierEntry"("supplierId", "branchId", "organizationId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "SupplierEntry_receiptId_branchId_organizationId_idx" ON "SupplierEntry"("receiptId", "branchId", "organizationId");

-- CreateIndex
CREATE INDEX "SupplierEntry_userId_branchId_organizationId_idx" ON "SupplierEntry"("userId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierEntry_id_branchId_organizationId_key" ON "SupplierEntry"("id", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierEntry_reversesId_branchId_organizationId_key" ON "SupplierEntry"("reversesId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchasingRevision_branchId_organizationId_key" ON "PurchasingRevision"("branchId", "organizationId");

-- CreateIndex
CREATE INDEX "PurchasingEvent_branchId_organizationId_revision_idx" ON "PurchasingEvent"("branchId", "organizationId", "revision");

-- CreateIndex
CREATE INDEX "PurchasingEvent_purchaseOrderId_branchId_organizationId_idx" ON "PurchasingEvent"("purchaseOrderId", "branchId", "organizationId");

-- CreateIndex
CREATE INDEX "PurchasingEvent_supplierId_branchId_organizationId_idx" ON "PurchasingEvent"("supplierId", "branchId", "organizationId");

-- CreateIndex
CREATE INDEX "PurchasingEvent_userId_branchId_organizationId_idx" ON "PurchasingEvent"("userId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchasingEvent_branchId_commandId_key" ON "PurchasingEvent"("branchId", "commandId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchasingEvent_branchId_revision_key" ON "PurchasingEvent"("branchId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_receiptItemId_key" ON "StockMovement"("receiptItemId");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_receiptItemId_branchId_organizationId_key" ON "StockMovement"("receiptItemId", "branchId", "organizationId");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_receiptItemId_branchId_organizationId_fkey" FOREIGN KEY ("receiptItemId", "branchId", "organizationId") REFERENCES "GoodsReceiptItem"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_branchId_organizationId_fkey" FOREIGN KEY ("supplierId", "branchId", "organizationId") REFERENCES "Supplier"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_warehouseId_branchId_organizationId_fkey" FOREIGN KEY ("warehouseId", "branchId", "organizationId") REFERENCES "Warehouse"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_userId_branchId_organizationId_fkey" FOREIGN KEY ("userId", "branchId", "organizationId") REFERENCES "BranchMembership"("userId", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_purchaseOrderId_branchId_organizationId_fkey" FOREIGN KEY ("purchaseOrderId", "branchId", "organizationId") REFERENCES "PurchaseOrder"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_itemId_branchId_organizationId_fkey" FOREIGN KEY ("itemId", "branchId", "organizationId") REFERENCES "InventoryItem"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_purchaseOrderId_supplierId_branchId_organizat_fkey" FOREIGN KEY ("purchaseOrderId", "supplierId", "branchId", "organizationId") REFERENCES "PurchaseOrder"("id", "supplierId", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_receivedBy_branchId_organizationId_fkey" FOREIGN KEY ("receivedBy", "branchId", "organizationId") REFERENCES "BranchMembership"("userId", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptItem" ADD CONSTRAINT "GoodsReceiptItem_receiptId_purchaseOrderId_branchId_organi_fkey" FOREIGN KEY ("receiptId", "purchaseOrderId", "branchId", "organizationId") REFERENCES "GoodsReceipt"("id", "purchaseOrderId", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptItem" ADD CONSTRAINT "GoodsReceiptItem_purchaseItemId_purchaseOrderId_branchId_o_fkey" FOREIGN KEY ("purchaseItemId", "purchaseOrderId", "branchId", "organizationId") REFERENCES "PurchaseItem"("id", "purchaseOrderId", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierEntry" ADD CONSTRAINT "SupplierEntry_receiptId_supplierId_branchId_organizationId_fkey" FOREIGN KEY ("receiptId", "supplierId", "branchId", "organizationId") REFERENCES "GoodsReceipt"("id", "supplierId", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierEntry" ADD CONSTRAINT "SupplierEntry_userId_branchId_organizationId_fkey" FOREIGN KEY ("userId", "branchId", "organizationId") REFERENCES "BranchMembership"("userId", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierEntry" ADD CONSTRAINT "SupplierEntry_reversesId_branchId_organizationId_fkey" FOREIGN KEY ("reversesId", "branchId", "organizationId") REFERENCES "SupplierEntry"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchasingRevision" ADD CONSTRAINT "PurchasingRevision_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchasingEvent" ADD CONSTRAINT "PurchasingEvent_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchasingEvent" ADD CONSTRAINT "PurchasingEvent_userId_branchId_organizationId_fkey" FOREIGN KEY ("userId", "branchId", "organizationId") REFERENCES "BranchMembership"("userId", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockMovement" DROP CONSTRAINT stock_movement_valid;
ALTER TABLE "StockMovement" ADD CONSTRAINT stock_movement_valid CHECK (quantity<>0 AND length(trim(reason))>0 AND "enteredUnit" IN ('kg','g','l','ml','pcs') AND (
 (kind::text='ADJUSTMENT' AND "planItemId" IS NULL AND "orderId" IS NULL AND "receiptItemId" IS NULL) OR
 (kind::text='WASTE' AND quantity<0 AND "planItemId" IS NULL AND "orderId" IS NULL AND "receiptItemId" IS NULL) OR
 (kind::text='SALE_CONSUMPTION' AND quantity<0 AND "planItemId" IS NOT NULL AND "orderId" IS NOT NULL AND "receiptItemId" IS NULL) OR
 (kind::text='PURCHASE' AND quantity>0 AND "planItemId" IS NULL AND "orderId" IS NULL AND "receiptItemId" IS NOT NULL)));
ALTER TABLE "Supplier" ADD CONSTRAINT supplier_valid CHECK (length(trim(name))>0 AND version>0 AND ("deletedAt" IS NULL OR NOT active));
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT purchase_valid CHECK (number>0 AND version>0 AND subtotal>=0 AND tax>=0 AND total=subtotal+tax AND ("supplierSnapshot" ? 'name') AND length("supplierSnapshot"->>'name')>0 AND ((status='CANCELLED' AND "cancelledAt" IS NOT NULL AND "cancellationReason" IS NOT NULL AND length(trim("cancellationReason"))>0) OR (status<>'CANCELLED' AND "cancelledAt" IS NULL AND "cancellationReason" IS NULL)) AND (status IN ('DRAFT','CANCELLED') OR "orderedAt" IS NOT NULL));
ALTER TABLE "PurchaseItem" ADD CONSTRAINT purchase_item_valid CHECK (quantity>0 AND "stockQuantity">0 AND "unitPrice">=0 AND "taxRate" BETWEEN 0 AND 100 AND subtotal=round(quantity*"unitPrice",2) AND tax=round(subtotal*"taxRate"/100,2) AND total=subtotal+tax AND length(trim("itemName"))>0);
CREATE UNIQUE INDEX purchase_active_item ON "PurchaseItem" ("purchaseOrderId","itemId") WHERE "voidedAt" IS NULL;
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT receipt_valid CHECK (length(trim(reference))>0 AND subtotal>=0 AND tax>=0 AND total=subtotal+tax AND (("invoiceNumber" IS NULL AND "invoiceDate" IS NULL) OR ("invoiceNumber" IS NOT NULL AND length(trim("invoiceNumber"))>0 AND "invoiceDate" IS NOT NULL)) AND ("dueDate" IS NULL OR "invoiceDate" IS NULL OR "dueDate">="invoiceDate"));
ALTER TABLE "GoodsReceiptItem" ADD CONSTRAINT receipt_item_valid CHECK (quantity>0 AND "stockQuantity">0 AND subtotal>=0 AND tax>=0 AND total=subtotal+tax);
CREATE UNIQUE INDEX receipt_supplier_reference ON "GoodsReceipt" ("branchId","supplierId",upper(trim(reference)));
CREATE UNIQUE INDEX receipt_supplier_invoice ON "GoodsReceipt" ("branchId","supplierId",upper(trim("invoiceNumber"))) WHERE "invoiceNumber" IS NOT NULL;
ALTER TABLE "SupplierEntry" ADD CONSTRAINT supplier_entry_valid CHECK (length(trim(reason))>0 AND (
 (kind='CHARGE' AND amount>=0 AND method IS NULL AND reference IS NULL AND "reversesId" IS NULL) OR
 (kind='PAYMENT' AND amount<0 AND method IS NOT NULL AND reference IS NOT NULL AND method IN ('BANK_TRANSFER','CASH','CARD','OTHER') AND length(trim(reference))>0 AND "reversesId" IS NULL) OR
 (kind='PAYMENT_REVERSAL' AND amount>0 AND method IS NULL AND reference IS NULL AND "reversesId" IS NOT NULL)));
CREATE UNIQUE INDEX receipt_one_charge ON "SupplierEntry" ("receiptId") WHERE kind='CHARGE';
CREATE UNIQUE INDEX supplier_payment_reference ON "SupplierEntry" ("branchId","supplierId",upper(trim(reference))) WHERE kind='PAYMENT';
ALTER TABLE "PurchasingRevision" ADD CONSTRAINT purchasing_revision_valid CHECK (revision>=0 AND "nextNumber">=0);
ALTER TABLE "PurchasingEvent" ADD CONSTRAINT purchasing_event_valid CHECK (revision>0 AND "requestHash" ~ '^[0-9a-f]{64}$');
DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['GoodsReceipt','GoodsReceiptItem','SupplierEntry','PurchasingEvent'] LOOP
  EXECUTE format('CREATE TRIGGER purchasing_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_inventory_mutation()',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['Supplier','PurchaseOrder','PurchaseItem'] LOOP
  EXECUTE format('CREATE TRIGGER purchasing_no_delete BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_inventory_mutation()',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['Supplier','PurchaseOrder','PurchaseItem','GoodsReceipt','GoodsReceiptItem','SupplierEntry','PurchasingEvent'] LOOP
  EXECUTE format('CREATE TRIGGER purchasing_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION reject_inventory_mutation()',t);
 END LOOP;
END $$;
CREATE FUNCTION guard_supplier_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (NEW.id,NEW."branchId",NEW."organizationId",NEW."createdAt") IS DISTINCT FROM (OLD.id,OLD."branchId",OLD."organizationId",OLD."createdAt") OR NEW.version<>OLD.version+1 OR OLD."deletedAt" IS NOT NULL THEN RAISE EXCEPTION 'Supplier identity/version/archive is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER supplier_identity BEFORE UPDATE ON "Supplier" FOR EACH ROW EXECUTE FUNCTION guard_supplier_identity();
CREATE FUNCTION guard_purchase_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'DRAFT' OR NEW.version<>1 THEN RAISE EXCEPTION 'Purchase must start as a draft' USING ERRCODE='23514'; END IF;
 ELSE
  IF (NEW.id,NEW."branchId",NEW."organizationId",NEW."userId",NEW."createdAt",NEW.number,NEW.currency) IS DISTINCT FROM (OLD.id,OLD."branchId",OLD."organizationId",OLD."userId",OLD."createdAt",OLD.number,OLD.currency) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Purchase identity/version is immutable' USING ERRCODE='23514'; END IF;
  IF OLD.status<>'DRAFT' AND (to_jsonb(NEW)-ARRAY['status','version','updatedAt','cancelledAt','cancellationReason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','updatedAt','cancelledAt','cancellationReason']) THEN RAISE EXCEPTION 'Ordered purchase content is frozen' USING ERRCODE='23514'; END IF;
  IF NOT ((OLD.status='DRAFT' AND NEW.status IN ('DRAFT','ORDERED','CANCELLED')) OR (OLD.status='ORDERED' AND NEW.status IN ('PARTIALLY_RECEIVED','RECEIVED','CANCELLED')) OR (OLD.status='PARTIALLY_RECEIVED' AND NEW.status IN ('PARTIALLY_RECEIVED','RECEIVED'))) THEN RAISE EXCEPTION 'Invalid purchase state transition' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER purchase_identity BEFORE INSERT OR UPDATE ON "PurchaseOrder" FOR EACH ROW EXECUTE FUNCTION guard_purchase_identity();
CREATE FUNCTION guard_purchase_item() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE item RECORD; BEGIN
 IF NOT EXISTS (SELECT 1 FROM "PurchaseOrder" WHERE id=NEW."purchaseOrderId" AND status='DRAFT') THEN RAISE EXCEPTION 'Only draft purchase lines can change' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD."voidedAt" IS NOT NULL OR NEW."voidedAt" IS NULL OR to_jsonb(NEW)-'voidedAt' IS DISTINCT FROM to_jsonb(OLD)-'voidedAt' THEN RAISE EXCEPTION 'Purchase lines only allow draft replacement' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT i.*,a.dimension AS stock_dimension,a.factor AS stock_factor,b.dimension AS input_dimension,b.factor AS input_factor INTO item FROM "InventoryItem" i JOIN "InventoryUnit" a ON a.code=i."unitCode" JOIN "InventoryUnit" b ON b.code=NEW."unitCode" WHERE i.id=NEW."itemId";
  IF NOT FOUND OR item.stock_dimension<>item.input_dimension OR NEW."stockUnit"<>item."unitCode" OR NEW."stockQuantity"*item.stock_factor<>NEW.quantity*item.input_factor OR NEW."itemName"<>item.name OR NEW.sku<>item.sku OR NEW."voidedAt" IS NOT NULL THEN RAISE EXCEPTION 'Purchase stock snapshot/conversion mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER purchase_item_guard BEFORE INSERT OR UPDATE ON "PurchaseItem" FOR EACH ROW EXECUTE FUNCTION guard_purchase_item();
CREATE FUNCTION check_purchase_complete() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE oid UUID; p RECORD; sums RECORD; received BOOLEAN; incomplete BOOLEAN; BEGIN
 IF TG_TABLE_NAME='PurchaseOrder' THEN oid:=NEW.id; ELSE oid:=NEW."purchaseOrderId"; END IF;
 SELECT * INTO p FROM "PurchaseOrder" WHERE id=oid;
 SELECT count(*) AS count,sum(subtotal) AS subtotal,sum(tax) AS tax,sum(total) AS total INTO sums FROM "PurchaseItem" WHERE "purchaseOrderId"=oid AND "voidedAt" IS NULL;
 IF sums.count=0 OR (sums.subtotal,sums.tax,sums.total) IS DISTINCT FROM (p.subtotal,p.tax,p.total) THEN RAISE EXCEPTION 'Purchase totals require complete matching items' USING ERRCODE='23514'; END IF;
 SELECT EXISTS(SELECT 1 FROM "GoodsReceipt" WHERE "purchaseOrderId"=oid) INTO received;
 SELECT EXISTS(SELECT 1 FROM "PurchaseItem" i WHERE i."purchaseOrderId"=oid AND i."voidedAt" IS NULL AND i.quantity>COALESCE((SELECT sum(r.quantity) FROM "GoodsReceiptItem" r WHERE r."purchaseItemId"=i.id),0)) INTO incomplete;
 IF (p.status='RECEIVED' AND (NOT received OR incomplete)) OR (p.status='PARTIALLY_RECEIVED' AND (NOT received OR NOT incomplete)) OR (p.status IN ('DRAFT','ORDERED','CANCELLED') AND received) THEN RAISE EXCEPTION 'Purchase status must match receiving history' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER purchase_complete AFTER INSERT OR UPDATE ON "PurchaseOrder" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_purchase_complete();
CREATE CONSTRAINT TRIGGER purchase_item_complete AFTER INSERT OR UPDATE ON "PurchaseItem" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_purchase_complete();
CREATE CONSTRAINT TRIGGER receiving_order_complete AFTER INSERT ON "GoodsReceipt" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_purchase_complete();
CREATE FUNCTION guard_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM "PurchaseOrder" WHERE id=NEW."purchaseOrderId" AND status IN ('ORDERED','PARTIALLY_RECEIVED') AND currency=NEW.currency) THEN RAISE EXCEPTION 'Goods require an ordered purchase in the same currency' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER receipt_guard BEFORE INSERT ON "GoodsReceipt" FOR EACH ROW EXECUTE FUNCTION guard_receipt();
CREATE FUNCTION guard_receipt_item() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE line RECORD; BEGIN
 SELECT * INTO line FROM "PurchaseItem" WHERE id=NEW."purchaseItemId" AND "voidedAt" IS NULL;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM "GoodsReceipt" WHERE id=NEW."receiptId" AND xmin::text=(txid_current()%4294967296)::text) OR NEW."stockQuantity"*line.quantity<>NEW.quantity*line."stockQuantity" OR NEW.subtotal<>round(NEW.quantity*line."unitPrice",2) OR NEW.tax<>round(NEW.subtotal*line."taxRate"/100,2) THEN RAISE EXCEPTION 'Receipt line must match frozen ordered quantities and prices' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER receipt_item_guard BEFORE INSERT ON "GoodsReceiptItem" FOR EACH ROW EXECUTE FUNCTION guard_receipt_item();
CREATE FUNCTION guard_purchase_movement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.kind::text='PURCHASE' AND NOT EXISTS(
  SELECT 1 FROM "GoodsReceiptItem" r JOIN "PurchaseItem" i ON i.id=r."purchaseItemId" JOIN "PurchaseOrder" p ON p.id=i."purchaseOrderId" JOIN "StockPosition" s ON s.id=NEW."positionId"
  WHERE r.id=NEW."receiptItemId" AND r."stockQuantity"=NEW.quantity AND i."itemId"=s."itemId" AND p."warehouseId"=s."warehouseId" AND NEW."enteredUnit"=i."unitCode" AND NEW."enteredQuantity"::numeric=r.quantity
 ) THEN RAISE EXCEPTION 'Purchase stock must match its receipt line and warehouse' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER purchase_stock_source BEFORE INSERT ON "StockMovement" FOR EACH ROW EXECUTE FUNCTION guard_purchase_movement();
CREATE FUNCTION check_receipt_complete() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE rid UUID; r RECORD; sums RECORD; BEGIN
 IF TG_TABLE_NAME='GoodsReceipt' THEN rid:=NEW.id; ELSE rid:=NEW."receiptId"; END IF;
 SELECT * INTO r FROM "GoodsReceipt" WHERE id=rid;
 SELECT count(*) AS count,sum(subtotal) AS subtotal,sum(tax) AS tax,sum(total) AS total INTO sums FROM "GoodsReceiptItem" WHERE "receiptId"=rid;
 IF sums.count=0 OR (sums.subtotal,sums.tax,sums.total) IS DISTINCT FROM (r.subtotal,r.tax,r.total) OR EXISTS(SELECT 1 FROM "GoodsReceiptItem" i LEFT JOIN "StockMovement" m ON m."receiptItemId"=i.id WHERE i."receiptId"=rid AND m.id IS NULL) OR NOT EXISTS(SELECT 1 FROM "SupplierEntry" WHERE "receiptId"=rid AND kind='CHARGE' AND amount=r.total) THEN RAISE EXCEPTION 'Receipt requires complete stock and supplier charge' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM "PurchaseItem" i WHERE i."purchaseOrderId"=r."purchaseOrderId" AND (SELECT sum(quantity) FROM "GoodsReceiptItem" WHERE "purchaseItemId"=i.id)>i.quantity) THEN RAISE EXCEPTION 'Receipt exceeds ordered quantity' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER receipt_complete AFTER INSERT ON "GoodsReceipt" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_receipt_complete();
CREATE CONSTRAINT TRIGGER receipt_item_complete AFTER INSERT ON "GoodsReceiptItem" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_receipt_complete();
CREATE FUNCTION guard_supplier_entry() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.kind='CHARGE' AND NOT EXISTS(SELECT 1 FROM "GoodsReceipt" WHERE id=NEW."receiptId" AND total=NEW.amount AND xmin::text=(txid_current()%4294967296)::text) THEN RAISE EXCEPTION 'Charge requires its newly posted receipt' USING ERRCODE='23514'; END IF;
 IF NEW.kind='PAYMENT_REVERSAL' AND NOT EXISTS(SELECT 1 FROM "SupplierEntry" WHERE id=NEW."reversesId" AND kind='PAYMENT' AND "receiptId"=NEW."receiptId" AND amount=-NEW.amount) THEN RAISE EXCEPTION 'Reversal must reference and match original supplier payment' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER supplier_entry_guard BEFORE INSERT ON "SupplierEntry" FOR EACH ROW EXECUTE FUNCTION guard_supplier_entry();
CREATE FUNCTION check_supplier_balance() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE balance NUMERIC; charged NUMERIC; BEGIN
 SELECT sum(amount),sum(amount) FILTER(WHERE kind='CHARGE') INTO balance,charged FROM "SupplierEntry" WHERE "receiptId"=NEW."receiptId";
 IF charged IS NULL OR balance<0 OR balance>charged THEN RAISE EXCEPTION 'Supplier payment exceeds recorded receipt balance' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER supplier_balance AFTER INSERT ON "SupplierEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_supplier_balance();

INSERT INTO "Permission" ("key",description,"updatedAt") VALUES ('supplier.read','supplier read',CURRENT_TIMESTAMP),('supplier.manage','supplier manage',CURRENT_TIMESTAMP),('purchase.read','purchase read',CURRENT_TIMESTAMP),('purchase.manage','purchase manage',CURRENT_TIMESTAMP),('purchase.receive','purchase receive',CURRENT_TIMESTAMP),('supplier.payment.record','supplier payment record',CURRENT_TIMESTAMP),('supplier.payment.reverse','supplier payment reverse',CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;
DO $$ DECLARE r RECORD; before_keys JSONB; after_keys JSONB; BEGIN
 FOR r IN SELECT * FROM "Role" WHERE name='OWNER' AND protected=true LOOP
 SELECT COALESCE(jsonb_agg("permissionKey" ORDER BY "permissionKey"),'[]'::jsonb) INTO before_keys FROM "RolePermission" WHERE "roleId"=r.id;
 INSERT INTO "RolePermission" ("roleId","permissionKey") SELECT r.id,key FROM "Permission" WHERE key IN ('supplier.read','supplier.manage','purchase.read','purchase.manage','purchase.receive','supplier.payment.record','supplier.payment.reverse') ON CONFLICT DO NOTHING;
 SELECT jsonb_agg("permissionKey" ORDER BY "permissionKey") INTO after_keys FROM "RolePermission" WHERE "roleId"=r.id;
 IF before_keys<>after_keys THEN INSERT INTO "AuditLog" (id,"organizationId",action,"entityType","entityId","beforeData","afterData") VALUES (gen_random_uuid(),r."organizationId",'role.permissions_migrated','Role',r.id::text,jsonb_build_object('permissions',before_keys),jsonb_build_object('permissions',after_keys,'migration','202609140001_purchasing')); END IF;
 END LOOP;
END $$;

-- AddForeignKey
ALTER TABLE "PurchasingEvent" ADD CONSTRAINT "PurchasingEvent_supplierId_branchId_organizationId_fkey" FOREIGN KEY ("supplierId", "branchId", "organizationId") REFERENCES "Supplier"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchasingEvent" ADD CONSTRAINT "PurchasingEvent_purchaseOrderId_branchId_organizationId_fkey" FOREIGN KEY ("purchaseOrderId", "branchId", "organizationId") REFERENCES "PurchaseOrder"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
