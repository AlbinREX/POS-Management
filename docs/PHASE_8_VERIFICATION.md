# Phase 8 verification: purchasing

Verified locally on **2026-09-15**. Scope is Phase 8 only. No Company Contracts, reporting or Fiscalization implementation was added.

## Implemented

- Branch-owned supplier records with versioned identity, soft archival and open-purchase archive protection.
- Versioned purchase orders across DRAFT -> ORDERED -> PARTIALLY_RECEIVED -> RECEIVED, with reasoned cancellation of unreceived drafts/orders. Draft replacement soft-voids prior item rows; ordered content is frozen.
- Immutable goods receipts recording delivered quantities at frozen ordered prices, with unique supplier delivery references, optional invoice number/date, due date and HTTPS document references.
- Positive PURCHASE stock movements committed atomically with each receipt line through the existing Phase 7 inventory ledger, using unique receipt-line source references that prevent duplicate stock.
- Append-only SupplierEntry ledger: one CHARGE per receipt, external PAYMENT records bounded by the receipt's unpaid amount, and full PAYMENT_REVERSAL corrections. Balances are sums of entries, never mutable columns.
- Seven configurable permissions, composite branch/organization foreign keys, optimistic versions, Serializable transactions, immutable database guards, actor-bound command replay and durable branch event cursors.
- A Riza Purchasing workspace with supplier, purchase order, receipt and supplier-account views, draft editing, receiving entry, and LAN refresh with scoped sessionStorage retry receipts.

## Verification results

| Check                           | Result | Evidence                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prisma/schema/migrations        | PASS   | Nine migrations applied to isolated PostgreSQL 17.10; second deployment found no pending migration. Docker applied `202609140001_purchasing` transactionally to the existing database.                                                                                                                                                                  |
| Seed idempotency                | PASS   | Isolated integration harness seeded twice and preserved configured roles. The migration added only permission reference data and audited protected OWNER grants; no supplier or purchase business fixtures were seeded.                                                                                                                                 |
| Lint                            | PASS   | `npm.cmd run lint`; zero ESLint warnings/errors.                                                                                                                                                                                                                                                                                                        |
| Typecheck                       | PASS   | `npm.cmd run typecheck`; shared packages, database, API, UI and Next.js checks completed.                                                                                                                                                                                                                                                               |
| Unit tests                      | PASS   | `npm.cmd test`; 93 tests across eight files, including purchase line rounding, tax calculation and strict purchasing input validation.                                                                                                                                                                                                                  |
| Integration tests               | PASS   | 119 checks across foundation 28, menu 13, layout 13, orders 13, kitchen 10, payments 14, inventory 14 and purchasing 14. Real isolated PostgreSQL with migrations, restricted runtime grants and HTTP requests.                                                                                                                                         |
| Browser regression              | PASS   | `npm.cmd run test:e2e`; all nine workflows passed on desktop and mobile Chromium (18 tests), including Purchasing plus every prior phase workflow.                                                                                                                                                                                                      |
| Production build                | PASS   | `npm.cmd run build` inside `test:e2e`; Prisma generation, API compilation and optimized Next.js build succeeded.                                                                                                                                                                                                                                        |
| Compose/Dockerfiles             | PASS   | Compose config validation and all api/admin/migrate target builds succeeded.                                                                                                                                                                                                                                                                            |
| PostgreSQL/API/frontend/Nginx   | PASS   | PostgreSQL, API and admin healthy; Nginx configuration valid. Deployed purchasing reads verified through `localhost:8080`.                                                                                                                                                                                                                              |
| Deployed authenticated workflow | PASS   | Owner login, all eight operational views and all seven purchasing read endpoints verified against Docker, with responsive width and clean browser console.                                                                                                                                                                                              |
| Backup/restore drill            | PASS   | Operator archive `restaurant-20260914T221308Z.dump` restored to an isolated database; runtime provisioning and migrations repeated; nonempty receiving/stock/payable fixtures created, re-archived as `restaurant-20260914T221321Z.dump` and restored again to a second isolated database with identical state. The active database was never replaced. |
| Restore replay integrity        | PASS   | The restored target reproduced outstanding `18.60`, stock `2000.000000`, receipts 2, receipt items 2, stock movements 2, supplier entries 3 and purchasing events 6. Replaying the original receive command returned the original receipt and created no duplicate stock.                                                                               |
| Restored runtime guards         | PASS   | `has_table_privilege` confirmed `restaurant_app` cannot UPDATE `GoodsReceipt` or `SupplierEntry` in the restored database after reprovisioning.                                                                                                                                                                                                         |
| Working tree whitespace         | PASS   | `git diff --check`; only Git CRLF normalization notices.                                                                                                                                                                                                                                                                                                |

Logs are local and ignored under `.local/phase8-*`, including `phase8-final-lint.log`, `phase8-final-typecheck.log`, `phase8-final-unit.log`, `phase8-final-e2e.log` and `phase8-final-restore-drill.log`. The drill result is recorded in `.local/phase8-restore-result.json`. Restore drill databases were dropped after verification; `restaurant`, `restaurant_restore_phase1` and `restaurant_restore_phase7_20260914` were left untouched.

## Purchasing integrity coverage

The fourteen purchasing integration groups exercise strict inputs, supplier CRUD and read/receive/payment permissions; draft replacement retaining source history with decimal-safe totals; ordering freezing snapshots without creating stock or a payable; partial receiving committing stock, receipt, payable, audit and replay exactly once; atomic rejection of overreceiving, duplicate invoices and wrong purchase lines; external payments and correction reversals producing accurate balances; final delivery completing the purchase with receipt-specific rounding; concurrent receiving that cannot duplicate movements or overreceive; forced stock failure rolling back receiving and supplier balances; event failure rolling back receipt, stock, charge and audit together; zero-cost goods and multiple item dimensions retaining complete ledger sources; database-enforced frozen lines and complete receiving even with owner access; branch isolation across suppliers, orders, receipts, account entries and references; and unreceived cancellation, archive history, events and revoked permissions.

Browser purchasing verification creates a supplier, orders a kg-based line for a g-based stock item, posts a partial receipt, loses the successful response, reloads and replays the command without duplicating stock, then checks converted stock quantities and the reconciled supplier balance. This passes separately on desktop and mobile.

## Important files

- `apps/api/src/purchasing/`: controller, transaction service and purchase money helpers.
- `apps/api/src/inventory/inventory.transactions.ts`: shared branch lock, position upsert and event helpers reused by receiving.
- `packages/database/prisma/schema.prisma` and `migrations/202609140001_purchasing/migration.sql`: eight purchasing models, the PURCHASE stock movement kind, constraints, immutable guards and the audited OWNER permission migration.
- `packages/shared-types/src/purchasing.ts`, shared permission defaults and `packages/validation/src/purchasing.ts`.
- `apps/admin/src/components/purchasing-workspace.tsx`, `purchasing-editors.tsx` and shared workspace navigation.
- `scripts/provision-runtime.mjs`, `scripts/integration.mjs`, `tests/unit/purchasing.test.ts`, `tests/integration/purchasing.mjs` and `tests/e2e/purchasing.spec.ts`.
- ARCHITECTURE.md, DATABASE.md, PERMISSIONS.md, DEPLOYMENT.md, BACKUP_RESTORE.md, OFFLINE_SYNC.md, README.md, docs/API.md and [ADR 0008](adr/0008-purchasing.md).

Entities: Supplier, PurchaseOrder, PurchaseItem, GoodsReceipt, GoodsReceiptItem, SupplierEntry, PurchasingRevision and PurchasingEvent.

## Resolved verification failures

An earlier evidence generation recorded a stale STOREKEEPER default-permission unit assertion and an integration run that stopped inside the branch-isolation group; both were corrected and superseded by the complete later run, and the final suites above pass from a clean execution.

The restore drill failed twice before passing, in the verification harness only. First, it published a host port from a container attached solely to the `backend` Compose network, which is declared `internal: true`; Docker cannot publish a host port from an internal-only network, so readiness polling could never succeed. The drill was rewritten to drive the restored API from inside that network, matching the Phase 1 and Phase 7 restore helpers. Second, the rewrite initially set `APP_ORIGIN` to the container hostname, which `getConfig()` correctly rejects because HTTP origins are permitted only on loopback. `APP_ORIGIN` now stays loopback and is sent as the exact `Origin` header while requests reach the container by name, satisfying both origin validation and the CSRF check.

Neither failure was an application defect, and no application, permission, origin-validation or database guard was weakened to make the drill pass. The API binds `0.0.0.0` and the restored database authenticated the restricted runtime role normally throughout. `TRUST_PROXY` is explicitly disabled for the isolated drill container because it is reached directly rather than through the trusted proxy.

## Limits and security status

- Receipt returns, credit notes, amendments after ordering, attachment uploads, freight allocation, multi-currency accounting and weighted stock valuation are outside this phase. An incorrect posted receipt remains auditable and must not be deleted or silently replaced.
- One receipt represents one delivery and one accounting charge. A single invoice spanning multiple deliveries must be reconciled outside this workflow. Closing an unfulfilled partially received order is not implemented.
- Supplier payments record externally completed transactions. They never execute a bank or card transfer and never alter POS cash shifts or drawers. Outstanding balances cover only recorded receipts and payments; this is an operational balance, not a certified general ledger.
- Purchase orders alone create no payable and no stock. Unallocated supplier credits and prepayments are not supported.
- Existing customized roles are preserved; OWNER must grant Phase 8 permissions to existing staff through Roles. Backend permissions and branch isolation were verified, but no formal penetration test or sustained multi-terminal load test was performed.
- Durable events and LAN refresh/retry are implemented. WebSocket push, disconnected write queues and cloud synchronization are not claimed.
- The installed endpoint remains a loopback HTTP development deployment. LAN TLS, device hardening, off-device backup scheduling/monitoring and broader production security remain documented deployment work; this phase is not certification for commercial or fiscal use.
- Existing pg dependency deprecation and test-harness colour/native-config warnings are nonblocking and were not suppressed.

Phase 9 company contracts requires separate authorization. Do not start Phase 9 or Fiscalization automatically.
