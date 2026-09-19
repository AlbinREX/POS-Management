BEGIN;
-- Phase 15 device management.
--
-- FastFood Riza runs on one Windows PC: the POS, the local API, PostgreSQL and every
-- hardware integration share that machine. This migration records which hardware exists,
-- which printer each kitchen station uses, whether a document has been delivered, and
-- which staff card belongs to which person.
--
-- Two safety properties shape every table here.
--
-- First, an address is configuration, never client input. A COM port, a LAN host and a
-- TCP port are stored only on Device, written only by an operator holding device.manage.
-- A print or test request names a saved device by id, so no request can point restaurant
-- hardware at a destination of its choosing.
--
-- Second, delivery is strictly downstream of business truth. A PrintJob references a
-- ticket or an order but can never alter one: an unprinted ticket is still a valid
-- ticket, and a failed receipt never unsettles a sale. No trigger, constraint or grant
-- in this migration can touch an order, payment, settlement, ticket or ledger row.
CREATE TABLE "Device" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "terminalId" UUID,
    "kind" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "connection" VARCHAR(20) NOT NULL,
    "port" VARCHAR(20),
    "baudRate" INTEGER,
    "host" VARCHAR(120),
    "tcpPort" INTEGER,
    "windowsPrinterName" VARCHAR(160),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastSeenAt" TIMESTAMPTZ(3),
    "lastTestAt" TIMESTAMPTZ(3),
    "lastError" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),
    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Device_id_branchId_organizationId_key" ON "Device"("id", "branchId", "organizationId");
-- Device names are unique per branch, matching how terminals are already named, so an
-- operator choosing a printer from a list can never face two identical entries.
CREATE UNIQUE INDEX "Device_branchId_name_key" ON "Device"("branchId", "name");
CREATE INDEX "Device_branchId_organizationId_kind_enabled_deletedAt_idx" ON "Device"("branchId", "organizationId", "kind", "enabled", "deletedAt");
ALTER TABLE "Device" ADD CONSTRAINT "Device_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Device" ADD CONSTRAINT "Device_terminalId_branchId_organizationId_fkey" FOREIGN KEY ("terminalId", "branchId", "organizationId") REFERENCES "Terminal"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Only the four known device kinds and four connection types are storable, so a typo
-- cannot create a row that no adapter drives and no operator view surfaces.
ALTER TABLE "Device" ADD CONSTRAINT "Device_kind_valid" CHECK ("kind" IN ('RECEIPT_PRINTER','KITCHEN_PRINTER','BAR_PRINTER','NFC_READER'));
ALTER TABLE "Device" ADD CONSTRAINT "Device_connection_valid" CHECK ("connection" IN ('SERIAL','USB','WINDOWS_PRINTER','NETWORK'));
-- An address must be complete for its connection type. A half-addressed device would
-- fail at print time on a busy service rather than at configuration time.
ALTER TABLE "Device" ADD CONSTRAINT "Device_address_valid" CHECK (
    ("connection" = 'SERIAL' AND "port" IS NOT NULL AND "host" IS NULL)
 OR ("connection" = 'USB' AND ("port" IS NOT NULL) <> ("windowsPrinterName" IS NOT NULL) AND "host" IS NULL)
 OR ("connection" = 'WINDOWS_PRINTER' AND "windowsPrinterName" IS NOT NULL AND "host" IS NULL)
 OR ("connection" = 'NETWORK' AND "host" IS NOT NULL AND "tcpPort" IS NOT NULL AND "port" IS NULL)
);
-- A network port is never privileged, and a serial rate is always a standard one.
ALTER TABLE "Device" ADD CONSTRAINT "Device_tcpPort_valid" CHECK ("tcpPort" IS NULL OR ("tcpPort" >= 1024 AND "tcpPort" <= 65535));
ALTER TABLE "Device" ADD CONSTRAINT "Device_baudRate_valid" CHECK ("baudRate" IS NULL OR "baudRate" IN (9600,19200,38400,57600,115200));
-- An NFC reader is a local device; it is never addressed over the network.
ALTER TABLE "Device" ADD CONSTRAINT "Device_nfc_local" CHECK ("kind" <> 'NFC_READER' OR "connection" <> 'NETWORK');

-- Which printer a kitchen station prints to. At most one per station, and several
-- stations may deliberately share one device: a small kitchen often runs a single
-- printer for every line. A station with no row here is unrouted, and its tickets fail
-- visibly rather than being sent to some default device.
CREATE TABLE "StationPrinter" (
    "stationId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "StationPrinter_pkey" PRIMARY KEY ("stationId")
);
CREATE UNIQUE INDEX "StationPrinter_stationId_branchId_organizationId_key" ON "StationPrinter"("stationId", "branchId", "organizationId");
CREATE INDEX "StationPrinter_deviceId_branchId_organizationId_idx" ON "StationPrinter"("deviceId", "branchId", "organizationId");
ALTER TABLE "StationPrinter" ADD CONSTRAINT "StationPrinter_stationId_branchId_organizationId_fkey" FOREIGN KEY ("stationId", "branchId", "organizationId") REFERENCES "KitchenStation"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StationPrinter" ADD CONSTRAINT "StationPrinter_deviceId_branchId_organizationId_fkey" FOREIGN KEY ("deviceId", "branchId", "organizationId") REFERENCES "Device"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StationPrinter" ADD CONSTRAINT "StationPrinter_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Delivery of one document to one device.
CREATE TABLE "PrintJob" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "documentId" VARCHAR(120) NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "deviceId" UUID,
    "ticketId" UUID,
    "orderId" UUID,
    "state" VARCHAR(20) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL,
    "lastError" VARCHAR(500),
    "lastAttemptAt" TIMESTAMPTZ(3),
    "confirmedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "PrintJob_pkey" PRIMARY KEY ("id")
);
-- The document identity is the idempotency key. A kitchen ticket's print contract keeps
-- one documentId across ticket version bumps but produces a different one once the
-- ticket is cancelled, so a reprint can never create a second job and a cancellation
-- always gets its own. This index is what makes that guarantee real.
CREATE UNIQUE INDEX "PrintJob_branchId_organizationId_documentId_key" ON "PrintJob"("branchId", "organizationId", "documentId");
CREATE INDEX "PrintJob_branchId_organizationId_state_createdAt_id_idx" ON "PrintJob"("branchId", "organizationId", "state", "createdAt", "id");
CREATE INDEX "PrintJob_deviceId_branchId_organizationId_idx" ON "PrintJob"("deviceId", "branchId", "organizationId");
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_deviceId_branchId_organizationId_fkey" FOREIGN KEY ("deviceId", "branchId", "organizationId") REFERENCES "Device"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_state_valid" CHECK ("state" IN ('PENDING','SENT','CONFIRMED','FAILED','RETRY_REQUIRED'));
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_kind_valid" CHECK ("kind" IN ('RECEIPT_PRINTER','KITCHEN_PRINTER','BAR_PRINTER'));
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_attempts_valid" CHECK ("attempts" >= 0);
-- A confirmed job carries its confirmation time, and an unconfirmed one never claims to.
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_confirmed_valid" CHECK (("state" = 'CONFIRMED') = ("confirmedAt" IS NOT NULL));

-- A staff NFC card. Only a hash is stored, with the same argon2id parameters used for
-- passwords, so the database never holds a value that could be written onto a blank
-- card. managerPinHash backs the second factor for overrides.
CREATE TABLE "UserNfcCredential" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "credentialHash" TEXT NOT NULL,
    "label" VARCHAR(60) NOT NULL,
    "managerPinHash" TEXT,
    "enrolledBy" UUID NOT NULL,
    "lastUsedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "UserNfcCredential_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "UserNfcCredential_branchId_organizationId_revokedAt_idx" ON "UserNfcCredential"("branchId", "organizationId", "revokedAt");
CREATE INDEX "UserNfcCredential_userId_branchId_organizationId_idx" ON "UserNfcCredential"("userId", "branchId", "organizationId");
CREATE INDEX "UserNfcCredential_enrolledBy_branchId_organizationId_idx" ON "UserNfcCredential"("enrolledBy", "branchId", "organizationId");
ALTER TABLE "UserNfcCredential" ADD CONSTRAINT "UserNfcCredential_userId_branchId_organizationId_fkey" FOREIGN KEY ("userId", "branchId", "organizationId") REFERENCES "BranchMembership"("userId", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserNfcCredential" ADD CONSTRAINT "UserNfcCredential_enrolledBy_branchId_organizationId_fkey" FOREIGN KEY ("enrolledBy", "branchId", "organizationId") REFERENCES "BranchMembership"("userId", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserNfcCredential" ADD CONSTRAINT "UserNfcCredential_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
-- A stored credential is always a hash, never a raw card value. Argon2 encodings begin
-- with $argon2, so a plain UID written here by mistake is rejected by the database.
ALTER TABLE "UserNfcCredential" ADD CONSTRAINT "UserNfcCredential_hashed" CHECK ("credentialHash" LIKE '$argon2%');
ALTER TABLE "UserNfcCredential" ADD CONSTRAINT "UserNfcCredential_pin_hashed" CHECK ("managerPinHash" IS NULL OR "managerPinHash" LIKE '$argon2%');

INSERT INTO "Permission" ("key",description,"updatedAt") VALUES ('device.read','device read',CURRENT_TIMESTAMP), ('device.manage','device manage',CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;
DO $$ DECLARE r RECORD; before_keys JSONB; after_keys JSONB; BEGIN
 FOR r IN SELECT * FROM "Role" WHERE name='OWNER' AND protected=true LOOP
 SELECT COALESCE(jsonb_agg("permissionKey" ORDER BY "permissionKey"),'[]'::jsonb) INTO before_keys FROM "RolePermission" WHERE "roleId"=r.id;
 INSERT INTO "RolePermission" ("roleId","permissionKey") SELECT r.id,key FROM "Permission" WHERE key IN ('device.read','device.manage') ON CONFLICT DO NOTHING;
 SELECT jsonb_agg("permissionKey" ORDER BY "permissionKey") INTO after_keys FROM "RolePermission" WHERE "roleId"=r.id;
 IF before_keys<>after_keys THEN INSERT INTO "AuditLog" (id,"organizationId",action,"entityType","entityId","beforeData","afterData") VALUES (gen_random_uuid(),r."organizationId",'role.permissions_migrated','Role',r.id::text,jsonb_build_object('permissions',before_keys),jsonb_build_object('permissions',after_keys,'migration','202609200001_devices')); END IF;
 END LOOP;
END $$;
COMMIT;
