BEGIN;
-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('DINE_IN', 'TAKEAWAY');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'OPEN', 'SENT_TO_KITCHEN', 'PREPARING', 'READY', 'SERVED', 'WAITING_PAYMENT', 'PAID', 'CANCELLED');

-- CreateTable
CREATE TABLE "OrderCounter" (
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "number" BIGINT NOT NULL DEFAULT 0,
    "revision" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OrderCounter_pkey" PRIMARY KEY ("branchId")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "orderNumber" BIGINT NOT NULL,
    "type" "OrderType" NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "tableId" UUID,
    "areaId" UUID,
    "tableName" VARCHAR(100),
    "areaName" VARCHAR(160),
    "waiterId" UUID,
    "waiterName" VARCHAR(100),
    "currency" CHAR(3) NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discountReason" VARCHAR(500),
    "cancellationReason" VARCHAR(500),
    "notes" VARCHAR(2000) NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "productName" VARCHAR(160) NOT NULL,
    "sku" VARCHAR(80) NOT NULL,
    "categoryName" VARCHAR(160) NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "taxRate" DECIMAL(5,2) NOT NULL,
    "taxMode" "PriceTaxMode" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "notes" VARCHAR(2000) NOT NULL DEFAULT '',
    "subtotal" DECIMAL(14,2) NOT NULL,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "voidedAt" TIMESTAMPTZ(3),
    "voidReason" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItemModifier" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "modifierId" UUID NOT NULL,
    "groupName" VARCHAR(160) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "priceAdjustment" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItemModifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderEvent" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "commandId" UUID NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "revision" BIGINT NOT NULL,
    "orderVersion" INTEGER NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderCounter_branchId_organizationId_key" ON "OrderCounter"("branchId", "organizationId");

-- CreateIndex
CREATE INDEX "Order_branchId_organizationId_status_createdAt_id_idx" ON "Order"("branchId", "organizationId", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Order_tableId_branchId_organizationId_idx" ON "Order"("tableId", "branchId", "organizationId");

-- CreateIndex
CREATE INDEX "Order_areaId_branchId_organizationId_idx" ON "Order"("areaId", "branchId", "organizationId");

-- CreateIndex
CREATE INDEX "Order_waiterId_branchId_organizationId_idx" ON "Order"("waiterId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_id_branchId_organizationId_key" ON "Order"("id", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_branchId_orderNumber_key" ON "Order"("branchId", "orderNumber");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_branchId_organizationId_createdAt_id_idx" ON "OrderItem"("orderId", "branchId", "organizationId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "OrderItem_productId_branchId_organizationId_idx" ON "OrderItem"("productId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItem_id_branchId_organizationId_key" ON "OrderItem"("id", "branchId", "organizationId");

-- CreateIndex
CREATE INDEX "OrderItemModifier_modifierId_branchId_organizationId_idx" ON "OrderItemModifier"("modifierId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItemModifier_itemId_modifierId_key" ON "OrderItemModifier"("itemId", "modifierId");

-- CreateIndex
CREATE INDEX "OrderEvent_branchId_organizationId_revision_idx" ON "OrderEvent"("branchId", "organizationId", "revision");

-- CreateIndex
CREATE INDEX "OrderEvent_userId_branchId_organizationId_idx" ON "OrderEvent"("userId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderEvent_branchId_commandId_key" ON "OrderEvent"("branchId", "commandId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderEvent_branchId_revision_key" ON "OrderEvent"("branchId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "OrderEvent_orderId_orderVersion_key" ON "OrderEvent"("orderId", "orderVersion");

-- AddForeignKey
ALTER TABLE "OrderCounter" ADD CONSTRAINT "OrderCounter_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_tableId_branchId_organizationId_fkey" FOREIGN KEY ("tableId", "branchId", "organizationId") REFERENCES "RestaurantTable"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_areaId_branchId_organizationId_fkey" FOREIGN KEY ("areaId", "branchId", "organizationId") REFERENCES "Area"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_waiterId_branchId_organizationId_fkey" FOREIGN KEY ("waiterId", "branchId", "organizationId") REFERENCES "BranchMembership"("userId", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_branchId_organizationId_fkey" FOREIGN KEY ("orderId", "branchId", "organizationId") REFERENCES "Order"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_branchId_organizationId_fkey" FOREIGN KEY ("productId", "branchId", "organizationId") REFERENCES "Product"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemModifier" ADD CONSTRAINT "OrderItemModifier_itemId_branchId_organizationId_fkey" FOREIGN KEY ("itemId", "branchId", "organizationId") REFERENCES "OrderItem"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemModifier" ADD CONSTRAINT "OrderItemModifier_modifierId_branchId_organizationId_fkey" FOREIGN KEY ("modifierId", "branchId", "organizationId") REFERENCES "Modifier"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_orderId_branchId_organizationId_fkey" FOREIGN KEY ("orderId", "branchId", "organizationId") REFERENCES "Order"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_userId_branchId_organizationId_fkey" FOREIGN KEY ("userId", "branchId", "organizationId") REFERENCES "BranchMembership"("userId", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderCounter" ADD CONSTRAINT "OrderCounter_nonnegative" CHECK (number >= 0 AND revision >= 0);
ALTER TABLE "Order" ADD CONSTRAINT "Order_valid" CHECK (
  "orderNumber" > 0 AND version > 0 AND subtotal >= 0 AND discount BETWEEN 0 AND subtotal AND total = subtotal - discount AND tax BETWEEN 0 AND total
  AND ((type = 'DINE_IN' AND "tableId" IS NOT NULL AND "areaId" IS NOT NULL AND "tableName" IS NOT NULL AND "areaName" IS NOT NULL) OR (type = 'TAKEAWAY' AND "tableId" IS NULL AND "areaId" IS NULL AND "tableName" IS NULL AND "areaName" IS NULL))
  AND (("waiterId" IS NULL) = ("waiterName" IS NULL))
  AND (discount = 0 OR length(trim("discountReason")) > 0 AND "discountReason" IS NOT NULL)
  AND (status <> 'CANCELLED' OR "cancellationReason" IS NOT NULL AND length(trim("cancellationReason")) > 0)
);
CREATE UNIQUE INDEX "Order_one_live_table" ON "Order" ("tableId") WHERE "tableId" IS NOT NULL AND status NOT IN ('CANCELLED', 'PAID');
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_valid" CHECK (
  quantity BETWEEN 1 AND 999 AND "unitPrice" >= 0 AND "taxRate" BETWEEN 0 AND 100
  AND subtotal >= 0 AND discount BETWEEN 0 AND subtotal AND total = subtotal - discount AND tax BETWEEN 0 AND total
  AND (("voidedAt" IS NULL AND "voidReason" IS NULL) OR ("voidedAt" IS NOT NULL AND "voidReason" IS NOT NULL AND length(trim("voidReason")) > 0))
);
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_valid" CHECK (revision > 0 AND "orderVersion" > 0 AND jsonb_typeof(response) = 'object');
CREATE FUNCTION reject_order_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Order history cannot be changed or deleted' USING ERRCODE = '42501'; END;
$$;
CREATE TRIGGER order_event_no_change BEFORE UPDATE OR DELETE ON "OrderEvent" FOR EACH ROW EXECUTE FUNCTION reject_order_history_mutation();
CREATE TRIGGER order_event_no_truncate BEFORE TRUNCATE ON "OrderEvent" FOR EACH STATEMENT EXECUTE FUNCTION reject_order_history_mutation();
CREATE TRIGGER order_modifier_no_change BEFORE UPDATE OR DELETE ON "OrderItemModifier" FOR EACH ROW EXECUTE FUNCTION reject_order_history_mutation();
CREATE TRIGGER order_modifier_no_truncate BEFORE TRUNCATE ON "OrderItemModifier" FOR EACH STATEMENT EXECUTE FUNCTION reject_order_history_mutation();
CREATE TRIGGER order_no_delete BEFORE DELETE ON "Order" FOR EACH ROW EXECUTE FUNCTION reject_order_history_mutation();
CREATE TRIGGER order_no_truncate BEFORE TRUNCATE ON "Order" FOR EACH STATEMENT EXECUTE FUNCTION reject_order_history_mutation();
CREATE TRIGGER order_item_no_delete BEFORE DELETE ON "OrderItem" FOR EACH ROW EXECUTE FUNCTION reject_order_history_mutation();
CREATE TRIGGER order_item_no_truncate BEFORE TRUNCATE ON "OrderItem" FOR EACH STATEMENT EXECUTE FUNCTION reject_order_history_mutation();
CREATE FUNCTION guard_order_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('PAID', 'CANCELLED') OR
     (NEW.id, NEW."branchId", NEW."organizationId", NEW."orderNumber", NEW.type, NEW.currency, NEW."createdAt", NEW."tableId", NEW."areaId", NEW."tableName", NEW."areaName") IS DISTINCT FROM
     (OLD.id, OLD."branchId", OLD."organizationId", OLD."orderNumber", OLD.type, OLD.currency, OLD."createdAt", OLD."tableId", OLD."areaId", OLD."tableName", OLD."areaName") OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Order is immutable or its version is invalid' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER order_update_guard BEFORE UPDATE ON "Order" FOR EACH ROW EXECUTE FUNCTION guard_order_update();
CREATE FUNCTION guard_order_item() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_status "OrderStatus";
BEGIN
  SELECT status INTO parent_status FROM "Order" WHERE id = NEW."orderId" FOR UPDATE;
  IF parent_status NOT IN ('DRAFT', 'OPEN') THEN RAISE EXCEPTION 'Order items are locked' USING ERRCODE = '42501'; END IF;
  IF TG_OP = 'UPDATE' AND (OLD."voidedAt" IS NOT NULL OR
    (NEW.id, NEW."orderId", NEW."branchId", NEW."organizationId", NEW."productId", NEW."productName", NEW.sku, NEW."categoryName", NEW."unitPrice", NEW."taxRate", NEW."taxMode", NEW."createdAt") IS DISTINCT FROM
    (OLD.id, OLD."orderId", OLD."branchId", OLD."organizationId", OLD."productId", OLD."productName", OLD.sku, OLD."categoryName", OLD."unitPrice", OLD."taxRate", OLD."taxMode", OLD."createdAt")) THEN
    RAISE EXCEPTION 'Item snapshot or void history is immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER order_item_guard BEFORE INSERT OR UPDATE ON "OrderItem" FOR EACH ROW EXECUTE FUNCTION guard_order_item();
CREATE FUNCTION guard_order_modifier_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_status "OrderStatus"; removed TIMESTAMPTZ;
BEGIN
  SELECT o.status, i."voidedAt" INTO parent_status, removed FROM "OrderItem" i JOIN "Order" o ON o.id = i."orderId" WHERE i.id = NEW."itemId" FOR UPDATE OF o;
  IF parent_status NOT IN ('DRAFT','OPEN') OR removed IS NOT NULL THEN RAISE EXCEPTION 'Order modifiers are locked' USING ERRCODE = '42501'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER order_modifier_guard BEFORE INSERT ON "OrderItemModifier" FOR EACH ROW EXECUTE FUNCTION guard_order_modifier_insert();
-- Deferred checks see the complete transaction after all line calculations and the parent update.
CREATE FUNCTION check_order_totals() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target UUID; o "Order"%ROWTYPE; sums RECORD;
BEGIN
  IF TG_TABLE_NAME = 'Order' THEN target := NEW.id; ELSE target := NEW."orderId"; END IF;
  SELECT * INTO o FROM "Order" WHERE id = target;
  SELECT COALESCE(sum(subtotal),0) subtotal, COALESCE(sum(discount),0) discount, COALESCE(sum(tax),0) tax, COALESCE(sum(total),0) total INTO sums FROM "OrderItem" WHERE "orderId" = target AND "voidedAt" IS NULL;
  IF (o.subtotal,o.discount,o.tax,o.total) IS DISTINCT FROM (sums.subtotal,sums.discount,sums.tax,sums.total) THEN
    RAISE EXCEPTION 'Order totals must match active items' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER order_totals_guard AFTER INSERT OR UPDATE ON "Order" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_order_totals();
CREATE CONSTRAINT TRIGGER order_item_totals_guard AFTER INSERT OR UPDATE ON "OrderItem" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_order_totals();
INSERT INTO "Permission" ("key", description, "updatedAt") VALUES
('order.read', 'order: read', CURRENT_TIMESTAMP),
('order.manage', 'order: manage', CURRENT_TIMESTAMP),
('order.discount', 'order: discount', CURRENT_TIMESTAMP),
('order.cancel', 'order: cancel', CURRENT_TIMESTAMP),
('order.assign', 'order: assign waiter', CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;
DO $$
DECLARE r RECORD; before_keys JSONB; after_keys JSONB;
BEGIN
  FOR r IN SELECT * FROM "Role" WHERE name = 'OWNER' AND protected = true LOOP
    SELECT COALESCE(jsonb_agg("permissionKey" ORDER BY "permissionKey"), '[]'::jsonb) INTO before_keys FROM "RolePermission" WHERE "roleId" = r.id;
    INSERT INTO "RolePermission" ("roleId", "permissionKey") SELECT r.id, key FROM "Permission" WHERE key IN ('order.read','order.manage','order.discount','order.cancel','order.assign') ON CONFLICT DO NOTHING;
    SELECT jsonb_agg("permissionKey" ORDER BY "permissionKey") INTO after_keys FROM "RolePermission" WHERE "roleId" = r.id;
    IF before_keys <> after_keys THEN
      INSERT INTO "AuditLog" (id, "organizationId", action, "entityType", "entityId", "beforeData", "afterData")
      VALUES (gen_random_uuid(), r."organizationId", 'role.permissions_migrated', 'Role', r.id::text, jsonb_build_object('permissions', before_keys), jsonb_build_object('permissions', after_keys, 'migration', '202609120001_orders'));
    END IF;
  END LOOP;
END $$;
COMMIT;
