# Phase 7 verification: inventory

Verified locally on **2026-09-14**. Scope is Phase 7 only. No Suppliers, Company Contracts or Fiscalization implementation was added.

## Implemented

- Branch-owned ingredients/stock items, immutable kg/g/l/ml/pcs reference units, warehouses and versioned low-stock thresholds.
- Versioned product recipes with immutable ingredient rows and exact conversions to each item's stock unit.
- Append-only StockMovement history for signed adjustments, waste and automatic sale consumption. Current stock is calculated from movement sums, never overwritten.
- Inventory plans frozen at first successful collection using the existing immutable order item snapshots. Final/zero settlement consumes the plan once, inside the same transaction as payments, settlement, audit/events and PAID. Partial collections do not consume stock.
- Distinct backend read/manage/adjust/waste/recipe permissions, composite branch foreign keys, optimistic versions, immutable database guards, command replay and durable branch event cursors.
- A Riza charcoal/gold Inventory workspace with searchable stock cards, warehouse filters, low-stock badges, quick adjustment/waste actions, ingredient/warehouse editors, recipe rows/revisions and movement history. Desktop, tablet and mobile layouts were visually inspected. Uncertain saves survive a reload and can be retried without duplication.

## Verification results

| Check                           | Result | Evidence                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Prisma/schema/migrations        | PASS   | Eight migrations applied to isolated PostgreSQL 17.10; second deployment found no pending migration. Schema generated and typechecked. Docker applied 202609130001_inventory transactionally to the existing database.                                                                                                                                                         |
| Seed idempotency                | PASS   | Isolated integration harness seeded twice and preserved configured roles. Only unit/permission reference data was added to the installed database by migration; no business inventory fixtures or passwords were replaced.                                                                                                                                                     |
| Lint                            | PASS   | npm.cmd run lint; zero ESLint warnings/errors.                                                                                                                                                                                                                                                                                                                                 |
| Typecheck                       | PASS   | npm.cmd run typecheck; shared packages, database, API, UI and Next.js checks completed.                                                                                                                                                                                                                                                                                        |
| Unit tests                      | PASS   | npm.cmd test; 87 tests across seven files, including exact unit conversion, rounding/overflow rejection and stock/recipe input validation.                                                                                                                                                                                                                                     |
| Integration tests               | PASS   | 105 checks across foundation 28, menu 13, layout 13, orders 13, kitchen 10, payments 14 and inventory 14. Real isolated PostgreSQL with migrations, restricted runtime grants and HTTP requests.                                                                                                                                                                               |
| Browser regression              | PASS   | node scripts/integration.mjs --browser; all eight workflows passed on desktop and mobile Chromium (16 tests). Includes Inventory plus authentication, menu, layout, orders, kitchen, payments and POS.                                                                                                                                                                         |
| Production build                | PASS   | npm.cmd run build and explicit child-process exit-code confirmation both completed. Prisma generation, API compilation and optimized Next.js build succeeded; confirmed exit code 0.                                                                                                                                                                                           |
| Compose/Dockerfiles             | PASS   | Compose config validation and all api/admin/migrate target builds succeeded.                                                                                                                                                                                                                                                                                                   |
| PostgreSQL/API/frontend/Nginx   | PASS   | PostgreSQL, API and admin healthy; Nginx syntax/config valid. /api/health/ready returned 200 with status ok through localhost:8080.                                                                                                                                                                                                                                            |
| Deployed authenticated workflow | PASS   | Owner login, seven existing/current operational views, all seven inventory read endpoints, inventory permission grants, sign-out, responsive width and browser console verified against Docker.                                                                                                                                                                                |
| Backup/restore                  | PASS   | Pre-upgrade backup restaurant-20260914T145923Z.dump. Post-upgrade restaurant-20260914T150230Z.dump restored with checksum validation and single-transaction pg_restore to new restaurant_restore_phase7_20260914. Migrations/runtime provisioning repeated there. Counts/reference data/stock sums and restricted grants matched the source. Active database was not replaced. |
| Restart/recovery                | PASS   | Restarted db/api/admin/nginx, awaited readiness, repeated authenticated API/browser checks and compared stored ledger counts/reference data. Eight migrations, five units, four existing orders, one settlement and two payments remained. Installed inventory catalog/ledger was empty and remained empty.                                                                    |
| Container logs                  | PASS   | Reviewed 503 lines covering deployment/restart/checks: no application/database/proxy errors or HTTP 5xx. Two instances of the known nonblocking pg queued-query deprecation warning remain.                                                                                                                                                                                    |
| Working tree whitespace         | PASS   | git diff --check; only Git CRLF normalization notices.                                                                                                                                                                                                                                                                                                                         |

Logs are local and ignored under `.local/phase7-*`. Browser screenshots are `phase7-inventory-desktop.png`, `phase7-inventory-tablet.png`, `phase7-inventory-mobile.png` and `phase7-deployed-inventory.png` in the Windows temporary directory. The browser and integration write workflows used isolated fixtures; Docker smoke checks did not create restaurant stock or sales.

## Inventory integrity coverage

The fourteen inventory integration groups exercise strict permissions and immediate revocation; compatible/incompatible units; opening adjustments and replay/conflicting command IDs; waste and low-stock thresholds; recipe revisions and archive restrictions; frozen plans across recipe edits and partial payments; refund/cancellation without phantom restocking; zero-total and negative-stock sales; concurrent settlement without duplicate consumption; forced stock insertion failure rolling back payment/PAID; forced event failure rolling back movement/audit; incomplete-plan rejection at database commit; branch isolation and composite foreign keys; immutable unit/recipe/plan/movement guards; archive history and event cursors.

Browser inventory verification creates a warehouse/item, records 1 kg into a g-based item, loses the successful response, reloads and replays the command, and verifies exactly 1000 g. It sets a 500 g alert, wastes 700 g, creates a 150 g recipe, settles a 5.00 card sale using the existing payment API, and verifies 150 g stock and linked sale history. This passes separately on desktop and mobile.

## Important files

- `apps/api/src/inventory/`: controller, service, exact quantity helpers and settlement transaction integration.
- `apps/api/src/payments/payments.service.ts`: freeze/consume hooks inside existing financial transactions.
- `packages/database/prisma/schema.prisma` and `migrations/202609130001_inventory/migration.sql`: twelve inventory models, reference units, constraints, immutable guards and OWNER permission migration.
- `packages/shared-types/src/inventory.ts`, shared permission defaults and `packages/validation/src/inventory.ts`.
- `apps/admin/src/components/inventory-workspace.tsx`, shared workspace navigation and Riza inventory CSS.
- `scripts/provision-runtime.mjs`, `scripts/integration.mjs`, `tests/unit/inventory.test.ts`, `tests/integration/inventory.mjs` and `tests/e2e/inventory.spec.ts`.
- ARCHITECTURE.md, DATABASE.md, PERMISSIONS.md, DEPLOYMENT.md, BACKUP_RESTORE.md, OFFLINE_SYNC.md, README.md, docs/API.md and [ADR 0007](adr/0007-inventory.md).

Entities: InventoryUnit, InventoryItem, Warehouse, StockPosition, Recipe, RecipeVersion, RecipeItem, InventoryPlan, InventoryPlanItem, StockMovement, InventoryRevision and InventoryEvent.

## Resolved verification failures

Prisma's overlapping composite relation inputs required standalone recipe header creation followed by ingredient createMany inside the transaction. A previous STOREKEEPER unit assertion expected no permissions; it now verifies the five Phase 7 grants while denying administration/payments. Integration payment fixtures now refresh optimistic order versions after partial collection. The browser recipe test uses the accessible combobox role because wrapped option text affected exact label lookup, and its card fixture now obeys the existing no-space external reference format. No production payment validation was relaxed. Docker Desktop was initially stopped in the resumed session; it was started before retrying backup/deployment. Final checks above passed.

## Limits and security status

- Product recipes use one warehouse and base-product ingredients. Modifier-specific ingredient substitutions, supplier purchases, stock costs/valuation, transfers and stock counts remain future work.
- A product with no active recipe has no consumption. Configure recipes/opening adjustments before relying on stock. Already PAID historical orders are not retroactively consumed. Existing partially paid bills freeze a plan at their next collection.
- Negative stock is allowed and visibly flagged. Refunds do not imply physical stock returns; authorized adjustments record actual corrections.
- Durable events and LAN refresh/retry are implemented. WebSocket push, disconnected write queues and cloud synchronization are not claimed.
- Existing customized roles are preserved; OWNER must grant inventory access to existing staff. Backend permissions and branch isolation were verified, but no formal penetration test or sustained multi-terminal load test was performed.
- The installed endpoint remains a loopback HTTP development deployment. LAN TLS, device hardening, off-device backup scheduling/monitoring and broader production security remain the documented deployment work; this phase is not certification for commercial/fiscal use.
- Existing pg dependency deprecation and test-harness color/native-config warnings are nonblocking and were not suppressed.

Next authorized phase would be Phase 8 purchasing/suppliers/goods receiving, recording received stock through the same ledger. It was not started.
