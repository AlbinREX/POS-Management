BEGIN;
-- CreateEnum
CREATE TYPE "KitchenTicketStatus" AS ENUM ('NEW', 'PREPARING', 'READY', 'COMPLETED');

-- CreateTable
CREATE TABLE "KitchenRevision" (
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "revision" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "KitchenRevision_pkey" PRIMARY KEY ("branchId")
);

-- CreateTable
CREATE TABLE "KitchenSubmission" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "submittedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KitchenSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KitchenTicket" (
    "id" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "stationId" UUID NOT NULL,
    "status" "KitchenTicketStatus" NOT NULL DEFAULT 'NEW',
    "version" INTEGER NOT NULL DEFAULT 1,
    "content" JSONB NOT NULL,
    "preparingAt" TIMESTAMPTZ(3),
    "readyAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "cancellationReason" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "KitchenTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KitchenTicketItem" (
    "ticketId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KitchenTicketItem_pkey" PRIMARY KEY ("ticketId","itemId")
);

-- CreateTable
CREATE TABLE "KitchenEvent" (
    "id" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "commandId" UUID,
    "requestHash" CHAR(64),
    "revision" BIGINT NOT NULL,
    "ticketVersion" INTEGER NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KitchenEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KitchenRevision_branchId_organizationId_key" ON "KitchenRevision"("branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "KitchenSubmission_orderId_key" ON "KitchenSubmission"("orderId");

-- CreateIndex
CREATE INDEX "KitchenSubmission_submittedBy_branchId_organizationId_idx" ON "KitchenSubmission"("submittedBy", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "KitchenSubmission_orderId_branchId_organizationId_key" ON "KitchenSubmission"("orderId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "KitchenSubmission_id_orderId_branchId_organizationId_key" ON "KitchenSubmission"("id", "orderId", "branchId", "organizationId");

-- CreateIndex
CREATE INDEX "KitchenTicket_branchId_organizationId_stationId_cancelledAt_idx" ON "KitchenTicket"("branchId", "organizationId", "stationId", "cancelledAt", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "KitchenTicket_orderId_branchId_organizationId_idx" ON "KitchenTicket"("orderId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "KitchenTicket_id_orderId_branchId_organizationId_key" ON "KitchenTicket"("id", "orderId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "KitchenTicket_submissionId_stationId_key" ON "KitchenTicket"("submissionId", "stationId");

-- CreateIndex
CREATE INDEX "KitchenTicketItem_itemId_orderId_branchId_organizationId_idx" ON "KitchenTicketItem"("itemId", "orderId", "branchId", "organizationId");

-- CreateIndex
CREATE INDEX "KitchenEvent_branchId_organizationId_revision_idx" ON "KitchenEvent"("branchId", "organizationId", "revision");

-- CreateIndex
CREATE INDEX "KitchenEvent_userId_branchId_organizationId_idx" ON "KitchenEvent"("userId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "KitchenEvent_branchId_commandId_key" ON "KitchenEvent"("branchId", "commandId");

-- CreateIndex
CREATE UNIQUE INDEX "KitchenEvent_branchId_revision_key" ON "KitchenEvent"("branchId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "KitchenEvent_ticketId_ticketVersion_key" ON "KitchenEvent"("ticketId", "ticketVersion");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItem_id_orderId_branchId_organizationId_key" ON "OrderItem"("id", "orderId", "branchId", "organizationId");

-- AddForeignKey
ALTER TABLE "KitchenRevision" ADD CONSTRAINT "KitchenRevision_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenSubmission" ADD CONSTRAINT "KitchenSubmission_orderId_branchId_organizationId_fkey" FOREIGN KEY ("orderId", "branchId", "organizationId") REFERENCES "Order"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenSubmission" ADD CONSTRAINT "KitchenSubmission_submittedBy_branchId_organizationId_fkey" FOREIGN KEY ("submittedBy", "branchId", "organizationId") REFERENCES "BranchMembership"("userId", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenTicket" ADD CONSTRAINT "KitchenTicket_submissionId_orderId_branchId_organizationId_fkey" FOREIGN KEY ("submissionId", "orderId", "branchId", "organizationId") REFERENCES "KitchenSubmission"("id", "orderId", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenTicket" ADD CONSTRAINT "KitchenTicket_stationId_branchId_organizationId_fkey" FOREIGN KEY ("stationId", "branchId", "organizationId") REFERENCES "KitchenStation"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenTicketItem" ADD CONSTRAINT "KitchenTicketItem_ticketId_orderId_branchId_organizationId_fkey" FOREIGN KEY ("ticketId", "orderId", "branchId", "organizationId") REFERENCES "KitchenTicket"("id", "orderId", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenTicketItem" ADD CONSTRAINT "KitchenTicketItem_itemId_orderId_branchId_organizationId_fkey" FOREIGN KEY ("itemId", "orderId", "branchId", "organizationId") REFERENCES "OrderItem"("id", "orderId", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenEvent" ADD CONSTRAINT "KitchenEvent_ticketId_orderId_branchId_organizationId_fkey" FOREIGN KEY ("ticketId", "orderId", "branchId", "organizationId") REFERENCES "KitchenTicket"("id", "orderId", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenEvent" ADD CONSTRAINT "KitchenEvent_userId_branchId_organizationId_fkey" FOREIGN KEY ("userId", "branchId", "organizationId") REFERENCES "BranchMembership"("userId", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KitchenRevision" ADD CONSTRAINT "KitchenRevision_valid" CHECK (revision >= 0);
ALTER TABLE "KitchenEvent" ADD CONSTRAINT "KitchenEvent_valid" CHECK (revision > 0 AND "ticketVersion" > 0 AND (("commandId" IS NULL) = ("requestHash" IS NULL)) AND jsonb_typeof(response) = 'object');
ALTER TABLE "KitchenTicket" ADD CONSTRAINT "KitchenTicket_valid" CHECK (
 version > 0 AND jsonb_typeof(content) = 'object' AND content ?& ARRAY['schemaVersion','ticketId','submissionId','orderId','stationId','items']
 AND content->>'schemaVersion' = '1' AND content->>'ticketId' = id::text AND content->>'orderId' = "orderId"::text AND content->>'stationId' = "stationId"::text AND content->>'submissionId' = "submissionId"::text
 AND jsonb_typeof(content->'items') = 'array' AND jsonb_array_length(content->'items') > 0
 AND (("cancelledAt" IS NULL AND "cancellationReason" IS NULL) OR ("cancelledAt" IS NOT NULL AND "cancellationReason" IS NOT NULL AND length(trim("cancellationReason")) > 0))
 AND ((status = 'NEW' AND "preparingAt" IS NULL AND "readyAt" IS NULL AND "completedAt" IS NULL) OR (status = 'PREPARING' AND "preparingAt" IS NOT NULL AND "readyAt" IS NULL AND "completedAt" IS NULL) OR (status = 'READY' AND "preparingAt" IS NOT NULL AND "readyAt" IS NOT NULL AND "completedAt" IS NULL) OR (status = 'COMPLETED' AND "preparingAt" IS NOT NULL AND "readyAt" IS NOT NULL AND "completedAt" IS NOT NULL))
 AND ("preparingAt" IS NULL OR "preparingAt" >= "createdAt") AND ("readyAt" IS NULL OR "readyAt" >= "preparingAt") AND ("completedAt" IS NULL OR "completedAt" >= "readyAt")
);
CREATE FUNCTION reject_kitchen_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Kitchen history is immutable' USING ERRCODE = '42501'; END; $$;
DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['KitchenSubmission','KitchenTicketItem','KitchenEvent'] LOOP
 EXECUTE format('CREATE TRIGGER kitchen_history_no_change BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_kitchen_history_mutation()',t);
 EXECUTE format('CREATE TRIGGER kitchen_history_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION reject_kitchen_history_mutation()',t);
 END LOOP;
END $$;
CREATE TRIGGER kitchen_ticket_no_delete BEFORE DELETE ON "KitchenTicket" FOR EACH ROW EXECUTE FUNCTION reject_kitchen_history_mutation();
CREATE TRIGGER kitchen_ticket_no_truncate BEFORE TRUNCATE ON "KitchenTicket" FOR EACH STATEMENT EXECUTE FUNCTION reject_kitchen_history_mutation();
CREATE FUNCTION guard_kitchen_ticket_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD."cancelledAt" IS NOT NULL OR NEW.version <> OLD.version + 1 OR
 (NEW.id,NEW."submissionId",NEW."orderId",NEW."branchId",NEW."organizationId",NEW."stationId",NEW.content,NEW."createdAt") IS DISTINCT FROM
 (OLD.id,OLD."submissionId",OLD."orderId",OLD."branchId",OLD."organizationId",OLD."stationId",OLD.content,OLD."createdAt") THEN RAISE EXCEPTION 'Kitchen ticket content is immutable' USING ERRCODE = '42501'; END IF;
 IF NEW."cancelledAt" IS NOT NULL THEN
   IF (NEW.status,NEW."preparingAt",NEW."readyAt",NEW."completedAt") IS DISTINCT FROM (OLD.status,OLD."preparingAt",OLD."readyAt",OLD."completedAt") THEN RAISE EXCEPTION 'Cancellation must preserve preparation history' USING ERRCODE='42501'; END IF;
 ELSE
   IF NOT ((OLD.status='NEW' AND NEW.status='PREPARING') OR (OLD.status='PREPARING' AND NEW.status='READY' AND NEW."preparingAt"=OLD."preparingAt") OR (OLD.status='READY' AND NEW.status='COMPLETED' AND NEW."preparingAt"=OLD."preparingAt" AND NEW."readyAt"=OLD."readyAt")) THEN RAISE EXCEPTION 'Invalid kitchen transition' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER kitchen_ticket_update_guard BEFORE UPDATE ON "KitchenTicket" FOR EACH ROW EXECUTE FUNCTION guard_kitchen_ticket_update();
CREATE FUNCTION guard_submitted_order() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS (SELECT 1 FROM "KitchenSubmission" WHERE "orderId"=OLD.id) THEN
   IF NEW.status NOT IN ('SENT_TO_KITCHEN','PREPARING','READY','WAITING_PAYMENT','CANCELLED') OR
   (NEW.subtotal,NEW.discount,NEW.tax,NEW.total,NEW."discountReason",NEW.notes,NEW."waiterId",NEW."waiterName") IS DISTINCT FROM
   (OLD.subtotal,OLD.discount,OLD.tax,OLD.total,OLD."discountReason",OLD.notes,OLD."waiterId",OLD."waiterName") THEN RAISE EXCEPTION 'Submitted order cannot be financially or operationally rewritten' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER order_submitted_guard BEFORE UPDATE ON "Order" FOR EACH ROW EXECUTE FUNCTION guard_submitted_order();
CREATE FUNCTION guard_submitted_item() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE target UUID; BEGIN
 IF TG_TABLE_NAME='OrderItem' THEN target:=NEW."orderId"; ELSE SELECT "orderId" INTO target FROM "OrderItem" WHERE id=NEW."itemId"; END IF;
 IF EXISTS (SELECT 1 FROM "KitchenSubmission" WHERE "orderId"=target) THEN RAISE EXCEPTION 'Submitted item snapshot is immutable' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER order_item_submitted_guard BEFORE INSERT OR UPDATE ON "OrderItem" FOR EACH ROW EXECUTE FUNCTION guard_submitted_item();
CREATE TRIGGER order_modifier_submitted_guard BEFORE INSERT ON "OrderItemModifier" FOR EACH ROW EXECUTE FUNCTION guard_submitted_item();
-- Deferred relational checks ensure no partial/empty submissions, orphan content or cancellation drift.
CREATE FUNCTION check_kitchen_integrity() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE target UUID; o "Order"%ROWTYPE; ticket RECORD; expected JSONB; BEGIN
 IF TG_TABLE_NAME='Order' THEN target:=NEW.id; ELSE target:=NEW."orderId"; END IF;
 SELECT * INTO o FROM "Order" WHERE id=target;
 IF NOT EXISTS (SELECT 1 FROM "KitchenSubmission" WHERE "orderId"=target) THEN RETURN NULL; END IF;
 IF o.status NOT IN ('SENT_TO_KITCHEN','PREPARING','READY','WAITING_PAYMENT','CANCELLED') THEN RAISE EXCEPTION 'Invalid submitted order status' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS (SELECT 1 FROM "KitchenTicket" WHERE "orderId"=target) OR EXISTS (SELECT 1 FROM "OrderItem" i WHERE i."orderId"=target AND i."voidedAt" IS NULL AND NOT EXISTS (SELECT 1 FROM "KitchenTicketItem" j WHERE j."itemId"=i.id)) THEN RAISE EXCEPTION 'Submission must route all active items' USING ERRCODE='23514'; END IF;
 IF o.status <> 'CANCELLED' THEN
   IF (o.status IN ('READY','WAITING_PAYMENT') AND EXISTS (SELECT 1 FROM "KitchenTicket" WHERE "orderId"=target AND status NOT IN ('READY','COMPLETED'))) OR
      (o.status='SENT_TO_KITCHEN' AND EXISTS (SELECT 1 FROM "KitchenTicket" WHERE "orderId"=target AND status<>'NEW')) OR
      (o.status='PREPARING' AND (NOT EXISTS (SELECT 1 FROM "KitchenTicket" WHERE "orderId"=target AND status<>'NEW') OR NOT EXISTS (SELECT 1 FROM "KitchenTicket" WHERE "orderId"=target AND status NOT IN ('READY','COMPLETED')))) THEN RAISE EXCEPTION 'Order status must agree with all kitchen tickets' USING ERRCODE='23514'; END IF;
 END IF;
 FOR ticket IN SELECT * FROM "KitchenTicket" WHERE "orderId"=target LOOP
   IF (o.status='CANCELLED') <> (ticket."cancelledAt" IS NOT NULL) THEN RAISE EXCEPTION 'Order and ticket cancellation must be atomic' USING ERRCODE='23514'; END IF;
   SELECT jsonb_agg(jsonb_build_object('orderItemId',i.id,'productName',i."productName",'quantity',i.quantity,'notes',i.notes,'modifiers',COALESCE((SELECT jsonb_agg(jsonb_build_object('groupName',m."groupName",'name',m.name) ORDER BY m.id) FROM "OrderItemModifier" m WHERE m."itemId"=i.id),'[]'::jsonb)) ORDER BY i."createdAt",i.id) INTO expected FROM "KitchenTicketItem" j JOIN "OrderItem" i ON i.id=j."itemId" WHERE j."ticketId"=ticket.id AND i."voidedAt" IS NULL;
   IF expected IS NULL OR expected IS DISTINCT FROM ticket.content->'items' THEN RAISE EXCEPTION 'Kitchen content must match immutable order items' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER kitchen_integrity_submission AFTER INSERT ON "KitchenSubmission" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_kitchen_integrity();
CREATE CONSTRAINT TRIGGER kitchen_integrity_ticket AFTER INSERT OR UPDATE ON "KitchenTicket" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_kitchen_integrity();
CREATE CONSTRAINT TRIGGER kitchen_integrity_item AFTER INSERT ON "KitchenTicketItem" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_kitchen_integrity();
CREATE CONSTRAINT TRIGGER kitchen_integrity_order AFTER UPDATE ON "Order" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_kitchen_integrity();
INSERT INTO "Permission" ("key",description,"updatedAt") VALUES ('order.submit_kitchen','order: submit kitchen',CURRENT_TIMESTAMP),('kitchen.read','kitchen: read',CURRENT_TIMESTAMP),('kitchen.manage','kitchen: progress tickets',CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;
DO $$ DECLARE r RECORD; before_keys JSONB; after_keys JSONB; BEGIN
 FOR r IN SELECT * FROM "Role" WHERE name='OWNER' AND protected=true LOOP
 SELECT COALESCE(jsonb_agg("permissionKey" ORDER BY "permissionKey"),'[]'::jsonb) INTO before_keys FROM "RolePermission" WHERE "roleId"=r.id;
 INSERT INTO "RolePermission" ("roleId","permissionKey") SELECT r.id,key FROM "Permission" WHERE key IN ('order.submit_kitchen','kitchen.read','kitchen.manage') ON CONFLICT DO NOTHING;
 SELECT jsonb_agg("permissionKey" ORDER BY "permissionKey") INTO after_keys FROM "RolePermission" WHERE "roleId"=r.id;
 IF before_keys<>after_keys THEN INSERT INTO "AuditLog" (id,"organizationId",action,"entityType","entityId","beforeData","afterData") VALUES (gen_random_uuid(),r."organizationId",'role.permissions_migrated','Role',r.id::text,jsonb_build_object('permissions',before_keys),jsonb_build_object('permissions',after_keys,'migration','202609120002_kitchen')); END IF;
 END LOOP;
END $$;
COMMIT;
