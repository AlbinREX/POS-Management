# Restaurant Platform

Phases 1-6 of a local-first restaurant POS platform: authentication, administration, branch-owned menu, layout, orders, kitchen tickets, payments and cash shifts. Dine-in/takeaway orders preserve item snapshots and decimal-safe totals. Kitchen submission routes those snapshots to station tickets, with audited preparation states and printer-ready contracts. Payments support immutable receipts, mixed tenders, item splits, partial collections, reversals and counted cash shifts. Inventory, reporting and fiscalization are not implemented yet.

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

Open **Menu** for catalog configuration and product-to-kitchen-station routing. **Layout** provides configurable areas and tables. **Orders** creates dine-in/takeaway drafts with modifiers, discounts and history; open an order and choose **Send to kitchen**. Every active line must have an available route. Open **Kitchen**, or the dedicated **/kds** screen, to prepare, mark ready and complete station tickets. Submitted content is frozen; cancellation preserves ticket history. Request payment after opening an unsubmitted order or after all kitchen stations are ready. In **Payments**, open a registered POS cash shift, select a waiting bill and collect by amount or item quantity. Card entries acknowledge externally approved terminal receipts; this application does not process cards. Exact settlement marks the order PAID and frees its table. Refunds preserve the original order and settlement. No business examples are seeded. On upgrades, OWNER grants new permissions to existing roles in **Roles**. See [Phase 6 verification](docs/PHASE_6_VERIFICATION.md) and [payment decisions](docs/adr/0006-payments.md). Phase 7 requires separate authorization.
