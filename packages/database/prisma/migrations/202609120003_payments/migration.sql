BEGIN;
-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD');

-- CreateEnum
CREATE TYPE "BillMode" AS ENUM ('AMOUNT', 'ITEMS');

-- CreateEnum
CREATE TYPE "ReversalKind" AS ENUM ('CANCELLATION', 'REFUND');

-- CreateEnum
CREATE TYPE "CashShiftStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "CashMovementKind" AS ENUM ('OPENING', 'CASH_IN', 'CASH_OUT', 'PAYMENT', 'REVERSAL');

-- CreateTable
CREATE TABLE "OrderBill" (
    "orderId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "mode" "BillMode" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderBill_pkey" PRIMARY KEY ("orderId")
);

-- CreateTable
CREATE TABLE "OrderSettlement" (
    "orderId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "cashierId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderSettlement_pkey" PRIMARY KEY ("orderId")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "cashierId" UUID NOT NULL,
    "shiftId" UUID,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "tendered" DECIMAL(14,2),
    "change" DECIMAL(14,2),
    "transactionReference" VARCHAR(120),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentReversal" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "cashierId" UUID NOT NULL,
    "shiftId" UUID,
    "kind" "ReversalKind" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "transactionReference" VARCHAR(120),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentReversal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "paymentId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "unitNumber" INTEGER NOT NULL,
    "orderId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("paymentId","itemId","unitNumber")
);

-- CreateTable
CREATE TABLE "CashShift" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "cashierId" UUID NOT NULL,
    "terminalId" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "CashShiftStatus" NOT NULL DEFAULT 'OPEN',
    "openingAmount" DECIMAL(14,2) NOT NULL,
    "closingAmount" DECIMAL(14,2),
    "expectedAmount" DECIMAL(14,2),
    "difference" DECIMAL(14,2),
    "closingReason" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 1,
    "openedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CashShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashMovement" (
    "id" UUID NOT NULL,
    "shiftId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "cashierId" UUID NOT NULL,
    "kind" "CashMovementKind" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "paymentId" UUID,
    "reversalId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRevision" (
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "revision" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PaymentRevision_pkey" PRIMARY KEY ("branchId")
);

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "orderId" UUID,
    "shiftId" UUID,
    "commandId" UUID NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "revision" BIGINT NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderBill_orderId_branchId_organizationId_key" ON "OrderBill"("orderId", "branchId", "organizationId");

-- CreateIndex
CREATE INDEX "OrderSettlement_branchId_organizationId_createdAt_orderId_idx" ON "OrderSettlement"("branchId", "organizationId", "createdAt", "orderId");

-- CreateIndex
CREATE INDEX "OrderSettlement_cashierId_branchId_organizationId_idx" ON "OrderSettlement"("cashierId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderSettlement_orderId_branchId_organizationId_key" ON "OrderSettlement"("orderId", "branchId", "organizationId");

-- CreateIndex
CREATE INDEX "Payment_orderId_branchId_organizationId_createdAt_id_idx" ON "Payment"("orderId", "branchId", "organizationId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Payment_cashierId_branchId_organizationId_idx" ON "Payment"("cashierId", "branchId", "organizationId");

-- CreateIndex
CREATE INDEX "Payment_shiftId_branchId_organizationId_idx" ON "Payment"("shiftId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_id_orderId_branchId_organizationId_key" ON "Payment"("id", "orderId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_id_branchId_organizationId_key" ON "Payment"("id", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_branchId_transactionReference_key" ON "Payment"("branchId", "transactionReference");

-- CreateIndex
CREATE INDEX "PaymentReversal_paymentId_branchId_organizationId_createdAt_idx" ON "PaymentReversal"("paymentId", "branchId", "organizationId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "PaymentReversal_cashierId_branchId_organizationId_idx" ON "PaymentReversal"("cashierId", "branchId", "organizationId");

-- CreateIndex
CREATE INDEX "PaymentReversal_shiftId_branchId_organizationId_idx" ON "PaymentReversal"("shiftId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentReversal_id_branchId_organizationId_key" ON "PaymentReversal"("id", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentReversal_branchId_transactionReference_key" ON "PaymentReversal"("branchId", "transactionReference");

-- CreateIndex
CREATE INDEX "PaymentAllocation_itemId_orderId_branchId_organizationId_idx" ON "PaymentAllocation"("itemId", "orderId", "branchId", "organizationId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_orderId_branchId_organizationId_idx" ON "PaymentAllocation"("orderId", "branchId", "organizationId");

-- CreateIndex
CREATE INDEX "CashShift_branchId_organizationId_status_openedAt_id_idx" ON "CashShift"("branchId", "organizationId", "status", "openedAt", "id");

-- CreateIndex
CREATE INDEX "CashShift_cashierId_branchId_organizationId_idx" ON "CashShift"("cashierId", "branchId", "organizationId");

-- CreateIndex
CREATE INDEX "CashShift_terminalId_branchId_organizationId_idx" ON "CashShift"("terminalId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CashShift_id_branchId_organizationId_key" ON "CashShift"("id", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CashMovement_paymentId_key" ON "CashMovement"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "CashMovement_reversalId_key" ON "CashMovement"("reversalId");

-- CreateIndex
CREATE INDEX "CashMovement_shiftId_branchId_organizationId_createdAt_id_idx" ON "CashMovement"("shiftId", "branchId", "organizationId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "CashMovement_cashierId_branchId_organizationId_idx" ON "CashMovement"("cashierId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CashMovement_paymentId_branchId_organizationId_key" ON "CashMovement"("paymentId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CashMovement_reversalId_branchId_organizationId_key" ON "CashMovement"("reversalId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRevision_branchId_organizationId_key" ON "PaymentRevision"("branchId", "organizationId");

-- CreateIndex
CREATE INDEX "PaymentEvent_branchId_organizationId_revision_idx" ON "PaymentEvent"("branchId", "organizationId", "revision");

-- CreateIndex
CREATE INDEX "PaymentEvent_orderId_branchId_organizationId_idx" ON "PaymentEvent"("orderId", "branchId", "organizationId");

-- CreateIndex
CREATE INDEX "PaymentEvent_shiftId_branchId_organizationId_idx" ON "PaymentEvent"("shiftId", "branchId", "organizationId");

-- CreateIndex
CREATE INDEX "PaymentEvent_userId_branchId_organizationId_idx" ON "PaymentEvent"("userId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentEvent_branchId_commandId_key" ON "PaymentEvent"("branchId", "commandId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentEvent_branchId_revision_key" ON "PaymentEvent"("branchId", "revision");

-- AddForeignKey
ALTER TABLE "OrderBill" ADD CONSTRAINT "OrderBill_orderId_branchId_organizationId_fkey" FOREIGN KEY ("orderId", "branchId", "organizationId") REFERENCES "Order"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderSettlement" ADD CONSTRAINT "OrderSettlement_orderId_branchId_organizationId_fkey" FOREIGN KEY ("orderId", "branchId", "organizationId") REFERENCES "Order"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderSettlement" ADD CONSTRAINT "OrderSettlement_cashierId_branchId_organizationId_fkey" FOREIGN KEY ("cashierId", "branchId", "organizationId") REFERENCES "BranchMembership"("userId", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_branchId_organizationId_fkey" FOREIGN KEY ("orderId", "branchId", "organizationId") REFERENCES "Order"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_cashierId_branchId_organizationId_fkey" FOREIGN KEY ("cashierId", "branchId", "organizationId") REFERENCES "BranchMembership"("userId", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_shiftId_branchId_organizationId_fkey" FOREIGN KEY ("shiftId", "branchId", "organizationId") REFERENCES "CashShift"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReversal" ADD CONSTRAINT "PaymentReversal_paymentId_branchId_organizationId_fkey" FOREIGN KEY ("paymentId", "branchId", "organizationId") REFERENCES "Payment"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReversal" ADD CONSTRAINT "PaymentReversal_cashierId_branchId_organizationId_fkey" FOREIGN KEY ("cashierId", "branchId", "organizationId") REFERENCES "BranchMembership"("userId", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReversal" ADD CONSTRAINT "PaymentReversal_shiftId_branchId_organizationId_fkey" FOREIGN KEY ("shiftId", "branchId", "organizationId") REFERENCES "CashShift"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_orderId_branchId_organizationI_fkey" FOREIGN KEY ("paymentId", "orderId", "branchId", "organizationId") REFERENCES "Payment"("id", "orderId", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_itemId_orderId_branchId_organizationId_fkey" FOREIGN KEY ("itemId", "orderId", "branchId", "organizationId") REFERENCES "OrderItem"("id", "orderId", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashShift" ADD CONSTRAINT "CashShift_cashierId_branchId_organizationId_fkey" FOREIGN KEY ("cashierId", "branchId", "organizationId") REFERENCES "BranchMembership"("userId", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashShift" ADD CONSTRAINT "CashShift_terminalId_branchId_organizationId_fkey" FOREIGN KEY ("terminalId", "branchId", "organizationId") REFERENCES "Terminal"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_shiftId_branchId_organizationId_fkey" FOREIGN KEY ("shiftId", "branchId", "organizationId") REFERENCES "CashShift"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_cashierId_branchId_organizationId_fkey" FOREIGN KEY ("cashierId", "branchId", "organizationId") REFERENCES "BranchMembership"("userId", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_paymentId_branchId_organizationId_fkey" FOREIGN KEY ("paymentId", "branchId", "organizationId") REFERENCES "Payment"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_reversalId_branchId_organizationId_fkey" FOREIGN KEY ("reversalId", "branchId", "organizationId") REFERENCES "PaymentReversal"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRevision" ADD CONSTRAINT "PaymentRevision_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_orderId_branchId_organizationId_fkey" FOREIGN KEY ("orderId", "branchId", "organizationId") REFERENCES "Order"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_shiftId_branchId_organizationId_fkey" FOREIGN KEY ("shiftId", "branchId", "organizationId") REFERENCES "CashShift"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_userId_branchId_organizationId_fkey" FOREIGN KEY ("userId", "branchId", "organizationId") REFERENCES "BranchMembership"("userId", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentRevision" ADD CONSTRAINT payment_revision_valid CHECK (revision >= 0);
ALTER TABLE "PaymentEvent" ADD CONSTRAINT payment_event_valid CHECK (revision > 0 AND jsonb_typeof(response)='object' AND (("orderId" IS NULL) <> ("shiftId" IS NULL)));
ALTER TABLE "Payment" ADD CONSTRAINT payment_valid CHECK (amount > 0 AND ((method='CASH' AND "shiftId" IS NOT NULL AND tendered IS NOT NULL AND change IS NOT NULL AND tendered >= amount AND change=tendered-amount AND "transactionReference" IS NULL) OR (method='CARD' AND "shiftId" IS NULL AND tendered IS NULL AND change IS NULL AND "transactionReference" IS NOT NULL AND length(trim("transactionReference")) >= 3)));
ALTER TABLE "PaymentReversal" ADD CONSTRAINT payment_reversal_valid CHECK (amount > 0 AND length(trim(reason)) > 0);
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT payment_allocation_valid CHECK ("unitNumber" BETWEEN 1 AND 999 AND amount >= 0);
ALTER TABLE "OrderSettlement" ADD CONSTRAINT settlement_valid CHECK (amount >= 0);
ALTER TABLE "CashShift" ADD CONSTRAINT cash_shift_valid CHECK (version > 0 AND "openingAmount" >= 0 AND ((status='OPEN' AND "closedAt" IS NULL AND "closingAmount" IS NULL AND "expectedAmount" IS NULL AND difference IS NULL AND "closingReason" IS NULL) OR (status='CLOSED' AND "closedAt" IS NOT NULL AND "closedAt">="openedAt" AND "closingAmount" IS NOT NULL AND "closingAmount">=0 AND "expectedAmount" IS NOT NULL AND "expectedAmount">=0 AND difference IS NOT NULL AND difference="closingAmount"-"expectedAmount" AND "closingReason" IS NOT NULL AND (difference=0 OR length(trim("closingReason"))>0))));
ALTER TABLE "CashMovement" ADD CONSTRAINT cash_movement_valid CHECK (length(trim(reason))>0 AND ((kind='OPENING' AND amount>=0 AND "paymentId" IS NULL AND "reversalId" IS NULL) OR (kind='CASH_IN' AND amount>0 AND "paymentId" IS NULL AND "reversalId" IS NULL) OR (kind='CASH_OUT' AND amount<0 AND "paymentId" IS NULL AND "reversalId" IS NULL) OR (kind='PAYMENT' AND amount>0 AND "paymentId" IS NOT NULL AND "reversalId" IS NULL) OR (kind='REVERSAL' AND amount<0 AND "paymentId" IS NULL AND "reversalId" IS NOT NULL)));
CREATE UNIQUE INDEX cash_one_open_terminal ON "CashShift" ("terminalId") WHERE status='OPEN';
CREATE UNIQUE INDEX cash_one_open_cashier ON "CashShift" ("branchId","cashierId") WHERE status='OPEN';
CREATE UNIQUE INDEX cash_one_opening ON "CashMovement" ("shiftId") WHERE kind='OPENING';

CREATE FUNCTION reject_payment_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Payment and cash history is immutable' USING ERRCODE='42501'; END; $$;
DO $$ DECLARE t TEXT; BEGIN FOREACH t IN ARRAY ARRAY['OrderBill','OrderSettlement','Payment','PaymentReversal','PaymentAllocation','CashMovement','PaymentEvent'] LOOP
 EXECUTE format('CREATE TRIGGER financial_no_change BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_payment_mutation()',t);
 EXECUTE format('CREATE TRIGGER financial_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION reject_payment_mutation()',t);
END LOOP; END $$;
CREATE TRIGGER cash_shift_no_delete BEFORE DELETE ON "CashShift" FOR EACH ROW EXECUTE FUNCTION reject_payment_mutation();
CREATE TRIGGER cash_shift_no_truncate BEFORE TRUNCATE ON "CashShift" FOR EACH STATEMENT EXECUTE FUNCTION reject_payment_mutation();

CREATE FUNCTION guard_billed_order() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS (SELECT 1 FROM "OrderBill" WHERE "orderId"=OLD.id) AND (
 NEW.status NOT IN ('WAITING_PAYMENT','PAID','CANCELLED') OR
 (NEW.subtotal,NEW.discount,NEW.tax,NEW.total,NEW."discountReason",NEW.notes,NEW."waiterId",NEW."waiterName") IS DISTINCT FROM
 (OLD.subtotal,OLD.discount,OLD.tax,OLD.total,OLD."discountReason",OLD.notes,OLD."waiterId",OLD."waiterName")) THEN RAISE EXCEPTION 'Billed order is frozen' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER billed_order_guard BEFORE UPDATE ON "Order" FOR EACH ROW EXECUTE FUNCTION guard_billed_order();
CREATE FUNCTION guard_payment_insert() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE o "Order"%ROWTYPE; BEGIN
 SELECT * INTO o FROM "Order" WHERE id=NEW."orderId" FOR UPDATE;
 IF o.status <> 'WAITING_PAYMENT' OR NOT EXISTS (SELECT 1 FROM "OrderBill" WHERE "orderId"=o.id) OR NOT EXISTS (SELECT 1 FROM "OrderItem" WHERE "orderId"=o.id AND "voidedAt" IS NULL) THEN RAISE EXCEPTION 'Payment requires a frozen waiting order' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER payment_insert_guard BEFORE INSERT ON "Payment" FOR EACH ROW EXECUTE FUNCTION guard_payment_insert();
CREATE FUNCTION guard_bill_insert() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE o "Order"%ROWTYPE; BEGIN
 SELECT * INTO o FROM "Order" WHERE id=NEW."orderId" FOR UPDATE;
 IF o.status<>'WAITING_PAYMENT' OR NOT EXISTS(SELECT 1 FROM "OrderItem" WHERE "orderId"=o.id AND "voidedAt" IS NULL) THEN RAISE EXCEPTION 'Billing requires a nonempty waiting order' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER bill_insert_guard BEFORE INSERT ON "OrderBill" FOR EACH ROW EXECUTE FUNCTION guard_bill_insert();
CREATE TRIGGER settlement_insert_guard BEFORE INSERT ON "OrderSettlement" FOR EACH ROW EXECUTE FUNCTION guard_bill_insert();
CREATE FUNCTION guard_reversal_insert() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE p "Payment"%ROWTYPE; o "Order"%ROWTYPE; reversed NUMERIC; BEGIN
 SELECT * INTO p FROM "Payment" WHERE id=NEW."paymentId";
 SELECT * INTO o FROM "Order" WHERE id=p."orderId" FOR UPDATE;
 SELECT COALESCE(sum(amount),0) INTO reversed FROM "PaymentReversal" WHERE "paymentId"=p.id;
 IF NEW.amount + reversed > p.amount OR
 (NEW.kind='CANCELLATION' AND (o.status<>'WAITING_PAYMENT' OR NEW.amount<>p.amount OR reversed<>0)) OR
 (NEW.kind='REFUND' AND (o.status<>'PAID' OR NOT EXISTS (SELECT 1 FROM "OrderSettlement" WHERE "orderId"=o.id))) OR
 (p.method='CASH' AND (NEW."shiftId" IS NULL OR NEW."transactionReference" IS NOT NULL)) OR
 (p.method='CARD' AND (NEW."shiftId" IS NOT NULL OR NEW."transactionReference" IS NULL OR length(trim(NEW."transactionReference"))<3)) THEN RAISE EXCEPTION 'Invalid payment reversal' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER reversal_insert_guard BEFORE INSERT ON "PaymentReversal" FOR EACH ROW EXECUTE FUNCTION guard_reversal_insert();
CREATE FUNCTION guard_cash_movement() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE s "CashShift"%ROWTYPE; balance NUMERIC; BEGIN
 SELECT * INTO s FROM "CashShift" WHERE id=NEW."shiftId" FOR UPDATE;
 SELECT COALESCE(sum(amount),0) INTO balance FROM "CashMovement" WHERE "shiftId"=s.id;
 IF s.status<>'OPEN' OR s."cashierId"<>NEW."cashierId" OR balance+NEW.amount<0 OR NOT EXISTS(SELECT 1 FROM "Terminal" WHERE id=s."terminalId" AND type='POS' AND active=true AND "deletedAt" IS NULL) THEN RAISE EXCEPTION 'Cash movement requires an open authorized drawer with sufficient cash' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER cash_movement_guard BEFORE INSERT ON "CashMovement" FOR EACH ROW EXECUTE FUNCTION guard_cash_movement();
CREATE FUNCTION guard_cash_shift_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.status='CLOSED' OR NEW.version<>OLD.version+1 OR
 (NEW.id,NEW."branchId",NEW."organizationId",NEW."cashierId",NEW."terminalId",NEW.currency,NEW."openingAmount",NEW."openedAt") IS DISTINCT FROM
 (OLD.id,OLD."branchId",OLD."organizationId",OLD."cashierId",OLD."terminalId",OLD.currency,OLD."openingAmount",OLD."openedAt") THEN RAISE EXCEPTION 'Cash shift history is immutable' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER cash_shift_update_guard BEFORE UPDATE ON "CashShift" FOR EACH ROW EXECUTE FUNCTION guard_cash_shift_update();

CREATE FUNCTION check_payment_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target UUID; o "Order"%ROWTYPE; bill "OrderBill"%ROWTYPE; settled "OrderSettlement"%ROWTYPE; collected NUMERIC; cancelled NUMERIC; payment_row RECORD; allocation_row RECORD; reversal_row RECORD; BEGIN
 IF TG_TABLE_NAME='Order' THEN target:=NEW.id;
 ELSIF TG_TABLE_NAME='PaymentReversal' THEN SELECT "orderId" INTO target FROM "Payment" WHERE id=NEW."paymentId";
 ELSE target:=NEW."orderId"; END IF;
 SELECT * INTO o FROM "Order" WHERE id=target;
 SELECT * INTO bill FROM "OrderBill" WHERE "orderId"=target;
 SELECT * INTO settled FROM "OrderSettlement" WHERE "orderId"=target;
 SELECT COALESCE(sum(amount),0) INTO collected FROM "Payment" WHERE "orderId"=target;
 SELECT COALESCE(sum(r.amount),0) INTO cancelled FROM "PaymentReversal" r JOIN "Payment" p ON p.id=r."paymentId" WHERE p."orderId"=target AND r.kind='CANCELLATION';
 IF (o.status='PAID') <> (settled."orderId" IS NOT NULL) OR collected-cancelled<0 OR collected-cancelled>o.total OR
 (settled."orderId" IS NOT NULL AND (bill."orderId" IS NULL OR (settled.amount,settled.currency) IS DISTINCT FROM (o.total,o.currency) OR collected-cancelled<>o.total OR NOT EXISTS(SELECT 1 FROM "OrderItem" WHERE "orderId"=target AND "voidedAt" IS NULL))) OR
 (o.total>0 AND collected-cancelled=o.total AND settled."orderId" IS NULL) OR
 (o.status='CANCELLED' AND collected<>cancelled) OR
 (bill."orderId" IS NOT NULL AND o.status NOT IN ('WAITING_PAYMENT','PAID','CANCELLED')) THEN RAISE EXCEPTION 'Order settlement must match valid receipts exactly' USING ERRCODE='23514'; END IF;
 FOR payment_row IN SELECT * FROM "Payment" WHERE "orderId"=target LOOP
   IF bill."orderId" IS NULL OR
    (bill.mode='AMOUNT' AND EXISTS(SELECT 1 FROM "PaymentAllocation" WHERE "paymentId"=payment_row.id)) OR
    (bill.mode='ITEMS' AND payment_row.amount<>COALESCE((SELECT sum(amount) FROM "PaymentAllocation" WHERE "paymentId"=payment_row.id),0)) OR
    (payment_row.method='CASH' AND NOT EXISTS(SELECT 1 FROM "CashMovement" m JOIN "CashShift" s ON s.id=m."shiftId" WHERE m."paymentId"=payment_row.id AND m.kind='PAYMENT' AND m.amount=payment_row.amount AND m."shiftId"=payment_row."shiftId" AND m."cashierId"=payment_row."cashierId" AND s.currency=o.currency)) THEN RAISE EXCEPTION 'Payment allocation or cash ledger mismatch' USING ERRCODE='23514'; END IF;
   IF (SELECT COALESCE(sum(amount),0) FROM "PaymentReversal" WHERE "paymentId"=payment_row.id)>payment_row.amount THEN RAISE EXCEPTION 'Reversals exceed payment' USING ERRCODE='23514'; END IF;
   FOR reversal_row IN SELECT * FROM "PaymentReversal" WHERE "paymentId"=payment_row.id LOOP
    IF (reversal_row.kind='CANCELLATION' AND (reversal_row.amount<>payment_row.amount OR (SELECT count(*) FROM "PaymentReversal" WHERE "paymentId"=payment_row.id)<>1)) OR (reversal_row.kind='REFUND' AND settled."orderId" IS NULL) OR
      (payment_row.method='CASH' AND NOT EXISTS(SELECT 1 FROM "CashMovement" m JOIN "CashShift" s ON s.id=m."shiftId" WHERE m."reversalId"=reversal_row.id AND m.kind='REVERSAL' AND m.amount=-reversal_row.amount AND m."shiftId"=reversal_row."shiftId" AND m."cashierId"=reversal_row."cashierId" AND s.currency=o.currency)) THEN RAISE EXCEPTION 'Reversal ledger mismatch' USING ERRCODE='23514'; END IF;
   END LOOP;
 END LOOP;
 FOR allocation_row IN SELECT al.*,i.quantity,i.total,i."voidedAt" FROM "PaymentAllocation" al JOIN "OrderItem" i ON i.id=al."itemId" WHERE al."orderId"=target LOOP
   IF allocation_row."voidedAt" IS NOT NULL OR allocation_row."unitNumber">allocation_row.quantity OR allocation_row.amount<>(trunc(allocation_row.total*100/allocation_row.quantity)+CASE WHEN allocation_row."unitNumber"<=mod(allocation_row.total*100,allocation_row.quantity) THEN 1 ELSE 0 END)/100 THEN RAISE EXCEPTION 'Item allocation does not match immutable unit total' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM "PaymentAllocation" a WHERE a."orderId"=target AND NOT EXISTS(SELECT 1 FROM "PaymentReversal" r WHERE r."paymentId"=a."paymentId" AND r.kind='CANCELLATION') GROUP BY a."itemId",a."unitNumber" HAVING count(*)>1) THEN RAISE EXCEPTION 'Item units cannot be paid twice' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
DO $$ DECLARE t TEXT; BEGIN FOREACH t IN ARRAY ARRAY['OrderBill','OrderSettlement','Payment','PaymentReversal','PaymentAllocation'] LOOP
 EXECUTE format('CREATE CONSTRAINT TRIGGER payment_integrity AFTER INSERT ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_payment_integrity()',t);
END LOOP; END $$;
CREATE CONSTRAINT TRIGGER order_payment_integrity AFTER INSERT OR UPDATE ON "Order" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_payment_integrity();

CREATE FUNCTION check_cash_integrity() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE target UUID; s "CashShift"%ROWTYPE; movement_row RECORD; expected NUMERIC; BEGIN
 IF TG_TABLE_NAME='CashShift' THEN target:=NEW.id; ELSE target:=NEW."shiftId"; END IF;
 SELECT * INTO s FROM "CashShift" WHERE id=target;
 SELECT COALESCE(sum(amount),0) INTO expected FROM "CashMovement" WHERE "shiftId"=target;
 IF expected<0 OR NOT EXISTS(SELECT 1 FROM "CashMovement" WHERE "shiftId"=target AND kind='OPENING' AND amount=s."openingAmount") OR (s.status='CLOSED' AND s."expectedAmount"<>expected) THEN RAISE EXCEPTION 'Cash count must reconcile with all movements' USING ERRCODE='23514'; END IF;
 FOR movement_row IN SELECT * FROM "CashMovement" WHERE "shiftId"=target LOOP
  IF movement_row."cashierId"<>s."cashierId" OR (movement_row.kind='PAYMENT' AND NOT EXISTS(SELECT 1 FROM "Payment" p JOIN "Order" o ON o.id=p."orderId" WHERE p.id=movement_row."paymentId" AND p.method='CASH' AND p.amount=movement_row.amount AND p."shiftId"=target AND p."cashierId"=movement_row."cashierId" AND o.currency=s.currency)) OR
  (movement_row.kind='REVERSAL' AND NOT EXISTS(SELECT 1 FROM "PaymentReversal" r JOIN "Payment" p ON p.id=r."paymentId" JOIN "Order" o ON o.id=p."orderId" WHERE r.id=movement_row."reversalId" AND p.method='CASH' AND r.amount=-movement_row.amount AND r."shiftId"=target AND r."cashierId"=movement_row."cashierId" AND o.currency=s.currency)) THEN RAISE EXCEPTION 'Cash movement source mismatch' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER shift_cash_integrity AFTER INSERT OR UPDATE ON "CashShift" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_cash_integrity();
CREATE CONSTRAINT TRIGGER movement_cash_integrity AFTER INSERT ON "CashMovement" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_cash_integrity();

CREATE OR REPLACE FUNCTION guard_submitted_order() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS (SELECT 1 FROM "KitchenSubmission" WHERE "orderId"=OLD.id) THEN
   IF NEW.status NOT IN ('SENT_TO_KITCHEN','PREPARING','READY','WAITING_PAYMENT','PAID','CANCELLED') OR
   (NEW.subtotal,NEW.discount,NEW.tax,NEW.total,NEW."discountReason",NEW.notes,NEW."waiterId",NEW."waiterName") IS DISTINCT FROM
   (OLD.subtotal,OLD.discount,OLD.tax,OLD.total,OLD."discountReason",OLD.notes,OLD."waiterId",OLD."waiterName") THEN RAISE EXCEPTION 'Submitted order cannot be financially or operationally rewritten' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION check_kitchen_integrity() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE target UUID; o "Order"%ROWTYPE; ticket RECORD; expected JSONB; BEGIN
 IF TG_TABLE_NAME='Order' THEN target:=NEW.id; ELSE target:=NEW."orderId"; END IF;
 SELECT * INTO o FROM "Order" WHERE id=target;
 IF NOT EXISTS (SELECT 1 FROM "KitchenSubmission" WHERE "orderId"=target) THEN RETURN NULL; END IF;
 IF o.status NOT IN ('SENT_TO_KITCHEN','PREPARING','READY','WAITING_PAYMENT','PAID','CANCELLED') THEN RAISE EXCEPTION 'Invalid submitted order status' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS (SELECT 1 FROM "KitchenTicket" WHERE "orderId"=target) OR EXISTS (SELECT 1 FROM "OrderItem" i WHERE i."orderId"=target AND i."voidedAt" IS NULL AND NOT EXISTS (SELECT 1 FROM "KitchenTicketItem" j WHERE j."itemId"=i.id)) THEN RAISE EXCEPTION 'Submission must route all active items' USING ERRCODE='23514'; END IF;
 IF o.status <> 'CANCELLED' THEN
   IF (o.status IN ('READY','WAITING_PAYMENT','PAID') AND EXISTS (SELECT 1 FROM "KitchenTicket" WHERE "orderId"=target AND status NOT IN ('READY','COMPLETED'))) OR
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

INSERT INTO "Permission" ("key",description,"updatedAt") VALUES ('payment.read','payment read',CURRENT_TIMESTAMP),('payment.collect','payment collect',CURRENT_TIMESTAMP),('payment.cancel','payment cancel',CURRENT_TIMESTAMP),('payment.refund','payment refund',CURRENT_TIMESTAMP),('cash.shift.read','cash shift read',CURRENT_TIMESTAMP),('cash.shift.manage','cash shift manage',CURRENT_TIMESTAMP),('cash.movement.manage','cash movement manage',CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;
DO $$ DECLARE r RECORD; before_keys JSONB; after_keys JSONB; BEGIN
 FOR r IN SELECT * FROM "Role" WHERE name='OWNER' AND protected=true LOOP
 SELECT COALESCE(jsonb_agg("permissionKey" ORDER BY "permissionKey"),'[]'::jsonb) INTO before_keys FROM "RolePermission" WHERE "roleId"=r.id;
 INSERT INTO "RolePermission" ("roleId","permissionKey") SELECT r.id,key FROM "Permission" WHERE key IN ('payment.read','payment.collect','payment.cancel','payment.refund','cash.shift.read','cash.shift.manage','cash.movement.manage') ON CONFLICT DO NOTHING;
 SELECT jsonb_agg("permissionKey" ORDER BY "permissionKey") INTO after_keys FROM "RolePermission" WHERE "roleId"=r.id;
 IF before_keys<>after_keys THEN INSERT INTO "AuditLog" (id,"organizationId",action,"entityType","entityId","beforeData","afterData") VALUES (gen_random_uuid(),r."organizationId",'role.permissions_migrated','Role',r.id::text,jsonb_build_object('permissions',before_keys),jsonb_build_object('permissions',after_keys,'migration','202609120003_payments')); END IF;
 END LOOP;
END $$;

COMMIT;
