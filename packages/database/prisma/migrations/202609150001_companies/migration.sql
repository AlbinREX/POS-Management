BEGIN;
-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRED', 'SUSPENDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'BIWEEKLY', 'WEEKLY');

-- CreateEnum
CREATE TYPE "CompanyEntryKind" AS ENUM ('CHARGE', 'PAYMENT', 'PAYMENT_REVERSAL');

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'COMPANY_ACCOUNT';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "companyId" UUID,
ADD COLUMN     "companyEmployeeId" UUID;

-- CreateTable
CREATE TABLE "Company" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "businessNumber" VARCHAR(80) NOT NULL DEFAULT '',
    "taxNumber" VARCHAR(80) NOT NULL DEFAULT '',
    "address" VARCHAR(500) NOT NULL DEFAULT '',
    "phone" VARCHAR(60) NOT NULL DEFAULT '',
    "email" VARCHAR(254) NOT NULL DEFAULT '',
    "contactPerson" VARCHAR(160) NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyContract" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "contractNumber" VARCHAR(80) NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "creditLimit" DECIMAL(14,2) NOT NULL,
    "discountPercentage" DECIMAL(5,2) NOT NULL,
    "paymentTermsDays" INTEGER NOT NULL,
    "billingCycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "notes" VARCHAR(2000) NOT NULL DEFAULT '',
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" CHAR(3) NOT NULL,
    "statusReason" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CompanyContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyEmployee" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "code" VARCHAR(60) NOT NULL DEFAULT '',
    "email" VARCHAR(254) NOT NULL DEFAULT '',
    "phone" VARCHAR(60) NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CompanyEmployee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyLedgerEntry" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "employeeId" UUID,
    "orderId" UUID,
    "paymentId" UUID,
    "userId" UUID NOT NULL,
    "kind" "CompanyEntryKind" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" VARCHAR(20),
    "reference" VARCHAR(120),
    "reason" VARCHAR(500) NOT NULL,
    "reversesId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyStatement" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "number" BIGINT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "openingBalance" DECIMAL(14,2) NOT NULL,
    "charges" DECIMAL(14,2) NOT NULL,
    "payments" DECIMAL(14,2) NOT NULL,
    "closingBalance" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyStatementLine" (
    "id" UUID NOT NULL,
    "statementId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "kind" "CompanyEntryKind" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "orderNumber" VARCHAR(40),
    "employeeName" VARCHAR(160),
    "reason" VARCHAR(500) NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyStatementLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompaniesRevision" (
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "revision" BIGINT NOT NULL DEFAULT 0,
    "nextNumber" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CompaniesRevision_pkey" PRIMARY KEY ("branchId")
);

-- CreateTable
CREATE TABLE "CompaniesEvent" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "commandId" UUID NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "revision" BIGINT NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "entityId" UUID NOT NULL,
    "companyId" UUID,
    "contractId" UUID,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompaniesEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Company_branchId_organizationId_deletedAt_name_id_idx" ON "Company"("branchId", "organizationId", "deletedAt", "name", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Company_id_branchId_organizationId_key" ON "Company"("id", "branchId", "organizationId");

-- CreateIndex
CREATE INDEX "CompanyContract_companyId_branchId_organizationId_status_id_idx" ON "CompanyContract"("companyId", "branchId", "organizationId", "status", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyContract_id_branchId_organizationId_key" ON "CompanyContract"("id", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyContract_id_companyId_branchId_organizationId_key" ON "CompanyContract"("id", "companyId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyContract_branchId_contractNumber_key" ON "CompanyContract"("branchId", "contractNumber");

-- CreateIndex
CREATE INDEX "CompanyEmployee_companyId_branchId_organizationId_deletedAt__idx" ON "CompanyEmployee"("companyId", "branchId", "organizationId", "deletedAt", "name");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyEmployee_id_branchId_organizationId_key" ON "CompanyEmployee"("id", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyEmployee_id_companyId_branchId_organizationId_key" ON "CompanyEmployee"("id", "companyId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyLedgerEntry_paymentId_key" ON "CompanyLedgerEntry"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyLedgerEntry_reversesId_key" ON "CompanyLedgerEntry"("reversesId");

-- CreateIndex
CREATE INDEX "CompanyLedgerEntry_companyId_branchId_organizationId_createdAt_id_idx" ON "CompanyLedgerEntry"("companyId", "branchId", "organizationId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "CompanyLedgerEntry_employeeId_branchId_organizationId_idx" ON "CompanyLedgerEntry"("employeeId", "branchId", "organizationId");

-- CreateIndex
CREATE INDEX "CompanyLedgerEntry_orderId_branchId_organizationId_idx" ON "CompanyLedgerEntry"("orderId", "branchId", "organizationId");

-- CreateIndex
CREATE INDEX "CompanyLedgerEntry_userId_branchId_organizationId_idx" ON "CompanyLedgerEntry"("userId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyLedgerEntry_id_branchId_organizationId_key" ON "CompanyLedgerEntry"("id", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyLedgerEntry_reversesId_branchId_organizationId_key" ON "CompanyLedgerEntry"("reversesId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyLedgerEntry_paymentId_branchId_organizationId_key" ON "CompanyLedgerEntry"("paymentId", "branchId", "organizationId");

-- CreateIndex
CREATE INDEX "CompanyStatement_companyId_branchId_organizationId_createdAt_id_idx" ON "CompanyStatement"("companyId", "branchId", "organizationId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "CompanyStatement_userId_branchId_organizationId_idx" ON "CompanyStatement"("userId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyStatement_id_branchId_organizationId_key" ON "CompanyStatement"("id", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyStatement_branchId_number_key" ON "CompanyStatement"("branchId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyStatement_branchId_companyId_periodStart_periodEnd_key" ON "CompanyStatement"("branchId", "companyId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "CompanyStatementLine_entryId_branchId_organizationId_idx" ON "CompanyStatementLine"("entryId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyStatementLine_id_branchId_organizationId_key" ON "CompanyStatementLine"("id", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyStatementLine_statementId_entryId_key" ON "CompanyStatementLine"("statementId", "entryId");

-- CreateIndex
CREATE UNIQUE INDEX "CompaniesRevision_branchId_organizationId_key" ON "CompaniesRevision"("branchId", "organizationId");

-- CreateIndex
CREATE INDEX "CompaniesEvent_branchId_organizationId_revision_idx" ON "CompaniesEvent"("branchId", "organizationId", "revision");

-- CreateIndex
CREATE INDEX "CompaniesEvent_companyId_branchId_organizationId_idx" ON "CompaniesEvent"("companyId", "branchId", "organizationId");

-- CreateIndex
CREATE INDEX "CompaniesEvent_contractId_branchId_organizationId_idx" ON "CompaniesEvent"("contractId", "branchId", "organizationId");

-- CreateIndex
CREATE INDEX "CompaniesEvent_userId_branchId_organizationId_idx" ON "CompaniesEvent"("userId", "branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CompaniesEvent_branchId_commandId_key" ON "CompaniesEvent"("branchId", "commandId");

-- CreateIndex
CREATE UNIQUE INDEX "CompaniesEvent_branchId_revision_key" ON "CompaniesEvent"("branchId", "revision");

-- CreateIndex
CREATE INDEX "Payment_companyId_branchId_organizationId_idx" ON "Payment"("companyId", "branchId", "organizationId");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyContract" ADD CONSTRAINT "CompanyContract_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyContract" ADD CONSTRAINT "CompanyContract_companyId_branchId_organizationId_fkey" FOREIGN KEY ("companyId", "branchId", "organizationId") REFERENCES "Company"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyEmployee" ADD CONSTRAINT "CompanyEmployee_companyId_branchId_organizationId_fkey" FOREIGN KEY ("companyId", "branchId", "organizationId") REFERENCES "Company"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyLedgerEntry" ADD CONSTRAINT "CompanyLedgerEntry_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyLedgerEntry" ADD CONSTRAINT "CompanyLedgerEntry_companyId_branchId_organizationId_fkey" FOREIGN KEY ("companyId", "branchId", "organizationId") REFERENCES "Company"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyLedgerEntry" ADD CONSTRAINT "CompanyLedgerEntry_employeeId_companyId_branchId_organizati_fkey" FOREIGN KEY ("employeeId", "companyId", "branchId", "organizationId") REFERENCES "CompanyEmployee"("id", "companyId", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyLedgerEntry" ADD CONSTRAINT "CompanyLedgerEntry_orderId_branchId_organizationId_fkey" FOREIGN KEY ("orderId", "branchId", "organizationId") REFERENCES "Order"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyLedgerEntry" ADD CONSTRAINT "CompanyLedgerEntry_paymentId_branchId_organizationId_fkey" FOREIGN KEY ("paymentId", "branchId", "organizationId") REFERENCES "Payment"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyLedgerEntry" ADD CONSTRAINT "CompanyLedgerEntry_userId_branchId_organizationId_fkey" FOREIGN KEY ("userId", "branchId", "organizationId") REFERENCES "BranchMembership"("userId", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyLedgerEntry" ADD CONSTRAINT "CompanyLedgerEntry_reversesId_branchId_organizationId_fkey" FOREIGN KEY ("reversesId", "branchId", "organizationId") REFERENCES "CompanyLedgerEntry"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyStatement" ADD CONSTRAINT "CompanyStatement_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyStatement" ADD CONSTRAINT "CompanyStatement_companyId_branchId_organizationId_fkey" FOREIGN KEY ("companyId", "branchId", "organizationId") REFERENCES "Company"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyStatement" ADD CONSTRAINT "CompanyStatement_contractId_companyId_branchId_organization_fkey" FOREIGN KEY ("contractId", "companyId", "branchId", "organizationId") REFERENCES "CompanyContract"("id", "companyId", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyStatement" ADD CONSTRAINT "CompanyStatement_userId_branchId_organizationId_fkey" FOREIGN KEY ("userId", "branchId", "organizationId") REFERENCES "BranchMembership"("userId", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyStatementLine" ADD CONSTRAINT "CompanyStatementLine_statementId_branchId_organizationId_fkey" FOREIGN KEY ("statementId", "branchId", "organizationId") REFERENCES "CompanyStatement"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyStatementLine" ADD CONSTRAINT "CompanyStatementLine_entryId_branchId_organizationId_fkey" FOREIGN KEY ("entryId", "branchId", "organizationId") REFERENCES "CompanyLedgerEntry"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompaniesRevision" ADD CONSTRAINT "CompaniesRevision_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompaniesEvent" ADD CONSTRAINT "CompaniesEvent_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompaniesEvent" ADD CONSTRAINT "CompaniesEvent_userId_branchId_organizationId_fkey" FOREIGN KEY ("userId", "branchId", "organizationId") REFERENCES "BranchMembership"("userId", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_companyId_branchId_organizationId_fkey" FOREIGN KEY ("companyId", "branchId", "organizationId") REFERENCES "Company"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_companyEmployeeId_companyId_branchId_organizationId_fkey" FOREIGN KEY ("companyEmployeeId", "companyId", "branchId", "organizationId") REFERENCES "CompanyEmployee"("id", "companyId", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Company" ADD CONSTRAINT company_valid CHECK (length(trim(name))>0 AND version>0 AND ("deletedAt" IS NULL OR NOT active));
ALTER TABLE "CompanyContract" ADD CONSTRAINT contract_valid CHECK (length(trim("contractNumber"))>0 AND version>0 AND "creditLimit">=0 AND "discountPercentage" BETWEEN 0 AND 100 AND "paymentTermsDays" BETWEEN 0 AND 365 AND ("endDate" IS NULL OR "endDate">="startDate") AND (status::text<>'DRAFT' OR "statusReason" IS NULL));
ALTER TABLE "CompanyEmployee" ADD CONSTRAINT company_employee_valid CHECK (length(trim(name))>0 AND version>0 AND ("deletedAt" IS NULL OR NOT active));
ALTER TABLE "CompanyLedgerEntry" ADD CONSTRAINT company_entry_valid CHECK (length(trim(reason))>0 AND (
 (kind::text='CHARGE' AND amount>0 AND "orderId" IS NOT NULL AND "paymentId" IS NOT NULL AND method IS NULL AND reference IS NULL AND "reversesId" IS NULL) OR
 (kind::text='PAYMENT' AND amount<0 AND "orderId" IS NULL AND "paymentId" IS NULL AND "employeeId" IS NULL AND method IS NOT NULL AND reference IS NOT NULL AND method IN ('BANK_TRANSFER','CASH','CARD','OTHER') AND length(trim(reference))>0 AND "reversesId" IS NULL) OR
 (kind::text='PAYMENT_REVERSAL' AND amount>0 AND "orderId" IS NULL AND "paymentId" IS NULL AND "employeeId" IS NULL AND method IS NULL AND reference IS NULL AND "reversesId" IS NOT NULL)));
CREATE UNIQUE INDEX company_order_one_charge ON "CompanyLedgerEntry" ("orderId") WHERE kind='CHARGE';
CREATE UNIQUE INDEX company_payment_reference ON "CompanyLedgerEntry" ("branchId","companyId",upper(trim(reference))) WHERE kind='PAYMENT';
ALTER TABLE "CompanyStatement" ADD CONSTRAINT company_statement_valid CHECK (number>0 AND "periodEnd">="periodStart" AND "dueDate">="periodEnd" AND charges>=0 AND payments<=0 AND "closingBalance"="openingBalance"+charges+payments);
ALTER TABLE "CompanyStatementLine" ADD CONSTRAINT company_statement_line_valid CHECK (length(trim(reason))>0 AND amount<>0);
ALTER TABLE "CompaniesRevision" ADD CONSTRAINT companies_revision_valid CHECK (revision>=0 AND "nextNumber">=0);
ALTER TABLE "CompaniesEvent" ADD CONSTRAINT companies_event_valid CHECK (revision>0 AND jsonb_typeof(response)='object' AND "requestHash" ~ '^[0-9a-f]{64}$');

DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['CompanyLedgerEntry','CompanyStatement','CompanyStatementLine','CompaniesEvent'] LOOP
  EXECUTE format('CREATE TRIGGER companies_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_inventory_mutation()',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['Company','CompanyContract','CompanyEmployee'] LOOP
  EXECUTE format('CREATE TRIGGER companies_no_delete BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_inventory_mutation()',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['Company','CompanyContract','CompanyEmployee','CompanyLedgerEntry','CompanyStatement','CompanyStatementLine','CompaniesEvent'] LOOP
  EXECUTE format('CREATE TRIGGER companies_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION reject_inventory_mutation()',t);
 END LOOP;
END $$;

CREATE FUNCTION guard_company_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (NEW.id,NEW."branchId",NEW."organizationId",NEW."createdAt") IS DISTINCT FROM (OLD.id,OLD."branchId",OLD."organizationId",OLD."createdAt") OR NEW.version<>OLD.version+1 OR OLD."deletedAt" IS NOT NULL THEN RAISE EXCEPTION 'Company identity/version/archive is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER company_identity BEFORE UPDATE ON "Company" FOR EACH ROW EXECUTE FUNCTION guard_company_identity();
CREATE TRIGGER company_employee_identity BEFORE UPDATE ON "CompanyEmployee" FOR EACH ROW EXECUTE FUNCTION guard_company_identity();

CREATE FUNCTION guard_contract_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (NEW.id,NEW."companyId",NEW."branchId",NEW."organizationId",NEW."createdAt",NEW.currency) IS DISTINCT FROM (OLD.id,OLD."companyId",OLD."branchId",OLD."organizationId",OLD."createdAt",OLD.currency) OR NEW.version<>OLD.version+1 OR OLD.status::text='TERMINATED' THEN RAISE EXCEPTION 'Contract identity/version is immutable and terminated contracts are final' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER contract_identity BEFORE UPDATE ON "CompanyContract" FOR EACH ROW EXECUTE FUNCTION guard_contract_identity();

-- A charge must accompany its own newly inserted COMPANY_ACCOUNT payment; a reversal must
-- match an unreversed original payment on the same company.
CREATE FUNCTION guard_company_entry() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.kind::text='CHARGE' AND NOT EXISTS(SELECT 1 FROM "Payment" WHERE id=NEW."paymentId" AND method::text='COMPANY_ACCOUNT' AND "companyId"=NEW."companyId" AND amount=NEW.amount AND "orderId"=NEW."orderId" AND xmin::text=(txid_current()%4294967296)::text) THEN RAISE EXCEPTION 'Company charge requires its newly recorded account payment' USING ERRCODE='23514'; END IF;
 IF NEW.kind::text='PAYMENT_REVERSAL' AND NOT EXISTS(SELECT 1 FROM "CompanyLedgerEntry" WHERE id=NEW."reversesId" AND kind::text='PAYMENT' AND "companyId"=NEW."companyId" AND amount=-NEW.amount) THEN RAISE EXCEPTION 'Reversal must reference and match original company payment' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER company_entry_guard BEFORE INSERT ON "CompanyLedgerEntry" FOR EACH ROW EXECUTE FUNCTION guard_company_entry();

-- Authoritative credit backstop: the account balance may never exceed the active
-- contract limit, and may never go negative through over-payment.
-- Only a CHARGE is gated on an active contract and its limit. Payments and correction
-- reversals must stay possible after a contract expires or is terminated, so a company
-- can always settle or correct an outstanding balance.
CREATE FUNCTION check_company_credit() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE balance NUMERIC; limit_amount NUMERIC; BEGIN
 SELECT COALESCE(sum(amount),0) INTO balance FROM "CompanyLedgerEntry" WHERE "companyId"=NEW."companyId";
 IF balance<0 THEN RAISE EXCEPTION 'Company payments exceed the recorded account balance' USING ERRCODE='23514'; END IF;
 IF NEW.kind::text='CHARGE' THEN
  SELECT "creditLimit" INTO limit_amount FROM "CompanyContract" WHERE "companyId"=NEW."companyId" AND status::text='ACTIVE' ORDER BY "startDate" DESC, id LIMIT 1;
  IF limit_amount IS NULL THEN RAISE EXCEPTION 'Company charges require an active contract' USING ERRCODE='23514'; END IF;
  IF balance>limit_amount THEN RAISE EXCEPTION 'Company credit limit exceeded' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER company_credit AFTER INSERT ON "CompanyLedgerEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_company_credit();

-- A statement must reproduce exactly the entries of its period and balance to its closing figure.
CREATE FUNCTION check_statement_complete() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE sid UUID; s RECORD; sums RECORD; BEGIN
 IF TG_TABLE_NAME='CompanyStatement' THEN sid:=NEW.id; ELSE sid:=NEW."statementId"; END IF;
 SELECT * INTO s FROM "CompanyStatement" WHERE id=sid;
 SELECT count(*) AS count,COALESCE(sum(amount) FILTER(WHERE kind::text='CHARGE'),0) AS charges,COALESCE(sum(amount) FILTER(WHERE kind::text<>'CHARGE'),0) AS payments INTO sums FROM "CompanyStatementLine" WHERE "statementId"=sid;
 IF sums.charges<>s.charges OR sums.payments<>s.payments OR EXISTS(SELECT 1 FROM "CompanyStatementLine" l JOIN "CompanyLedgerEntry" e ON e.id=l."entryId" WHERE l."statementId"=sid AND (e."companyId"<>s."companyId" OR l.amount<>e.amount OR l.kind<>e.kind OR e."createdAt"::date<s."periodStart" OR e."createdAt"::date>s."periodEnd")) THEN RAISE EXCEPTION 'Statement lines must match the period ledger exactly' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER statement_complete AFTER INSERT ON "CompanyStatement" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_statement_complete();
CREATE CONSTRAINT TRIGGER statement_line_complete AFTER INSERT ON "CompanyStatementLine" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_statement_complete();

-- Extend the payment whitelist with the company house account. The new enum value is
-- uncommitted inside this transaction, so every new-value test casts the enum to text.
ALTER TABLE "Payment" DROP CONSTRAINT payment_valid;
ALTER TABLE "Payment" ADD CONSTRAINT payment_valid CHECK (amount > 0 AND ((method::text='CASH' AND "shiftId" IS NOT NULL AND tendered IS NOT NULL AND change IS NOT NULL AND tendered >= amount AND change=tendered-amount AND "transactionReference" IS NULL AND "companyId" IS NULL AND "companyEmployeeId" IS NULL) OR (method::text='CARD' AND "shiftId" IS NULL AND tendered IS NULL AND change IS NULL AND "transactionReference" IS NOT NULL AND length(trim("transactionReference")) >= 3 AND "companyId" IS NULL AND "companyEmployeeId" IS NULL) OR (method::text='COMPANY_ACCOUNT' AND "shiftId" IS NULL AND tendered IS NULL AND change IS NULL AND "transactionReference" IS NULL AND "companyId" IS NOT NULL)));

-- Reversals of a house-account payment take no cash shift and no external card reference.
CREATE OR REPLACE FUNCTION guard_reversal_insert() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE p "Payment"%ROWTYPE; o "Order"%ROWTYPE; reversed NUMERIC; BEGIN
 SELECT * INTO p FROM "Payment" WHERE id=NEW."paymentId";
 SELECT * INTO o FROM "Order" WHERE id=p."orderId" FOR UPDATE;
 SELECT COALESCE(sum(amount),0) INTO reversed FROM "PaymentReversal" WHERE "paymentId"=p.id;
 IF NEW.amount + reversed > p.amount OR
 (NEW.kind='CANCELLATION' AND (o.status<>'WAITING_PAYMENT' OR NEW.amount<>p.amount OR reversed<>0)) OR
 (NEW.kind='REFUND' AND (o.status<>'PAID' OR NOT EXISTS (SELECT 1 FROM "OrderSettlement" WHERE "orderId"=o.id))) OR
 (p.method::text='CASH' AND (NEW."shiftId" IS NULL OR NEW."transactionReference" IS NOT NULL)) OR
 (p.method::text='CARD' AND (NEW."shiftId" IS NOT NULL OR NEW."transactionReference" IS NULL OR length(trim(NEW."transactionReference"))<3)) OR
 (p.method::text='COMPANY_ACCOUNT' AND (NEW."shiftId" IS NOT NULL OR NEW."transactionReference" IS NOT NULL)) THEN RAISE EXCEPTION 'Invalid payment reversal' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;

-- A house-account payment is backed by its ledger charge instead of a drawer movement.
CREATE OR REPLACE FUNCTION check_payment_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target UUID; o "Order"%ROWTYPE; bill "OrderBill"%ROWTYPE; settled "OrderSettlement"%ROWTYPE; collected NUMERIC; cancelled NUMERIC; payment_row RECORD; reversal_row RECORD; allocation_row RECORD; BEGIN
 IF TG_TABLE_NAME='Order' THEN target:=NEW.id; ELSIF TG_TABLE_NAME='PaymentReversal' THEN SELECT "orderId" INTO target FROM "Payment" WHERE id=NEW."paymentId"; ELSE target:=NEW."orderId"; END IF;
 SELECT * INTO o FROM "Order" WHERE id=target;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO bill FROM "OrderBill" WHERE "orderId"=target;
 SELECT * INTO settled FROM "OrderSettlement" WHERE "orderId"=target;
 SELECT COALESCE(sum(amount),0) INTO collected FROM "Payment" WHERE "orderId"=target;
 SELECT COALESCE(sum(r.amount),0) INTO cancelled FROM "PaymentReversal" r JOIN "Payment" p ON p.id=r."paymentId" WHERE p."orderId"=target AND r.kind='CANCELLATION';
 IF (o.status='PAID') <> (settled."orderId" IS NOT NULL) OR collected-cancelled<0 OR collected-cancelled>o.total OR
  (settled."orderId" IS NOT NULL AND (bill."orderId" IS NULL OR (settled.amount,settled.currency) IS DISTINCT FROM (o.total,o.currency) OR collected-cancelled<>o.total OR NOT EXISTS(SELECT 1 FROM "OrderItem" WHERE "orderId"=target AND "voidedAt" IS NULL))) OR
  (o.total>0 AND collected-cancelled=o.total AND settled."orderId" IS NULL) THEN RAISE EXCEPTION 'Order settlement does not match its payments' USING ERRCODE='23514'; END IF;
 FOR payment_row IN SELECT * FROM "Payment" WHERE "orderId"=target LOOP
   IF bill."orderId" IS NULL OR
    (bill.mode='AMOUNT' AND EXISTS(SELECT 1 FROM "PaymentAllocation" WHERE "paymentId"=payment_row.id)) OR
    (bill.mode='ITEMS' AND payment_row.amount<>COALESCE((SELECT sum(amount) FROM "PaymentAllocation" WHERE "paymentId"=payment_row.id),0)) OR
    (payment_row.method::text='CASH' AND NOT EXISTS(SELECT 1 FROM "CashMovement" m JOIN "CashShift" s ON s.id=m."shiftId" WHERE m."paymentId"=payment_row.id AND m.kind='PAYMENT' AND m.amount=payment_row.amount AND m."shiftId"=payment_row."shiftId" AND m."cashierId"=payment_row."cashierId" AND s.currency=o.currency)) OR
    (payment_row.method::text='COMPANY_ACCOUNT' AND NOT EXISTS(SELECT 1 FROM "CompanyLedgerEntry" e WHERE e."paymentId"=payment_row.id AND e.kind::text='CHARGE' AND e.amount=payment_row.amount AND e."companyId"=payment_row."companyId" AND e."orderId"=target)) OR
    (payment_row.method::text<>'COMPANY_ACCOUNT' AND EXISTS(SELECT 1 FROM "CompanyLedgerEntry" e WHERE e."paymentId"=payment_row.id)) THEN RAISE EXCEPTION 'Payment allocation or cash ledger mismatch' USING ERRCODE='23514'; END IF;
   IF (SELECT COALESCE(sum(amount),0) FROM "PaymentReversal" WHERE "paymentId"=payment_row.id)>payment_row.amount THEN RAISE EXCEPTION 'Reversals exceed payment' USING ERRCODE='23514'; END IF;
   FOR reversal_row IN SELECT * FROM "PaymentReversal" WHERE "paymentId"=payment_row.id LOOP
    IF (reversal_row.kind='CANCELLATION' AND (reversal_row.amount<>payment_row.amount OR (SELECT count(*) FROM "PaymentReversal" WHERE "paymentId"=payment_row.id)<>1)) OR (reversal_row.kind='REFUND' AND settled."orderId" IS NULL) OR
      (payment_row.method::text='CASH' AND NOT EXISTS(SELECT 1 FROM "CashMovement" m JOIN "CashShift" s ON s.id=m."shiftId" WHERE m."reversalId"=reversal_row.id AND m.kind='REVERSAL' AND m.amount=-reversal_row.amount AND m."shiftId"=reversal_row."shiftId" AND m."cashierId"=reversal_row."cashierId" AND s.currency=o.currency)) THEN RAISE EXCEPTION 'Reversal ledger mismatch' USING ERRCODE='23514'; END IF;
   END LOOP;
 END LOOP;
 FOR allocation_row IN SELECT al.*,i.quantity,i.total,i."voidedAt" FROM "PaymentAllocation" al JOIN "OrderItem" i ON i.id=al."itemId" WHERE al."orderId"=target LOOP
   IF allocation_row."voidedAt" IS NOT NULL OR allocation_row."unitNumber">allocation_row.quantity OR allocation_row.amount<>(trunc(allocation_row.total*100/allocation_row.quantity)+CASE WHEN allocation_row."unitNumber"<=mod(allocation_row.total*100,allocation_row.quantity) THEN 1 ELSE 0 END)/100 THEN RAISE EXCEPTION 'Item allocation does not match immutable unit total' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM "PaymentAllocation" a WHERE a."orderId"=target AND NOT EXISTS(SELECT 1 FROM "PaymentReversal" r WHERE r."paymentId"=a."paymentId" AND r.kind='CANCELLATION') GROUP BY a."itemId",a."unitNumber" HAVING count(*)>1) THEN RAISE EXCEPTION 'Item units cannot be paid twice' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;

INSERT INTO "Permission" ("key",description,"updatedAt") VALUES ('company.read','company read',CURRENT_TIMESTAMP),('company.manage','company manage',CURRENT_TIMESTAMP),('contract.manage','contract manage',CURRENT_TIMESTAMP),('company.charge','company charge',CURRENT_TIMESTAMP),('company.payment.record','company payment record',CURRENT_TIMESTAMP),('company.payment.reverse','company payment reverse',CURRENT_TIMESTAMP),('company.statement.manage','company statement manage',CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;
DO $$ DECLARE r RECORD; before_keys JSONB; after_keys JSONB; BEGIN
 FOR r IN SELECT * FROM "Role" WHERE name='OWNER' AND protected=true LOOP
 SELECT COALESCE(jsonb_agg("permissionKey" ORDER BY "permissionKey"),'[]'::jsonb) INTO before_keys FROM "RolePermission" WHERE "roleId"=r.id;
 INSERT INTO "RolePermission" ("roleId","permissionKey") SELECT r.id,key FROM "Permission" WHERE key IN ('company.read','company.manage','contract.manage','company.charge','company.payment.record','company.payment.reverse','company.statement.manage') ON CONFLICT DO NOTHING;
 SELECT jsonb_agg("permissionKey" ORDER BY "permissionKey") INTO after_keys FROM "RolePermission" WHERE "roleId"=r.id;
 IF before_keys<>after_keys THEN INSERT INTO "AuditLog" (id,"organizationId",action,"entityType","entityId","beforeData","afterData") VALUES (gen_random_uuid(),r."organizationId",'role.permissions_migrated','Role',r.id::text,jsonb_build_object('permissions',before_keys),jsonb_build_object('permissions',after_keys,'migration','202609150001_companies')); END IF;
 END LOOP;
END $$;

-- AddForeignKey
ALTER TABLE "CompaniesEvent" ADD CONSTRAINT "CompaniesEvent_companyId_branchId_organizationId_fkey" FOREIGN KEY ("companyId", "branchId", "organizationId") REFERENCES "Company"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompaniesEvent" ADD CONSTRAINT "CompaniesEvent_contractId_branchId_organizationId_fkey" FOREIGN KEY ("contractId", "branchId", "organizationId") REFERENCES "CompanyContract"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
