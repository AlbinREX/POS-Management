# Phase 4 verification

**Result: PASS. Verified 2026-09-12.** Scope: Orders only. KDS execution and Payments were not started.

## Implemented

- DINE_IN and TAKEAWAY orders, branch-local order numbers, optional eligible waiter association and required dine-in table association. A dine-in draft occupies its table; one live order per table is enforced in PostgreSQL.
- DRAFT -> OPEN -> WAITING_PAYMENT, explicit reopening to OPEN, and reasoned cancellation. Cancellation preserves records/totals and releases the table. Kitchen and PAID transitions are rejected by the API.
- Product/category/price/tax and modifier/group snapshots. Quantity/notes updates retain the original price; new lines use the current catalog. Removed items retain a void timestamp/reason and their historical values.
- Server-only decimal/BigInt calculations, inclusive/exclusive catalog tax, fixed gross discounts with permission/reason, deterministic cent allocation and included-tax recalculation. Gross subtotal minus discount equals total. No floating-point monetary arithmetic or client-supplied totals.
- Branch-scoped order.read/manage/discount/cancel/assign permissions, active membership checks, strict inputs, optimistic versions and serializable transactions. Scope comes from the authenticated principal.
- Immutable order events and before/after audit snapshots, committed with amounts and table/layout events. UUID command IDs, request hashes and actor binding make successful commands replayable. Database guards protect closed orders, snapshots, deletion and aggregate totals.
- An Orders workspace in the existing admin application, using shared React/UI components: new orders, product search, modifiers, quantities, notes, discounts, waiter assignment, lifecycle controls and history. Selected orders appear first on small screens. The UI refreshes every five seconds and preserves uncertain commands in scoped sessionStorage for explicit retry after reload.

## PASS/FAIL

| Check                           | Result | Executed evidence                                                                                                                                                                                                                                          |
| ------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prisma schema/client            | PASS   | `npx.cmd prisma validate`, formatting and client generation                                                                                                                                                                                                |
| Migrations                      | PASS   | All five migrations applied to fresh isolated PostgreSQL 17.10; second deploy found none pending. Docker applied `202609120001_orders` to the existing Phase 3 database; repeat deploy found none pending.                                                 |
| Seed and role preservation      | PASS   | Fresh harness seed ran twice. Docker seed reran successfully; role comparison confirmed only protected OWNER gained five order permissions and all other existing grants remained unchanged. The owner upgrade has exactly one immutable migration audit.  |
| Lint                            | PASS   | `npm.cmd run lint`, zero lint errors/warnings                                                                                                                                                                                                              |
| Typecheck                       | PASS   | `npm.cmd run typecheck`, shared packages/API/UI/admin                                                                                                                                                                                                      |
| Unit tests                      | PASS   | `npm.cmd test`: 67 tests across four files, including 13 order calculation/validation tests                                                                                                                                                                |
| API/database integration        | PASS   | 67 check groups: foundation 28, menu 13, layout 13, orders 13. Real PostgreSQL with restricted runtime role; all passed in the final browser harness run.                                                                                                  |
| Browser regression              | PASS   | `node scripts/integration.mjs --browser`: four desktop plus four mobile Chromium tests, including all prior workflows and Orders                                                                                                                           |
| Production build                | PASS   | `npm.cmd run build`: Prisma generation, shared packages, NestJS and production Next.js. Final build repeated after verification changes.                                                                                                                   |
| Dockerfiles/Compose/build       | PASS   | Compose configuration validation and full API/admin/migration image build succeeded. No Dockerfile changes were needed.                                                                                                                                    |
| Docker services                 | PASS   | PostgreSQL/API/admin healthy; migration service exited 0. Nginx `nginx -t` passed, frontend and proxied readiness returned HTTP 200. Nginx has no configured Docker healthcheck; its HTTP/config checks were verified directly. API/admin run as UID 1000. |
| Deployed authenticated workflow | PASS   | Through localhost:8080: dine-in/takeaway creation, successful command replay without duplication, modifier snapshots, catalog price change, fixed discount, included tax, lifecycle, table occupancy, audit and event/history reads                        |
| Deployed browser smoke          | PASS   | Desktop 1280x800 and mobile 390x844: login, Orders selection, persisted totals/snapshots/history, no document overflow, logout. Screenshots inspected; no authenticated-workflow page/console errors.                                                      |
| Restart recovery                | PASS   | Restarted db/api/admin/nginx, awaited readiness and reloaded Nginx. Authenticated reads preserved dine-in total 15.00, included tax 2.50, original 5.50 unit-price snapshot, takeaway total 10.00, table WAITING_PAYMENT, audits and durable events.       |
| Database guards                 | PASS   | 13 order triggers enabled, five migrations present, event cursor aligned with committed events, no runtime DELETE on Order or UPDATE on OrderEvent/OrderItemModifier                                                                                       |
| Container logs                  | PASS   | Reviewed API/admin/PostgreSQL/Nginx/migration logs across deployment and restart. No application error/fatal/panic or Nginx error/emergency entries. Nonblocking pg deprecation warning noted below.                                                       |
| Fixture cleanup                 | PASS   | Deployment orders cancelled; table/area/product/modifier/group/category soft archived. Financial amounts, item snapshots, audits and events remain accessible.                                                                                             |

The order integration groups cover forged scope/totals, denied kitchen/payment states, empty-order transition rejection, modifier cardinality, foreign-branch references, self/other waiter assignment, immediate membership revocation, actor-bound replay, concurrent edits, stale versions, discount rejection rollback, historical prices, voids and product archive preservation. Injected audit/event failures prove rollback of order, table and branch counter. Runtime and migration-owner attempts to delete/alter immutable history fail. A synthetic PAID state in the isolated test database verifies the future closed-order guard; no payment API or settlement was introduced. BIGINT replay cursors are tested above JavaScript's safe integer range.

The order browser test deliberately lets the server commit an item, drops the HTTP response, reloads the page, then retries the stored command. Exactly one line remains. Both devices also verify a catalog price change leaves the existing line unchanged, discount/tax totals, payment-request locking, table release on cancellation and history.

## Files and entities

New entities: **OrderCounter, Order, OrderItem, OrderItemModifier, OrderEvent**; scoped relations were added to existing branch/membership/table/area/product/modifier records.

Important files:

- `packages/database/prisma/schema.prisma` and `migrations/202609120001_orders/migration.sql`
- `apps/api/src/orders/{orders.controller.ts,orders.service.ts,money.ts}` and registration in `app.module.ts`
- `apps/api/src/layout/layout.service.ts`: transaction-compatible layout event emission reused by Orders
- `apps/admin/src/components/orders-workspace.tsx` and `foundation-app.tsx`
- `packages/shared-types/src/index.ts`, `packages/validation/src/index.ts`, `scripts/provision-runtime.mjs`
- `tests/unit/orders.test.ts`, `tests/integration/orders.mjs`, `tests/e2e/orders.spec.ts`, and the integration harness
- `docs/adr/0004-orders.md`, README, ARCHITECTURE, DATABASE, PERMISSIONS, OFFLINE_SYNC, DEPLOYMENT, API, SECURITY and ROADMAP documentation

Ignored local evidence: `.local/phase4-build-final.log`, `.local/phase4-browser-final.log`, `.local/phase4-docker-build.log`, `.local/phase4-runtime.log`, deployment/role snapshots and live verification scripts. Deployed screenshots are `%TEMP%/restaurant-phase4-desktop.png` and `restaurant-phase4-mobile.png`. Pre-upgrade backup: `backups/restaurant-20260912T083013Z.dump`, with checksum sidecar. A new backup restore drill was not part of Phase 4; the earlier Phase 1 restore verification remains separately documented.

## Failures resolved and limitations

Initial verification exposed a composite-relation fixture/nested-create mismatch, an outdated empty-WAITER permission expectation, and select-label lookup ambiguity. These were fixed. The browser error assertion now starts after authenticated navigation, excluding the expected anonymous refresh 401. The expanded desktop/mobile run exceeded the shared loopback API rate limit; the harness now restarts only its test API between device suites, keeping the same database and leaving production limits unchanged. The final complete regression passed.

Nonblocking warnings remain: pg warns about queued client queries under the current Prisma adapter; this was also present in foundation tests. Vitest warns about future native-config behavior, and Playwright reports NO_COLOR/FORCE_COLOR precedence. These warnings did not fail checks; dependency upgrades were not added to this phase.

Supported quantities are whole sale units; discounts are fixed gross order amounts allocated to lines. Table/type association is fixed at creation; transfer/merge and line modifier replacement require future workflows (a current line can be explicitly voided and replaced). The lifecycle does not dispatch kitchen tickets, settle bills, consume stock or issue fiscal documents. Tax rounding is a documented calculation policy, not Kosovo fiscal certification.

Realtime readiness means durable events/replay and polling, without WebSocket push or cloud synchronization. LAN/server failure pauses writes; there is no offline order queue. SessionStorage retry receipts survive reloads within the tab session, not browser closure. Protect shared profiles and inspect server history if a receipt is lost. Orders are currently in the admin shell; dedicated POS/waiter applications remain deferred.

Existing production-hardening limits still apply: trusted LAN TLS, stronger CSP, secret/device protection, retention policy, independent security review and representative terminal load testing. No new secrets or external service dependencies were introduced. Browser plugin was not available; verification used the repository's Playwright Chromium runner.

## Next phase

Await explicit authorization for Phase 5. Add kitchen submission/routing, preparation transitions and printer-ready ticket contracts against the existing immutable order snapshots/events. Do not enable PAID or Payments as part of that work.
