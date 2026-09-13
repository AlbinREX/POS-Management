# Phase 5 verification

**Result: PASS. Verified 2026-09-12.** Scope is kitchen submission, routing, KDS tickets, preparation and printer-ready contracts. Payments and PAID transitions were not implemented.

## Implemented

- Explicit kitchen submission from an OPEN order, with expected version and idempotent command UUID. Every nonvoid item must route to configured active stations; missing/inactive routing rejects the entire submission.
- One immutable submission per order and one ticket per routed station. Product names, quantities, modifier/group names, notes, area/table and waiter details come from saved order snapshots. Catalog price/name changes do not rewrite preparation content. Multi-station items appear with full quantities at every destination.
- NEW -> PREPARING -> READY -> COMPLETED, preparation timestamps, optimistic versions, actor-bound replay and atomic aggregate order progress. Completed kitchen work does not mark an order paid or served. Cancellation retains content and preparation timestamps, marks all associated tickets cancelled and releases the table through the existing order workflow.
- Money-free version 1 preparation and printer contracts, with stable original/cancellation document IDs. No physical printer delivery, printer protocol or fake print success.
- Branch-scoped permissions, immutable audit/history, KitchenRevision/KitchenEvent replay and transactional order/layout event propagation. PostgreSQL checks protect source snapshots, submitted totals, complete routing, state agreement and cancellation consistency.
- Dedicated `/kds` screen using the existing Next.js deployment/authentication, plus Kitchen in the standard workspace. Station filtering, active/history views, large preparation controls, server-clock elapsed times, adjustable delay warning, five-second refresh, stale-state write locking and sessionStorage retry receipts. The dedicated screen exposes no administration navigation.

## PASS/FAIL

| Check                            | Result | Executed evidence                                                                                                                                                                                                                              |
| -------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema/client                    | PASS   | Prisma formatting, `npx.cmd prisma validate`, generation and package compilation                                                                                                                                                               |
| Migrations                       | PASS   | All six migrations applied to isolated PostgreSQL 17.10, twice with no pending second deployment. Existing Docker database upgraded using `202609120002_kitchen`; repeated deploy found no pending migrations.                                 |
| Seed and permission preservation | PASS   | Isolated seed twice and Docker seed rerun. Before/after comparison preserved all installed role mappings except protected OWNER's three new kitchen keys; exactly one immutable migration audit records that grant.                            |
| Lint                             | PASS   | `npm.cmd run lint`, zero errors/warnings                                                                                                                                                                                                       |
| Typecheck                        | PASS   | `npm.cmd run typecheck` across shared packages, API, UI and admin                                                                                                                                                                              |
| Unit tests                       | PASS   | `npm.cmd test`: 72 tests across five files, including kitchen aggregation, forward states, strict inputs, bounded queries and print identity                                                                                                   |
| API/database tests               | PASS   | 77 groups: foundation 28, menu 13, layout 13, orders 13, kitchen 10; real PostgreSQL and restricted runtime role                                                                                                                               |
| Browser regression               | PASS   | `node scripts/integration.mjs --browser`: all five workflows on desktop and mobile, ten passing browser tests                                                                                                                                  |
| Production build                 | PASS   | `npm.cmd run build`: shared packages, NestJS and production Next.js; `/kds` included in the built routes                                                                                                                                       |
| Docker configuration/build       | PASS   | Compose validation and full API/admin/migration image build                                                                                                                                                                                    |
| Docker services                  | PASS   | PostgreSQL/API/admin healthy, migration service exited 0, frontend and `/kds`/API readiness HTTP 200, Nginx config test passed and upstreams reloaded. Nginx has no Docker healthcheck; its config/HTTP behavior was checked directly.         |
| Deployed authenticated workflow  | PASS   | Multi-station dine-in submission; identical submission/ticket retries; historical product/modifier snapshots after catalog edit; coherent table/order/ticket states; printer contract, event and audit reads                                   |
| Deployed browser smoke           | PASS   | Desktop 1440x900 and mobile 390x844 at localhost:8080/kds: login, dedicated screen, station filtering, persisted items/preparation/history, responsive viewport, logout; screenshots inspected and no authenticated-workflow browser errors    |
| Restart recovery                 | PASS   | Restarted db/api/admin/nginx, awaited readiness and reloaded Nginx. One PREPARING ticket and one NEW ticket, the 12.00 order total, ORDER_SENT table, immutable content/history and earlier Phase 4 cancelled order total 15.00 all persisted. |
| Database runtime guards          | PASS   | Six applied migrations, one kitchen permission-upgrade audit, sixteen enabled kitchen integrity/history triggers, committed event cursor and restricted runtime grants                                                                         |
| Deployed completion/cancellation | PASS   | Advanced both tickets through all four states; order became READY, never PAID. Explicit PAID request returned 400. Cancellation generated distinct printer contract and retained completed timestamps/history.                                 |
| Fixture cleanup                  | PASS   | Deployment order cancelled; area/table/product/modifier/group/category/stations soft archived. No financial or kitchen history was deleted.                                                                                                    |
| Runtime logs                     | PASS   | Reviewed deployment, restart and cleanup logs; no application/database error, fatal/panic or Nginx error/emergency entries. Existing nonblocking dependency warnings are noted below.                                                          |

Integration coverage includes denied kitchen-to-financial/admin API access, missing/inactive routes with no partial tickets, immutable content after catalog changes, submitted-item and financial edit rejection, forward-only state transitions, readiness across every station, concurrent writes with one winner, actor-bound retries, foreign-branch detail/history/print/feed rejection, relational scope constraints, cancellation of completed work, append-only history and BIGINT cursors above JavaScript's safe integer range. Injected kitchen event failures roll back submission, ticket progress, order versions, cancellation and the branch cursor. The database also rejects premature order READY while another station remains unready.

The browser workflow submits from Orders, then signs into `/kds` with a kitchen-only user. It checks that the old product and modifier names remain visible after catalog changes, deliberately loses the response after a committed preparation update, reloads and retries with exactly one transition, simulates LAN/API read failure and verifies write locking, completes tickets, inspects cancellation/history and checks document overflow. Production rate limits are unchanged; the harness restarts only the test API between independent browser files/devices that otherwise share one loopback IP.

## Important files and entities

New entities: **KitchenSubmission, KitchenTicket, KitchenTicketItem, KitchenRevision, KitchenEvent**. Relations were added to existing Order, OrderItem, KitchenStation, Branch and BranchMembership.

- `packages/database/prisma/schema.prisma` and `migrations/202609120002_kitchen/migration.sql`
- `apps/api/src/kitchen/kitchen.controller.ts`, `kitchen.service.ts`, `kitchen.transactions.ts`
- `apps/api/src/orders/orders.service.ts` and `app.module.ts`
- `apps/admin/src/app/kds/page.tsx`, `components/kitchen-display.tsx`, `orders-workspace.tsx`, `foundation-app.tsx`
- Shared types/validation and `scripts/provision-runtime.mjs`
- `tests/unit/kitchen.test.ts`, `tests/integration/kitchen.mjs`, `tests/e2e/kitchen.spec.ts`, role-default assertions and integration harness
- ADR 0005 and README, ARCHITECTURE, DATABASE, PERMISSIONS, DEPLOYMENT, OFFLINE_SYNC, API, SECURITY and ROADMAP documentation

Ignored local evidence: `.local/phase5-build-final.log`, `phase5-browser-final.log`, `phase5-docker-build.log`, `phase5-runtime.log`, role/deployment snapshots and live verification scripts. Deployed screenshots are `%TEMP%/restaurant-phase5-desktop.png` and `restaurant-phase5-mobile.png`. Pre-upgrade backup: `backups/restaurant-20260912T135252Z.dump` with checksum sidecar. A new restore drill was not part of Phase 5.

## Limitations and security

One submission per order is supported. Additional rounds, item amendments or partial cancellations after submission need a separate amendment protocol; current submitted content stays frozen and whole-order cancellation remains available. COMPLETED means cleared from the kitchen, not customer service completion or payment. No Payments, new PAID transition, stock consumption or fiscal integration was added.

Realtime-ready persistence and five-second polling are implemented; WebSocket push, physical printer/spool execution, cloud synchronization and offline write queues are not. Printer consumers must add device authorization, encoding/control-byte sanitization, persistent delivery/acknowledgement and reprint policy. Contracts alone are not proof of physical printing. Delay warnings are an on-screen threshold, not station SLA reporting.

The KDS is a dedicated route in the existing frontend deployment, not an independently built apps/kds service. Historical stations remain selectable. Existing kitchen staff require explicit owner grants because the upgrade preserves customized role permissions. Retry receipts survive reload within the tab session, not browser closure; inspect server history before replacing a lost command. Existing LAN TLS, CSP, shared-device protection, retention/backup and independent security-review requirements remain. No new external service dependency or committed secret was introduced.

During implementation Prisma required an explicit composite unique key for the submission/order one-to-one relation; this was fixed before deployment. The old KITCHEN/WAITER default-permission assertions were updated for the authorized new permissions. No unresolved failing check remains. Existing pg queued-query deprecation, Vitest future native-config and Playwright color-environment warnings remain nonblocking; dependency upgrades were outside this phase.

## Next step

Await explicit authorization before Phase 6. Payments must use the existing immutable order snapshots, transactional audit/event boundaries and protected submitted totals; do not equate kitchen completion with payment.
