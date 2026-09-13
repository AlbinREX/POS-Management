# ADR 0002: Branch-owned menu catalog

Status: accepted for Phase 2.

Categories, products, modifier groups, modifiers and kitchen stations belong to one organization and branch. Composite foreign keys enforce that all catalog relationships stay in that branch. Catalog administration uses the existing local NestJS API and PostgreSQL transactions; no cloud dependency is introduced.

Products belong to one category and can reference multiple modifier groups and kitchen stations. A modifier belongs to one group; its price adjustment is shared by all products using that group. Group minimum/maximum selections apply to distinct active modifiers (no repeated quantities in this phase). Maximum must be at least one and at least the minimum. A group may be configured before its modifiers; activating/assigning a product requires enough active choices to satisfy required groups. Stations are configuration only, with no tickets or routing execution yet.

Prices and signed modifier adjustments are NUMERIC(14,2), transmitted as canonical strings. Tax rate is an explicitly configured percentage NUMERIC(5,2), with INCLUSIVE or EXCLUSIVE price tax mode. No Kosovo tax rate is assumed. Product currency is the branch currency. No order totals, tax calculation, inventory or fiscal receipts are implemented here. Future orders must snapshot the catalog; catalog edits will never be a source of historical prices.

All five entity types have timestamps, active/deletedAt flags and an optimistic version. Full updates require the last read version. Writes, link replacements and allowlisted before/after audit snapshots are atomic serializable transactions. Archives preserve records, cannot be edited, and reserve names/SKUs/barcodes. Dependencies must be detached before archiving categories, groups or stations; modifiers cannot be disabled if this makes an active product's required selections impossible. Runtime credentials cannot delete catalog entities. Only replaceable association rows receive DELETE grants.

Two configurable permissions are added: menu.read and menu.manage. Fresh OWNER/ADMIN roles receive both, MANAGER receives read. Existing installations receive both only on protected OWNER through an explicit audited migration, so previously customized administrative roles are not silently expanded. Owners may grant the new permissions to existing roles. Operational roles remain unchanged until their application phases. Every write requires both permissions; authorization is enforced by the API.

Lists are paginated (100 maximum per request) and filterable by name/SKU/barcode and archive status. The admin loads reference lists page by page, supports editing and archiving, and treats conflicts as a prompt to reload instead of retrying stale writes. Concurrent edits and reference checks use serializable isolation; conflicts return HTTP 409.

Risks: public-internet loss does not affect LAN catalog editing, but local-server loss still prevents writes; client-side offline mutations are not introduced. Future synchronization needs conflict detection using these versions and must not overwrite financial snapshots. Future inventory recipes and KDS routing must consume catalog identifiers without changing this ownership boundary. Fiscal tax interpretation and certification remain separate work against official specifications.
