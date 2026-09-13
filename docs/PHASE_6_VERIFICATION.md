# Phase 6 verification

**Result: PASS. Verified 2026-09-12.** Phase 6 implements local payment recording and cash register shifts. Inventory and Fiscalization remain unimplemented.

## Implemented

- CASH and externally approved CARD receipts, atomic mixed-tender batches, partial payments, full balance collection and item-quantity splitting. Money is calculated in integer cents; discounted immutable line totals are divided deterministically across numbered source units, preserving every remainder cent.
- Cash tendered/change are separate from the amount applied to the order. The drawer ledger receives applied cash only. Card fields contain an external terminal receipt reference; this application neither processes cards nor stores card credentials.
- Immutable OrderBill mode, payment/allocation/reversal history and OrderSettlement. Exact valid settlement is the only path to PAID. Zero-total nonempty bills need an explicit settlement command. Paid order totals, snapshots, status and version remain unchanged by refunds or later kitchen completion.
- Full cancellation of an unsettled payment, and bounded partial/full refunds against the original settled payment. Separate configurable permissions protect both. Cancellations restore due and release item allocations logically; refunds preserve the original settlement and PAID state. Financial records cannot be hard deleted.
- Registered POS cash shifts, one open shift per terminal and per branch cashier, opening float, cash in/out, payment/reversal movements, counted closing, expected cash and explained discrepancies. Operators use their own active shift. Refunds from a later shift preserve the original closed drawer.
- Transactional audit and branch-scoped PaymentEvent/PaymentRevision history, actor-bound command replay, optimistic versions, serializable writes and relational integrity guards. No permission or cashier/branch identity is trusted from request data.
- Payments workspace in the existing Next deployment: visible balances, mixed cash/card collection, item quantities, payment/reversal history and drawer operations. Cashier permissions hide refund/admin controls. Five-second authoritative polling, stale-data write locking and persisted sessionStorage command receipts support explicit retry after a lost response/reload.
- Existing kitchen rules preserved: submitted orders must reach all-stations-ready before requesting payment; a READY ticket may become COMPLETED after PAID without updating the paid order. Exact settlement releases its table atomically.

## PASS/FAIL

| Check                           | Result | Executed evidence                                                                                                                                                                                   |
| ------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prisma schema and client        | PASS   | Formatting, generation, `npx.cmd prisma validate`, generated type compilation                                                                                                                       |
| Migrations                      | PASS   | Seven migrations applied to isolated PostgreSQL 17.10 and deploy repeated with no pending changes; existing Docker database upgraded with `202609120003_payments` and deploy repeated               |
| Seed/role preservation          | PASS   | Isolated seed twice; Docker seed rerun; pre/post upgrade comparison proved only protected OWNER gained the seven new keys and other installed mappings were unchanged                               |
| Database guards/grants          | PASS   | Deployed probe verified 31 financial/cash triggers, seven migrations, one audited OWNER permission upgrade, runtime history mutation restrictions and persisted settlement                          |
| Lint                            | PASS   | `npm.cmd run lint`, zero warnings; rerun after implementation                                                                                                                                       |
| Typecheck                       | PASS   | `npm.cmd run typecheck`, packages/API/UI/admin; rerun after implementation                                                                                                                          |
| Unit tests                      | PASS   | 82 tests across six files: validation 13, menu 18, layout 23, orders 13, kitchen 5, payments 10                                                                                                     |
| Integration                     | PASS   | 91 groups: foundation 28, menu 13, layout 13, orders 13, kitchen 10, payments 14; real PostgreSQL with production runtime grants                                                                    |
| Browser regressions             | PASS   | Full `node scripts/integration.mjs --browser`: six workflows on desktop and mobile, 12 passing browser tests                                                                                        |
| Production builds               | PASS   | `npm.cmd run build`; Docker rebuilt API, admin and migration targets with production Next build                                                                                                     |
| Docker/Compose                  | PASS   | Compose config validation; full build/start; PostgreSQL/API/admin health checks; migration exits 0; Nginx configuration and HTTP checked directly                                                   |
| Deployed authenticated workflow | PASS   | Dine-in snapshot order, modifier, discount, kitchen readiness, mixed 4.00 cash + 6.00 card settlement, 10.00 cash tendered / 6.00 change, exact command replay and table release through Nginx      |
| Restart recovery                | PASS   | Restarted db/api/admin/nginx, waited for recovery; original PAID order, settlement, two receipts, drawer balance and READY kitchen ticket persisted exactly                                         |
| Deployed refunds and close      | PASS   | Kitchen ticket completed after payment without changing order; linked cash/card refunds left original total/PAID intact and net receipts 0.00; shift closed at expected 100.00 with difference 0.00 |
| Existing data preservation      | PASS   | Compared pre-upgrade order IDs/statuses/totals/versions, kitchen ticket content/states/versions and role mappings after upgrade and restart                                                         |
| Logs                            | PASS   | Reviewed deployment/restart/cleanup logs: no application failure, database ERROR/FATAL or Nginx error entries                                                                                       |

Nginx has no Docker healthcheck in this Compose file; its syntax, running state and HTTP traffic were verified separately. The existing loopback endpoint remains `http://localhost:8080`, with Payments in the main workspace and `/kds` unchanged.

## Critical integration evidence

The new payment suite verifies permission denial, strict money/reference/body validation, OPEN-versus-WAITING lifecycle, drawer ownership/uniqueness, duplicate command replay, exact cash change, partial balances, duplicate external references, overcollection and short tender rejection. It covers historical catalog changes, frozen billed orders, full cancellation, atomic mixed settlement/table release, post-close cash refunds, partial card refunds, reversal caps and deterministic item rounding/reallocation.

Concurrent settlement and concurrent over-limit refund attempts each have exactly one winner. Tests inject PaymentEvent failure to prove payment, settlement, cash movement, order version, table release and refunds all roll back. Direct runtime and migration-owner writes cannot synthesize PAID without settlement, overcollect, omit required cash movements, change snapshots, delete financial history or alter closed drawer counts. Branch-isolation tests include detail/history/feeds, collection, reversal, cash shift lookup and composite event foreign keys. Event cursors are checked above JavaScript's safe integer range; permission revocation takes effect on existing sessions.

## Frontend QA

Browser plugin classification: **absent**. The repository's Playwright/Chromium workflow was used because the Browser plugin and browser skill were not available. No plugin installation or external account integration was needed.

Flow: sign in -> Payments -> open cash shift -> collect cash/card -> lose response after server commit -> reload -> retry saved command -> inspect PAID and two receipts -> refund -> simulate read outage and disabled writes -> recover -> cash out -> counted close. A fresh CASHIER then pays two item quantities as separate card receipts, sees the partial balance decrease to zero, and has no refund/admin controls.

| Rendered check                       | Result | Evidence                                                                                                                   |
| ------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------- |
| Page identity and meaningful content | PASS   | Expected Restaurant title, local root URL, Payments/Bills/Cash register headings                                           |
| Framework/runtime errors             | PASS   | No page errors or framework overlay; unexpected console errors fail the test                                               |
| Console boundary                     | PASS   | Anonymous initial refresh 401 and deliberately injected network failures classified explicitly; no other console errors    |
| Interaction proof                    | PASS   | Server state agrees with displayed receipt count, partial/due amounts, PAID, change, refund and counted close              |
| Responsive layout                    | PASS   | Desktop 1280x720 and mobile 390x664 browser projects; no horizontal overflow                                               |
| Deployed browser views               | PASS   | Separate 1440x1000 desktop and 390x844 mobile authenticated history checks against Nginx after deployment                  |
| Screenshot review                    | PASS   | Inspected deployed desktop mixed-tender history and mobile cashier item-split result; controls readable and layouts intact |

Screenshots are outside the repository in the Windows temporary directory: `restaurant-phase6-desktop.png`, `restaurant-phase6-mobile.png`, `restaurant-phase6-items-desktop.png`, `restaurant-phase6-items-mobile.png`, and `restaurant-phase6-live-{desktop,mobile}.png`. These show verification data before cleanup, not active business records.

## Important files

- `packages/database/prisma/schema.prisma` and `migrations/202609120003_payments/migration.sql`: nine new entities, enums, indexes, composite constraints, immutable history and settlement/cash guards.
- `apps/api/src/payments/`: controller, transaction service and integer money functions.
- `apps/api/src/orders/orders.service.ts` and `kitchen/kitchen.service.ts`: billed-order locking, cancellation limits and post-settlement kitchen completion.
- `packages/shared-types/src/index.ts` and `packages/validation/src/index.ts`: configurable permissions, DTOs and strict commands.
- `apps/admin/src/components/payments-workspace.tsx`, `foundation-app.tsx`, `orders-workspace.tsx`: cashier workflow and navigation/lock integration.
- `tests/unit/payments.test.ts`, `tests/integration/payments.mjs`, `tests/e2e/payments.spec.ts`: financial and rendered acceptance tests; previous order guard tests now reject synthetic PAID.
- `scripts/provision-runtime.mjs`, `scripts/integration.mjs`: immutable runtime grants and new suite registration.
- README, ARCHITECTURE, DATABASE, PERMISSIONS, OFFLINE_SYNC, DEPLOYMENT, docs/API, docs/SECURITY, docs/ROADMAP and ADR 0006: updated scope, contracts and operational decisions.

## Limits and security concerns

- Card operations acknowledge a separately approved physical terminal transaction. No acquiring API, automatic reversal, reconciliation worker or payment-card data processing is implemented. Real card money movement was not tested. Staff must verify terminal approval/refund and reconcile uncertain external outcomes before creating another local command.
- Payments require WAITING_PAYMENT; existing submitted-order readiness and one-submission rules remain. No post-submission amendment, pre-kitchen paid-order submission, fractional physical-unit split or split-by-seat workflow was added. A bill's AMOUNT/ITEMS mode stays fixed.
- Limits are 200 payments per order, 100 reversals per payment, 20 tenders per command and 2000 physical units in item mode. This phase's tests are correctness checks, not a sustained peak-load benchmark.
- Current delivery uses local polling plus durable events, not WebSocket push or cloud synchronization. Server/LAN failure pauses payments. The browser command receipt survives reload but may be lost when a tab/storage is cleared; reconcile server history before recharging.
- Production LAN TLS, managed devices, restricted migration credentials, data retention policy and external-terminal reconciliation remain operational requirements. No production security or fiscal certification is claimed. No passwords, configuration secrets, card credentials or existing credentials were changed.
- The backup `backups/restaurant-20260912T185614Z.dump` and SHA256 checksum were created before upgrade. No new restore drill or WAN-disconnection exercise was performed in Phase 6; earlier phase reports remain the evidence for their own checks.
- Nonblocking existing warnings remain: pg concurrent-query deprecation in the test adapter path, Vitest future native-config warning and Playwright color-environment warning. Runtime deployment logs were free of errors.
- Verification fixtures were fully refunded, cash shifts closed, kitchen work completed and configuration soft archived/disabled. Original paid totals, settlements, receipts, refunds, movement and audit history remain inspectable.

Phase 7 requires separate authorization. Do not start Inventory or Fiscalization automatically.
