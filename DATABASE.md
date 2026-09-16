# Database foundation and menu catalog

## Phase 3 restaurant layout

Migration `202609110002_layout` adds Area, RestaurantTable, LayoutRevision and LayoutEvent; TableShape/TableStatus/LayoutEntityType enums; scoped keys/indexes; geometry/lifecycle CHECK constraints; append-only event triggers; and an audited protected-owner permission upgrade. All DDL and permission changes are wrapped in one transaction.

Area has name, description, sortOrder, configurable canvasWidth/canvasHeight, active, version and lifecycle timestamps. RestaurantTable has a composite same-area/branch/organization FK, name, branch-unique number, capacity, positionX/Y, width/height, shape, status, active, version and timestamps. Rectangles may have different dimensions; circles and squares require equal dimensions. Coordinates are integer layout units, not money. API transactions enforce area bounds, bounding-box collision checks, active-area prerequisites and safe state transitions. Physical disabled tables retain their occupied map space. Soft archives reserve area names/table numbers and preserve history.

LayoutRevision has one row per branch with a BIGINT revision incremented for each committed layout change. LayoutEvent stores a UUID, branch/org, revision, entity type/ID/version, action and timestamp, with unique `(branchId, revision)` and feed indexes. Event values contain invalidation metadata; AuditLog contains before/after snapshots. The runtime cannot UPDATE/DELETE/TRUNCATE events or DELETE layout entities. Mutation/truncation triggers also reject ordinary owner DML; a privileged database owner could still disable triggers, as with audit history. No event retention/deletion job is introduced.

Map snapshots read the branch revision, area and unarchived tables in one repeatable-read transaction. Change feeds are branch-scoped and paginated, and BIGINT cursors serialize as decimal strings. The outbox is not a WebSocket delivery worker or a cloud synchronization implementation.

The canonical schema is `packages/database/prisma/schema.prisma`. PostgreSQL is mandatory; SQLite or an in-memory imitation cannot validate these constraints. Prisma's generated client lives under `packages/database/src/generated` and is generated during installation/build, not committed.

## Entities

| Entity           | Purpose and important constraints                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Organization     | Globally unique UUID, unique slug, active/soft-delete lifecycle.                                                         |
| Branch           | Organization-owned; unique `(organizationId, code)` and `(id, organizationId)`; configurable currency and IANA timezone. |
| User             | Organization identity; unique normalized `(organizationId, email)`; password hash never serialized.                      |
| BranchMembership | Composite user/branch key, organization-consistent user and branch foreign keys; active branch access.                   |
| Role             | Organization-defined role with unique organization/name; protected bootstrap owner.                                      |
| Permission       | Application-defined action key; changing role mappings never adds executable server capabilities.                        |
| RolePermission   | Unique role/permission mapping and timestamp.                                                                            |
| UserBranchRole   | Unique membership/role mapping; composite references prevent cross-organization assignment.                              |
| Terminal         | Branch-owned device; unique branch/name, terminal type, last-seen and lifecycle.                                         |
| AuthSession      | Membership/branch/organization-bound, optional same-branch terminal; absolute expiry and revocation.                     |
| RefreshToken     | Hash-only random one-use token, session reference, consumption timestamp and expiry.                                     |
| AuditLog         | Append-only event, safe context and optional before/after JSON; indexed by organization/branch/time/ID and entity.       |

## Migration policy

1. Change the Prisma schema and add a reviewed migration. Development may use `prisma migrate dev`; never use `db push` as a deployment workflow.
2. Review generated SQL, especially cascades, uniqueness, backfills, locks and financial constraints. Do not edit already applied migrations.
3. Apply through `node scripts/migrate.mjs` with owner credentials, which runs `migrate deploy` and refreshes the runtime grants.
4. Generate and build the Prisma client. Verify on a new database and against a restored prior-version snapshot before a production upgrade.
5. Seed only with explicit operator bootstrap configuration. Repeated seed preserves users, passwords and customized role mappings.

Initial migration `202609100001_foundation` creates the relational schema. `202609100002_audit_guards` adds audit immutability triggers, terminal audit FK, normalized-email and expiry checks. Some CHECK constraints and triggers are raw SQL by design and must remain in migrations even where Prisma cannot express them.

The application role has no schema CREATE, migration-table access, DELETE on identity/session records or UPDATE/DELETE/TRUNCATE on AuditLog. Deleting role mappings is allowed because configuration changes are atomically audited. Superusers/database owners remain a privileged operational boundary; triggers do not defend against an owner disabling triggers or dropping a table.

Operational `createdAt`/`updatedAt` fields use `timestamptz(3)`. Audit and token creation timestamps are database defaults. Append-only event tables intentionally have no `updatedAt`; token consumption has its own timestamp. Audit failures roll back sensitive operations.

## Next schema phases

Phase 2 adds the menu entities described below. Area/table/order schemas follow their respective phases. Catalog prices use PostgreSQL `NUMERIC` and decimal strings, never floating-point columns or JS number calculations. Payments/refunds, company ledgers and stock movements will be append-oriented with unique source/idempotency constraints. Phase 6 now implements the payment and cash ledgers described below.

## Phase 2 catalog

| Entity                | Purpose and constraints                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Category              | Configurable branch category; unique branch/name.                                                                               |
| Product               | Category, SKU, optional barcode/image URL, exact selling price and tax configuration; branch/SKU and branch/barcode uniqueness. |
| ModifierGroup         | Configurable distinct-choice minimum/maximum; unique branch/name.                                                               |
| Modifier              | One scoped group, signed exact price adjustment; unique group/name.                                                             |
| KitchenStation        | Configurable station definition; unique branch/name. No KDS or tickets.                                                         |
| ProductModifierGroup  | Ordered product-to-group mapping, unique product/group, scoped composite FKs.                                                   |
| ProductKitchenStation | Ordered product-to-station mapping, unique product/station, scoped composite FKs.                                               |

All five catalog entities include organizationId, branchId, description, sortOrder, active, version, createdAt, updatedAt and deletedAt. Composite FKs enforce the same branch and organization for every relationship. Indexes cover branch/lifecycle/sort queries and association reverse lookups. Names/SKUs/barcodes are case-sensitive and remain reserved after archival. Product names need not be unique. Mapping rows carry createdAt and are replaceable only within an audited product transaction.

Migration `202609110001_menu` creates these tables, enums and CHECK constraints in one transaction. Prices/adjustments use NUMERIC(14,2); tax percentage uses NUMERIC(5,2), constrained to 0–100. The API accepts only canonical decimal text (two digits after the decimal point); currency comes from Branch. Required modifiers must be available before an active product can use a group. Archive/deactivation dependency checks and optimistic versions use serializable transactions.

The same migration adds menu.read/menu.manage and audits their grant to existing protected OWNER roles. It preserves all other existing mappings. Fresh seed grants menu access using the defaults in PERMISSIONS.md and creates no menu business data. Runtime provisioning grants DELETE only to the two replaceable catalog mapping tables, in addition to the existing role mappings. Runtime users cannot hard delete catalog entities.

No database row-level security is claimed. Current isolation is enforced through verified-session query scopes and composite relational constraints, with adversarial integration tests. A database credential compromise is outside that boundary; RLS can be evaluated before cloud tenancy.

# Orders (Phase 4)

`OrderCounter` owns branch-local BIGINT order numbers and event revisions. `Order` owns type, status, table/area identity snapshots, nullable waiter membership/name snapshot, currency, gross subtotal/discount/included tax/total and a version. `OrderItem` snapshots product/category identity, price and tax configuration; quantity and notes may change while editable, with full event/audit history. `OrderItemModifier` retains selected modifier/group names and adjustments. Removed items carry void time/reason; orders carry cancellation reason, never soft disappear from history. `OrderEvent` is immutable and includes command UUID, actor, canonical request hash, version, revision and allowlisted response snapshot.

Composite branch/organization foreign keys protect every reference. A partial unique index permits only one live order per table. Financial rows have no DELETE grants; SQL triggers also reject deletion/truncation, mutation of events/modifier snapshots, snapshot rewrites and changes to closed orders. Deferred aggregate checks require parent amounts to equal active item amounts. All command, amount, occupancy, version, audit and event writes share a serializable transaction. See [ADR 0004](docs/adr/0004-orders.md) for exact rounding and supported transitions.

## Kitchen (Phase 5)

KitchenSubmission uniquely references an order and submitting branch member. KitchenTicket references its submission/order/station through scoped composite keys and stores immutable preparation content, version, four-state lifecycle, preparation timestamps and cancellation metadata. KitchenTicketItem binds every routed source item to its own order and ticket. KitchenRevision provides a committed branch cursor; immutable KitchenEvent retains actor, action, snapshot, revision and optional command ID/hash for replay.

Migration `202609120002_kitchen` adds relational constraints, indexes, lifecycle checks and deferred integrity triggers. Every active order item must be routed. Ticket content must match source item names/quantities/notes/modifiers; cancellation and aggregate order state must agree with every ticket. Submitted order totals, notes, waiter and item snapshots cannot be edited or reopened into an editable state. Ticket content and submission/item links are immutable; runtime cannot delete tickets or mutate history. Phase 5 did not add payment tables; Phase 6 extends these guards to valid PAID settlements.

## Payments and cash (Phase 6)

Migration `202609120003_payments` adds OrderBill, OrderSettlement, Payment, PaymentReversal, PaymentAllocation, CashShift, CashMovement, PaymentRevision and PaymentEvent. All monetary columns are NUMERIC(14,2), transported as decimal strings and calculated in bigint cents. Composite foreign keys bind orders, units, original payments, cashiers, shifts and terminal records to the same branch/organization. Financial rows have immutable createdAt history; CashShift adds version/updatedAt until counted close. No financial hard delete is available.

A bill fixes AMOUNT or ITEMS mode. Each item allocation identifies one numbered source unit; line remainder cents are assigned deterministically to earliest units. Active allocations cannot overlap. Full unsettled cancellations release allocations without deleting them. Settlements exactly equal original totals and captures minus cancellations; post-settlement refunds reduce net receipts but do not erase settlement or change PAID. Zero totals require an explicit nonempty settlement. All associated audit/events, table release and cash movements commit together.

Partial indexes permit one OPEN shift per terminal and per branch cashier. Opening, cash in/out, applied payments and reversals form a signed movement ledger. Expected cash is its sum. Close records counted/expected/difference and requires explanation for a discrepancy. Closed shifts and append-only ledgers reject updates/deletes/truncation, including ordinary statements from the migration owner. Runtime grants exclude history mutations. Existing closed orders are never backfilled with invented payments.

## Inventory (Phase 7)

Migration `202609130001_inventory` adds twelve models:

| Model             | Responsibility                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| InventoryUnit     | Immutable kg, g, l, ml, pcs dimensions and exact conversion factors                                          |
| InventoryItem     | Branch ingredient/stock-item identity, immutable stock unit/SKU/kind, versioned name/active/archive metadata |
| Warehouse         | Branch versioned, soft-archivable stock location                                                             |
| StockPosition     | Unique warehouse/item configuration, low-stock threshold and version; no stock quantity column               |
| Recipe            | Unique branch product recipe identity and current revision pointer                                           |
| RecipeVersion     | Immutable recipe header, warehouse and active state                                                          |
| RecipeItem        | Immutable per-product ingredient quantities in each item's stock unit                                        |
| InventoryPlan     | Immutable recipe snapshot frozen for one order bill                                                          |
| InventoryPlanItem | Exact source order item/recipe ingredient quantities and historical names                                    |
| StockMovement     | Append-only ADJUSTMENT, WASTE or SALE_CONSUMPTION quantities, reasons, actor and source references           |
| InventoryRevision | Branch serialization point and monotonically increasing event cursor                                         |
| InventoryEvent    | Immutable audit-related event and command receipt for exact replay                                           |

All operational relationships carry organization/branch composite foreign keys. Decimal quantities are `NUMERIC(20,6)` and transported as strings. Current stock is the sum of signed movements; thresholds and configuration edits never overwrite it. Indexed warehouse/item positions, source order/plan lines and branch event cursors support current stock and history reads. Movement snapshots preserve ingredient/warehouse names across later edits.

A recipe revision's ingredient rows can only be inserted with that new revision. Plan completeness and quantity checks run at commit; sale movements must match frozen plan lines and settled source orders. Every new settlement must have a complete inventory plan, including an empty plan when products have no recipes. Plan-line uniqueness prevents double consumption. Runtime grants and triggers prohibit modifying/deleting/truncating inventory history. Product/warehouse/item archives retain all source references.

First payment freezes the plan; partial collections do not deduct quantities. Final/zero settlement records consumption in the existing financial transaction. Rollback leaves neither payments nor stock movements committed. Historical PAID orders are not backfilled; previously partial bills freeze recipes on their next collection. See [ADR 0007](docs/adr/0007-inventory.md).

## Purchasing (Phase 8)

Migration `202609140001_purchasing` adds Supplier, PurchaseOrder, PurchaseItem, GoodsReceipt, GoodsReceiptItem, SupplierEntry, PurchasingRevision and PurchasingEvent. All operational references include branch/organization composite keys, including receipt source lines, actor memberships and purchasing event references. StockMovement adds kind PURCHASE and optional unique receiptItemId; existing adjustment, waste and sale source constraints remain active. The PostgreSQL enum extension and new checks run within the migration transaction; new-value checks cast the enum to text so no uncommitted enum value is evaluated.

Supplier is versioned and soft-archivable. PurchaseOrder has a branch sequence number, currency, status/version, supplier/warehouse snapshots, expected date, references, totals and cancellation reason. Draft replacement soft-voids prior PurchaseItem rows. Ordered items are immutable. Item quantities use NUMERIC(20,6), unit purchase costs NUMERIC(14,4), tax rates NUMERIC(5,2) and money totals NUMERIC(14,2). Net line cost rounds half-up before tax; all arithmetic uses Decimal or bigint, with no monetary float calculations.

GoodsReceipt/Items are append-only. Each receipt snapshots delivered quantities using frozen order prices and references source items. Unique case-insensitive trimmed supplier references and nonempty invoice numbers prevent duplicate posting with different command IDs. Deferred checks require complete line totals, exactly matching stock additions, no cumulative overreceiving, an exact supplier charge and correct purchase status. Receipt-line rows can be inserted only with the new receipt transaction. Unique source links prevent double stock.

SupplierEntry records signed CHARGE, PAYMENT and PAYMENT_REVERSAL amounts. One charge per receipt must equal its total; payments cannot exceed its unpaid amount; full correction reversals must match an original payment and cannot repeat. Balances are sums, not mutable columns. Runtime grants plus triggers prohibit update/delete/truncate of receipt, stock, supplier-entry and event history. All writes use Serializable transactions, branch serialization and idempotent command receipts; inventory failure rolls back the payable and receipt as well.

## Synchronization checkpoint (Phase 12)

Migration `202609170001_sync` adds one table, `SyncCheckpoint`, and the `sync.read` permission. The table holds a per-branch, per-stream delivered cursor with the last attempt and delivery times, the last error and a failure count. It carries no business data and is never a source of truth: the seven per-module event logs remain the authority, and clearing a checkpoint loses only the knowledge of what had already been sent. CHECK constraints keep the cursor and failure count non-negative and restrict `stream` to the seven known logs, so a typo cannot create a checkpoint no worker advances. A composite foreign key and a unique constraint on branch, organization and stream preserve branch isolation. Runtime grants allow INSERT and UPDATE but revoke DELETE and TRUNCATE, so the runtime role advances delivery state without being able to erase it. No existing table, column, constraint or trigger is altered.

## Reporting (Phase 11)

Migration `202609160001_reporting` is data-only. It inserts the `report.read` permission and grants it to protected OWNER roles with a `role.permissions_migrated` audit row, and contains no DDL: no table, column, index, constraint or trigger changes, so the Prisma schema is unchanged and `prisma migrate diff` from the migration history to the schema is empty. Reports derive every figure at read time from existing rows: settlement-time order headers for sales, frozen `OrderItem` snapshots for product revenue, the signed `CashMovement`, `StockMovement`, `SupplierEntry` and `CompanyLedgerEntry` ledgers for balances, and immutable `CompanyStatement` due dates for overdue amounts. No aggregate, snapshot or second balance table exists to drift from the ledgers.

## Company contracts (Phase 9)

Migration `202609150001_companies` adds Company, CompanyContract, CompanyEmployee, CompanyLedgerEntry, CompanyStatement, CompanyStatementLine, CompaniesRevision and CompaniesEvent, plus ContractStatus, BillingCycle and CompanyEntryKind enums. It extends PaymentMethod with COMPANY_ACCOUNT and adds nullable `companyId`/`companyEmployeeId` to Payment. Because the new enum value is uncommitted inside the migration transaction, every new-value predicate casts the enum to text, following the Phase 8 StockMovementKind precedent.

Company and CompanyEmployee are versioned and soft-archivable; CompanyContract is versioned with a DRAFT -> ACTIVE -> SUSPENDED/EXPIRED -> TERMINATED lifecycle, a branch-unique contract number, credit limit NUMERIC(14,2), discount percentage NUMERIC(5,2), payment terms in days and a billing cycle. Identity triggers make versions strictly monotonic, freeze archived rows and make terminated contracts final even under direct database access. A partial unique index permits one ACTIVE contract per company through the service, and activation is additionally rejected when another active contract exists.

CompanyLedgerEntry is append-only with a signed NUMERIC(14,2) amount: CHARGE is positive and carries its source order and payment, while PAYMENT and PAYMENT_REVERSAL are account-level with null order and payment references. Balance is `SUM(amount)` per company and is never stored. Partial unique indexes allow one charge per order and one case-insensitive payment reference per company. A row-level guard requires a charge to accompany its own newly inserted COMPANY_ACCOUNT payment and a reversal to match an unreversed original. The deferred `check_company_credit` trigger re-sums at commit: the balance may never go negative, and a CHARGE additionally requires an ACTIVE contract and must stay within its credit limit. Payments and reversals are deliberately not gated on an active contract so an outstanding balance can always be settled after expiry or termination.

CompanyStatement and CompanyStatementLine are immutable. A statement is unique per branch, company and period, carries opening balance, charges, payments, closing balance and a due date derived from the contract terms, and a deferred trigger requires its stored totals to equal the frozen lines and every line to belong to that company and period. The existing `payment_valid`, `guard_reversal_insert` and `check_payment_integrity` rules are extended rather than left permissive: a COMPANY_ACCOUNT payment must have a matching charge and no cash movement, a non-company payment may have no ledger entry, and a company reversal takes neither a shift nor a card reference. Runtime grants revoke update/delete/truncate on the ledger, statements, statement lines and events.
