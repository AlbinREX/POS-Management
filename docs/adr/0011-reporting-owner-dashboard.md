# ADR 0011: read-only reporting derived from the transaction ledgers

Phase 11 adds an owner dashboard and a reporting API. It introduces no table, column, index or trigger, no second balance store and no business rule: every figure is derived on request from the immutable order, settlement, payment, cash-movement, stock-movement, supplier-ledger, company-ledger and statement rows that Phases 4-9 already treat as the authority. The only migration is data-only. It registers the `report.read` permission and grants it to protected OWNER with the same audited pattern as earlier phases, so the schema, backups and restore procedures are unchanged.

## One permission, one branch, read-only

Reporting is a distinct authority from operating. A cashier who may collect payments should not necessarily see the branch's net sales, supplier balances or company exposure, and an accountant who may read reports should not be able to open a drawer. A single `report.read` key therefore guards every route under `/api/reports`, and no other permission implies it. Fresh OWNER, ADMIN and MANAGER receive it; CASHIER, WAITER, KITCHEN and STOREKEEPER do not. The controller exposes only GET handlers, the service opens only `RepeatableRead` transactions, and the integration suite asserts that a full pass over every report and export leaves every ledger and the audit log row count unchanged.

Scope comes from the session as everywhere else. The range schema is `.strict()` and accepts no branch or organization identifier; every query carries the principal's branch and organization, and per-branch filters such as `warehouseId`, `supplierId` or `companyId` are applied inside that scope, so a foreign identifier simply yields an empty result. A session binds one branch, and no cross-branch read permission exists, so the dashboard shows the signed-in branch and offers no branch selector. Multi-branch consolidation is a later decision that would need its own permission and its own isolation tests; it is not approximated here.

## Sales are recognized at settlement, in the branch calendar

Revenue counts on the day an order became PAID, taken from `OrderSettlement.createdAt`, which is indexed by branch and time and exists if and only if the order is PAID. The order header supplies the figures: gross is the sum of `subtotal`, discounts the sum of `discount`, sales after discount the sum of `total`, and net sales excluding tax is `total` minus `tax`. These are not new definitions. The `Order_valid` check already guarantees `total = subtotal - discount` with tax included in the total, and a deferred trigger guarantees that headers equal their non-voided line sums, so header and line aggregations reconcile by construction. Cancelled orders keep their totals for history and are excluded by status, never by amount.

Day boundaries are resolved in TypeScript from `Branch.timezone` with `Intl.DateTimeFormat`, using a two-pass offset so that the spring-forward day is 23 hours and the fall-back day 25 hours. The result is a half-open UTC interval passed to Prisma as an ordinary `createdAt` filter; no raw SQL and no date library were added. Every response echoes the resolved range, its timezone and both UTC instants so a reader can verify what was counted. Presets are Today, Yesterday, This week (Monday to today) and This month; a custom range is inclusive, at most 366 days, and every reported day appears in the daily series even when empty.

## Refunds are shown, not netted into the sale

A `REFUND` reversal is genuine contra-revenue and appears on the day it was recorded as its own line, attributed to the original tender's method. It never restates the settled order or the day of the original sale. A `CANCELLATION` reversal is a pre-settlement correction of a tender and is reported separately as operational noise. The payment mix is by tender time, so over an open period it can differ from settlement-time sales by a partial payment collected before its order settled; over any closed period the two reconcile, and the dashboard says so.

## Historical truth over current configuration

Product and category revenue come from `OrderItem` snapshots (`productName`, `categoryName`, `unitPrice`, `total`), which a trigger freezes at sale time, with voided lines excluded. The current `Product` row is never joined for a historical figure, and the integration suite raises a product's price after the sale and asserts that the report does not move. Modifier price adjustments are already folded into each line total, so modifier usage is counted and never summed a second time. A product or table that was renamed appears under the name it was sold under most often; that is the recorded truth rather than a retroactive relabel.

Staff figures are limited to what the schema records: settled orders attributed to a waiter snapshot, with order count, sales, average ticket and dine-in versus takeaway, and settlements performed by a cashier. No hours, speed, tips or targets exist in the data, so none are invented.

## Balances are the same sums the ledgers enforce

Cash uses the signed `CashMovement` ledger exactly as the shift close does: opening float, cash in, cash out, applied payments and reversals are summed, a closed shift reports its stored expected, counted and difference, and an open shift computes the running expectation. Stock is `SUM(StockMovement.quantity)` per position with the inventory module's own low-stock rule, and negative stock is derived from the same sum; quantities are summed only within one position because units differ across items. Supplier and company balances are the signed `SupplierEntry` and `CompanyLedgerEntry` sums, and the report shows `paid` with the ledger's sign so that the figure equals the operational account endpoints to the cent, which the suite asserts against every supplier, company, position and shift on a populated branch.

Overdue company amounts are taken from immutable statements only. The latest statement whose stored `dueDate` has passed supplies a closing balance; payments recorded after its period are subtracted, and the floor is zero. Terms are never recomputed from the current contract, so an edited contract cannot change what was already due.

## Exports are the same figures as text

CSV is the first non-JSON response in the API. It reuses the service methods behind the JSON reports and serializes the identical decimal strings, so an exported value is the text the dashboard displayed. Cells are RFC 4180 quoted, cells beginning with `=`, `+`, `-`, `@`, tab or carriage return are prefixed with an apostrophe against spreadsheet formula injection, a byte-order mark is prepended for spreadsheet compatibility, and the route sets `Content-Disposition: attachment`. An export that would exceed 50,000 rows is refused with an explicit message rather than truncated. PDF is not produced because no rendering tooling exists in the repository.

## Out of scope

Cross-branch or organization-wide consolidation, scheduled or emailed reports, charting libraries, PDF, per-waiter time or speed metrics, fiscal reporting, and any write from a report route.
