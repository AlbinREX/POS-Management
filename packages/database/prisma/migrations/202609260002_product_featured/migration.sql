BEGIN;
-- Featured is a display preference only: a featured product is shown first within its
-- own category on the POS. It is not read by pricing, offers, orders or reporting.
ALTER TABLE "Product" ADD COLUMN "featured" BOOLEAN NOT NULL DEFAULT false;
COMMIT;
