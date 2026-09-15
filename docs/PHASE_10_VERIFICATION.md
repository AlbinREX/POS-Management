# Phase 10 verification: waiter PWA

Verified locally on **2026-09-15**. Scope is Phase 10 only. No reporting, owner dashboard or fiscalization implementation was added.

Phase 10 requires separate authorization under `docs/ROADMAP.md` and `docs/PHASE_9_VERIFICATION.md`. The operator gave that authorization explicitly in this session, requesting a mobile-first waiter PWA that reuses the existing authentication, permission, table, order, menu, kitchen, payment, audit/event and idempotency logic without duplicating or bypassing it.

## Implemented

- An installable waiter surface at `/waiter`, served by the existing Next.js deployment and mirroring the Phase 5 `/kds` precedent. It reuses the same sign-in, refresh-cookie session restore, `/api` proxy, CSP and Docker/Nginx topology.
- A mobile shell with FastFood Riza branding, the signed-in waiter and branch, sign-out, and a fixed bottom tab bar over Tables, Orders and Takeaway.
- A table view listing configurable areas with live status - FREE, OCCUPIED, ORDER_SENT, WAITING_PAYMENT, RESERVED and DISABLED - using the floor plan's own labels and colours. A busy table is mapped to its live order by table identifier and opens that bill; a free table starts a new dine-in order. Refreshes are driven by the durable layout change feed and its branch revision cursor.
- Mobile ordering through the existing touch catalogue: DINE_IN and TAKEAWAY, categories, product search, product grid, images with fallbacks, modifiers, quantities, item and order notes, permission-gated discounts and totals, preserving the same immutable product, price, tax and modifier snapshots the POS records.
- Kitchen submission through the existing routing, with submission status shown and duplicate submission prevented by the existing command replay.
- Payment handoff: the waiter moves a ready order to WAITING_PAYMENT and the cashier collects. The PWA contains no payment engine; settlement continues through the Phase 6 flows and a company account charge still obeys the Phase 9 rules.
- A service worker precaching the application shell only, with every `/api` request bypassing the cache entirely, plus a web app manifest, maskable icons and a standards-correct multi-size favicon.
- No database table, migration, permission key or business rule was added.

## Verification results

| Check                 | Result | Evidence                                                                                                                                                                                                                                                            |
| --------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint                  | PASS   | `npm.cmd run lint`; zero ESLint warnings or errors.                                                                                                                                                                                                                 |
| Typecheck             | PASS   | `npm.cmd run typecheck`; shared packages, database, API, UI and Next.js.                                                                                                                                                                                            |
| Unit tests            | PASS   | `npm.cmd test`; **104 tests across ten files**, including four new waiter tests covering table-to-order resolution across every active lifecycle state, terminal-state exclusion, and the exact waiter permission set.                                              |
| Integration tests     | PASS   | **145 checks** across foundation 28, menu 13, layout 13, orders 13, kitchen 10, payments 14, inventory 14, purchasing 14, companies 17 and **waiter 9**. Real isolated PostgreSQL with migrations, restricted runtime grants and HTTP requests.                     |
| Browser and PWA tests | PASS   | `npm.cmd run test:e2e`; **22 browser tests, 11 desktop and 11 mobile, zero failures**, including the new waiter workflow plus every prior phase.                                                                                                                    |
| Production build      | PASS   | `npm.cmd run build`; `/waiter` prerendered alongside `/` and `/kds`; PWA assets served from `public/`.                                                                                                                                                              |
| PWA artifacts         | PASS   | The rendered page declares `link[rel=manifest]` and icon links. The manifest returns `display: standalone`, `start_url: /waiter`, `theme_color: #111214` and three icons, each fetched and confirmed 200. `/sw.js` is served and contains the `/api/` early return. |
| Service worker safety | PASS   | The worker returns before touching the cache for any `/api` pathname, so no authenticated branch-scoped response is stored. Registration is production-only. Asserted in the browser test against the served worker source.                                         |
| Deployed container    | PASS   | Admin image rebuilt and recreated. Through Nginx at `localhost:8080`: `/waiter`, `/favicon.ico`, `/manifest.webmanifest`, `/sw.js` and all three icons return 200, and the response carries `worker-src 'self'` and `manifest-src 'self'`.                          |
| Favicon metadata      | PASS   | Multi-size ICO with four PNG entries at 16, 32, 48 and 256. Each directory entry's declared dimensions were read back and matched against its PNG payload; 256 is encoded as 0 per the format, and no other entry uses 0.                                           |
| Migrations            | PASS   | Ten migrations, unchanged by this phase; `packages/database/prisma/schema.prisma` has an empty diff.                                                                                                                                                                |
| Backup/restore impact | PASS   | **None.** Phase 10 adds no schema change, so no migration, backup or restore procedure is affected. The Phase 9 drill remains the current evidence for restore integrity.                                                                                           |

Local evidence is ignored under `.local/phase10-*`.

## Waiter integrity coverage

The nine waiter integration groups assert that a waiter role reads tables, areas, the layout change feed, menu and orders while being refused the kitchen display, payments, users, audit history and companies; that opening a dine-in order marks the table OCCUPIED; that adding an item preserves the product name, unit price, quantity and notes snapshots; that an identical command replays its receipt without duplicating a line while a changed body under the same command id conflicts; that discount, cancellation and reassigning another waiter are refused; that kitchen submission routes exactly once, replays its receipt, leaves exactly one submission row, moves the table to ORDER_SENT and then rejects further item commands; that requesting payment needs no payment permission while collection remains refused; that another branch's tables and areas are invisible and unusable; and that revoking waiter grants stops writes immediately on the existing session.

The browser workflow installs against the production server, verifies the manifest, icons and service worker before authentication, signs in as a WAITER-role account, confirms the administration navigation is absent, reads the live table grid, opens a table's order and checks horizontal overflow on both desktop and mobile viewports.

## Important files

- `apps/admin/src/app/waiter/page.tsx`, `apps/admin/src/components/waiter-app.tsx` and the `waiterOnly` branch in `foundation-app.tsx`.
- `apps/admin/public/`: `manifest.webmanifest`, `sw.js`, `favicon.ico` and the three icons.
- `apps/admin/src/app/layout.tsx` (viewport, theme colour, manifest, icons, Apple web app), `apps/admin/next.config.ts` (explicit `worker-src` and `manifest-src`), `apps/admin/src/app/globals.css` (the `.waiter-*` section).
- `apps/admin/src/components/orders-workspace.tsx`: an optional `initialOrderId` so the waiter shell can open a table's live bill. No ordering, pricing or command behaviour changed.
- `tests/unit/waiter.test.ts`, `tests/integration/waiter.mjs`, `tests/e2e/waiter.spec.ts` and the suite registration in `scripts/integration.mjs`.
- ARCHITECTURE, README, PERMISSIONS, DEPLOYMENT, OFFLINE_SYNC, ROADMAP and [ADR 0010](adr/0010-waiter-pwa.md).

## Resolved verification failures

Every failure in this phase was in the new test or asset layer, not in application behaviour.

The browser spec first authenticated as the owner through `page.request` for fixture setup, which shares the browser context's cookie jar, so navigating to `/waiter` restored that session and rendered the waiter shell instead of the sign-in form. The spec now clears cookies before navigating, and scopes its table assertion to its own project-prefixed fixture because the integration suite's table was also matching.

Two console errors then failed the mobile run. The response listener was extended to record the failing URL rather than a generic message, which named them: `/favicon.ico`, missing repository-wide and probed by the mobile context on load, and later two deliberate broken image fixtures under `/qa/` created by the POS spec to exercise the catalogue's image fallback. The favicon was added as a real multi-size ICO, which removes a 404 from every page in the application; the `/qa/` fixtures are another suite's intended artifact and are excluded from this spec's assertion rather than treated as a fault here.

An initial favicon attempt declared 0 width and height for a 192-pixel image. In the ICO format 0 means 256, so that was malformed metadata; it was replaced with correctly described 16, 32, 48 and 256 entries and the directory was read back and verified against each payload.

A React hook lint error was fixed by copying the existing generation-counter idiom from the orders workspace rather than suppressing the rule.

## Limits and security status

- This is an installable PWA, not offline ordering. The service worker precaches the shell only; no order, menu, table or session data is cached. Without the local server the app reports an explicit connection failure and queues nothing. Offline behaviour, background sync and conflict resolution remain Phase 12.
- Service workers require a secure context. Installation works on loopback for evaluation, but a LAN deployment needs the documented TLS profile with a certificate the waiter devices trust. Over plain HTTP on a LAN hostname the surface still runs as an ordinary page; only installation and shell precaching are unavailable.
- Kitchen submission remains all-or-nothing. A sent order is locked and additional items require a new order for the table. An amendment protocol would need its own integrity guards and is deliberately out of scope.
- The waiter cannot discount, cancel, reassign another waiter, read the kitchen display, list eligible waiters or collect money; the server enforces this regardless of the client.
- Table status shown in the PWA is the authoritative server status, refreshed on the existing five-second cadence. There is no push delivery.
- Screenshots were captured to the system temporary directory; no visual regression baseline is established. Chromium was tested on desktop and an iPhone 13 emulation; physical devices, Safari and Firefox were not.
- No formal penetration test or sustained multi-device load test was performed.

Phase 11 requires separate authorization. Do not start it automatically.
