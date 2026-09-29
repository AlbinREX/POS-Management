BEGIN;
-- Menu management: sold-out state, time-boxed offers and the order-line offer snapshot.
--
-- An offer never rewrites Product."sellingPrice". The price an offer produces is worked
-- out when an item is ordered and frozen onto that OrderItem, together with the base
-- price it replaced and the offer's id and name, so editing, deactivating or expiring an
-- offer can never change an order that already exists.

-- Temporarily unavailable, as distinct from inactive: a sold-out product stays listed
-- and keeps its history, but cannot be ordered.
ALTER TABLE "Product" ADD COLUMN "soldOut" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "OfferKind" AS ENUM ('FIXED_PRICE', 'PERCENT_OFF');

CREATE TABLE "Offer" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(2000),
    "imageUrl" VARCHAR(2048),
    "kind" "OfferKind" NOT NULL,
    "offerPrice" DECIMAL(14,2),
    "percentOff" DECIMAL(5,2),
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),
    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Offer_id_branchId_organizationId_key" ON "Offer"("id", "branchId", "organizationId");
CREATE INDEX "Offer_branchId_organizationId_deletedAt_startsAt_id_idx" ON "Offer"("branchId", "organizationId", "deletedAt", "startsAt", "id");
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
-- A window must end after it starts, and each kind carries exactly its own value: a
-- fixed price that is not negative, or a percentage strictly between 0 and 100.
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_window_valid" CHECK ("endsAt" > "startsAt");
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_value_valid" CHECK (
    ("kind" = 'FIXED_PRICE' AND "offerPrice" IS NOT NULL AND "offerPrice" >= 0 AND "percentOff" IS NULL)
    OR ("kind" = 'PERCENT_OFF' AND "percentOff" IS NOT NULL AND "percentOff" > 0 AND "percentOff" < 100 AND "offerPrice" IS NULL)
);
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_version_valid" CHECK ("version" >= 1);

CREATE TABLE "OfferProduct" (
    "offerId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OfferProduct_pkey" PRIMARY KEY ("offerId", "productId")
);
CREATE INDEX "OfferProduct_productId_branchId_organizationId_idx" ON "OfferProduct"("productId", "branchId", "organizationId");
-- Composite keys keep an offer and its products inside one branch and organization.
ALTER TABLE "OfferProduct" ADD CONSTRAINT "OfferProduct_offerId_branchId_organizationId_fkey" FOREIGN KEY ("offerId", "branchId", "organizationId") REFERENCES "Offer"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfferProduct" ADD CONSTRAINT "OfferProduct_productId_branchId_organizationId_fkey" FOREIGN KEY ("productId", "branchId", "organizationId") REFERENCES "Product"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The order-line snapshot. Existing rows keep NULLs: they were priced before offers
-- existed and are never recalculated.
ALTER TABLE "OrderItem" ADD COLUMN "listPrice" DECIMAL(14,2);
ALTER TABLE "OrderItem" ADD COLUMN "offerId" UUID;
ALTER TABLE "OrderItem" ADD COLUMN "offerName" VARCHAR(160);
CREATE INDEX "OrderItem_offerId_branchId_organizationId_idx" ON "OrderItem"("offerId", "branchId", "organizationId");
-- RESTRICT: an offer that priced an order line can be archived but never removed.
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_offerId_branchId_organizationId_fkey" FOREIGN KEY ("offerId", "branchId", "organizationId") REFERENCES "Offer"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_listPrice_valid" CHECK ("listPrice" IS NULL OR "listPrice" >= 0);
-- An offer line always names its offer and base price, and an offer never charges more
-- than the base price it replaced.
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_offer_snapshot_valid" CHECK (
    ("offerId" IS NULL AND "offerName" IS NULL)
    OR ("offerId" IS NOT NULL AND "offerName" IS NOT NULL AND "listPrice" IS NOT NULL AND "unitPrice" <= "listPrice")
);
COMMIT;
