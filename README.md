# Restaurant Platform

Phases 1-10 of a local-first restaurant POS platform: authentication, administration, branch-owned menu, layout, orders, kitchen tickets, payments and cash shifts. Dine-in/takeaway orders preserve item snapshots and decimal-safe totals. Kitchen submission routes those snapshots to station tickets, with audited preparation states and printer-ready contracts. Payments support immutable receipts, mixed tenders, item splits, partial collections, reversals and counted cash shifts. Inventory adds exact quantities, immutable stock movements, versioned recipes and atomic consumption at final sale settlement. Purchasing adds supplier records, purchase orders, goods receiving and receipt-backed supplier balances. Company contracts, reporting and fiscalization are not implemented yet.

## Stack and applications

The frontend uses **FastFood Riza** branding. Open **POS** for the touch-oriented product grid and cart, **Orders** for order administration, and **Tables** for the restaurant layout. Existing lifecycle, kitchen and collection steps remain separate. See [Riza UI verification](docs/RIZA_UI_VERIFICATION.md) for scope and verified results.

Node.js 24, npm workspaces, TypeScript, NestJS 11, Next.js 16, React 19, Tailwind 4, shadcn/ui source components, Prisma 7 and PostgreSQL 17. REST API under `/api`; only `apps/admin` and `apps/api` run in this phase. Reserved app directories document later phase boundaries.

## Install and verify

From the repository root:

```sh
npm ci
npm run db:generate
npm run build
npm run lint
npm run typecheck
npm test
npm run test:integration
npx playwright install chromium
npm run test:e2e
```

On Windows PowerShell with script execution disabled, use `npm.cmd` and `npx.cmd`. Do not weaken machine-wide execution policy just to run npm.

`test:integration` creates an isolated real PostgreSQL 17 cluster using a development-only binary package, applies migrations twice, provisions the restricted runtime database role, seeds twice and runs HTTP/database assertions. It generates random test credentials and never uses an existing restaurant database. PostgreSQL binds to loopback and stops at completion; generated clusters under `.local/` are ignored by Git. The binary wrapper has a beta package version, but the PostgreSQL engine is the stable 17.10 release; no embedded database wrapper ships as a production dependency.

`test:e2e` builds first, runs the integration suite, then tests production Next.js on desktop/mobile Chromium. Ports 3000 and 4000 must be free. All fixtures are explicit test data, not commercial seed entities.

## Local development with an operator database

1. Install/start PostgreSQL 17 or use Docker. Copy `.env.example` to `.env` and configure business identity and strong generated secrets.
2. Use different migration-owner and application-role passwords. Generate hex secrets with `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"`; do not paste secrets into shared logs.
3. Set `MIGRATION_DATABASE_URL` to the database owner connection, and `DATABASE_URL` to the `restaurant_app` role connection. URL-encode credentials in URLs. `APP_DATABASE_PASSWORD` must contain at least 24 random characters.
4. Run:

```sh
npm run db:generate
npm run build:api
node scripts/migrate.mjs
npm run db:seed
npm run dev:api
```

In a second terminal, run `npm run dev:admin`. Open `http://localhost:3000`, with `APP_ORIGIN=http://localhost:3000`. Sign in with the configured organization slug, branch code and owner credentials. Bootstrap does not reset an existing password or overwrite customized role grants.

Local development requires a running PostgreSQL server. The integration cluster is temporary verification infrastructure, not a restaurant deployment.

## Implemented surfaces

- Organization and current branch reads, seven configurable bootstrap roles and permission mappings.
- Argon2id login, five-minute JWT access, twelve-hour rotating refresh sessions, logout and password-change endpoint.
- Server-side permission guards, strict Zod input validation, branch isolation, CSRF Origin checks, rate limiting and structured errors/logging.
- Branch member creation, access enable/disable and role assignment API; team management UI.
- Role creation and permission editing API/UI with protected owner access and anti-escalation checks.
- Terminal registration, enable/disable, optional terminal-bound login and heartbeat API.
- Transactional audit history, append-only PostgreSQL guards and a read-only audit UI.
- Docker deployment files, runtime database provisioning, backup/restore/scheduling scripts and recovery documentation.

Lists currently cap at 200 records; the audit UI shows the latest 100 events. Organization/branch creation is operator-controlled bootstrap. Multi-branch identity exists, but full multi-branch administration is deferred.

## Documentation

- [Architecture and risks](ARCHITECTURE.md)
- [Database model and migration policy](DATABASE.md)
- [Permission model](PERMISSIONS.md)
- [Deployment](DEPLOYMENT.md)
- [Backup and restore](BACKUP_RESTORE.md)
- [Offline and synchronization plan](OFFLINE_SYNC.md)
- [API contract](docs/API.md)
- [Security boundaries](docs/SECURITY.md)
- [Phase 1 verification](docs/PHASE_1_VERIFICATION.md)
- [Menu architecture decision](docs/adr/0002-branch-menu-catalog.md)
- [Phase 2 verification](docs/PHASE_2_VERIFICATION.md)
- [Layout architecture decision](docs/adr/0003-restaurant-layout.md)
- [Phase 3 verification](docs/PHASE_3_VERIFICATION.md)
- [Phase 7 verification](docs/PHASE_7_VERIFICATION.md)
- [Purchasing architecture decision](docs/adr/0008-purchasing.md)
- [Phase 8 verification](docs/PHASE_8_VERIFICATION.md)
- [Company contracts architecture decision](docs/adr/0009-company-contracts.md)
- [Phase 9 verification](docs/PHASE_9_VERIFICATION.md)
- [Waiter PWA architecture decision](docs/adr/0010-waiter-pwa.md)
- [Phase 10 verification](docs/PHASE_10_VERIFICATION.md)

Open **Menu** for catalog configuration and product-to-kitchen-station routing. **Layout** provides configurable areas and tables. **Orders** creates dine-in/takeaway drafts with modifiers, discounts and history; open an order and choose **Send to kitchen**. Every active line must have an available route. Open **Kitchen**, or the dedicated **/kds** screen, to prepare, mark ready and complete station tickets. Submitted content is frozen; cancellation preserves ticket history. Request payment after opening an unsubmitted order or after all kitchen stations are ready. In **Payments**, open a registered POS cash shift, select a waiting bill and collect by amount or item quantity. Card entries acknowledge externally approved terminal receipts; this application does not process cards. Exact settlement marks the order PAID and frees its table. Refunds preserve the original order and settlement. No business examples are seeded. On upgrades, OWNER grants new permissions to existing roles in **Roles**. See [Phase 6 verification](docs/PHASE_6_VERIFICATION.md) and [payment decisions](docs/adr/0006-payments.md). See [Phase 7 verification](docs/PHASE_7_VERIFICATION.md) and [inventory decisions](docs/adr/0007-inventory.md). See [Phase 8 verification](docs/PHASE_8_VERIFICATION.md) and [purchasing decisions](docs/adr/0008-purchasing.md). Phase 9 requires separate authorization.

## Inventory operation

Open **Inventory** to manage warehouses, ingredients/stock items, recipes, current stock and history. Configure a warehouse and items with their stock units, record opening quantities with **Adjust stock**, then define each product recipe. Search or filter stock by warehouse; low-stock cards provide direct **Adjust**, **Waste** and **Edit alert** actions. Quantities accept compatible kg/g or l/ml conversions without rounding; pcs tracks counts to six decimal places.

A product without an active recipe does not consume inventory. The first payment freezes its recipe quantities; only final settlement deducts stock, once. Later recipe edits preserve that plan. Refunds do not automatically return ingredients. Negative stock stays visible so a sold meal can still be settled. Products can use a recipe directly for packaged goods as well as prepared ingredients. Modifier-specific ingredient rules are not implemented. Purchasing extends this ledger in Phase 8.


## Purchasing and goods receiving (Phase 8)

Open **Purchasing** to add suppliers, prepare purchase-order drafts, confirm orders, post partial/full deliveries and inspect supplier balances. Configure stock items and warehouses in Inventory first. Drafts can be edited; confirmation freezes quantities, names, net unit prices and tax rates. Receive only quantities physically delivered. Each receipt has a unique supplier delivery reference and optional invoice/date, due date and HTTPS document reference. Receiving adds positive PURCHASE movements and the supplier charge atomically.

## Waiter PWA (Phase 10)

Open **/waiter** on a phone or tablet to install the mobile table-service app. It uses the same sign-in, the same branch and the same rules as every other surface: nothing is a separate account or a second engine.

The home view lists your areas and tables with live status — free, occupied, order sent, waiting payment, reserved or disabled. Tap a busy table to open its running bill, or a free one to start a dine-in order. Ordering reuses the existing touch catalogue: categories, search, product images, modifiers, quantities, item and order notes, and totals with the same immutable price and tax snapshots the POS records. Takeaway has its own tab.

**Send to kitchen** routes the order through the existing stations. A sent order is locked, exactly as it is everywhere else: kitchen amendments are not available, so extra items mean a new order for that table. When the guest is ready, **request payment** moves the bill to waiting payment and hands it to the cashier; a waiter never collects money, and company account rules are unchanged. Discounts, cancellation and reassigning another waiter stay with supervisors.

Installing caches only the app shell so it launches quickly. No order, menu or table data is stored on the device. This is not offline ordering: without the restaurant server the app says so instead of accepting work it cannot save. Installation needs HTTPS on a real LAN device; grant staff the WAITER role in **Roles**. See [waiter decisions](docs/adr/0010-waiter-pwa.md).

## Company contracts and B2B accounts (Phase 9)

Open **Companies** to register business customers, agree contracts, authorize the employees who may consume on the account, inspect balances and issue statements. Create the company, add a contract with its credit limit, discount percentage, payment terms and billing cycle, then activate it: only an ACTIVE contract grants credit, and a company holds one at a time. Authorized employees are optional but let you see who consumed what.

In **Payments**, a waiting bill can be collected with the **Company account** method. It settles the order exactly like cash or card and frees the table, but moves no cash: the amount is charged to the company ledger instead. A charge is refused without an active contract, for an employee of another company, or when it would exceed the credit limit — the limit is a hard block, and a zero limit means no credit rather than unlimited. Settling a company invoice is a separate **Record payment** action against the account balance, covering as many orders as the payment settles; it records an externally completed transfer and never opens a POS drawer. A mistaken payment record can be reversed once, which restores the payable.

Generate a **statement** for a period to freeze its charges and payments into an immutable document with opening and closing balances and a due date from the contract terms. Regenerating the same period returns the original. Statements, ledger entries and events cannot be edited or deleted. Archiving a company requires terminated contracts and a settled balance, and its history stays readable afterwards. OWNER grants the Phase 9 permissions to existing staff in **Roles**; no companies or contracts are seeded. See [company contract decisions](docs/adr/0009-company-contracts.md). Fiscalization is still not implemented.

Supplier payments record externally completed transactions against a received invoice/delivery; they do not execute transfers or alter POS drawers. A permitted payment-record reversal restores the recorded payable and references the original entry. Outstanding balances cover only recorded receipts and payments. No suppliers or purchase examples are seeded. Existing staff permissions must be assigned by OWNER. Company Contracts and Fiscalization were not started. See [purchasing decisions](docs/adr/0008-purchasing.md).
