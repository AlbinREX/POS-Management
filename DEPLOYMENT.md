# Local deployment

## Phase 13 production hardening

Runtime images now contain only what they run. Production dependencies resolve in a separate stage with a fresh `npm ci --omit=dev`, and each runtime stage copies compiled output, the generated Prisma client and package manifests only. Source, tests, documentation and scripts are absent from the API and admin images; the migration image separately carries the Prisma CLI, the migration SQL and the two scripts it executes. Rebuild all three images on upgrade.

A production API refuses to start on placeholder configuration. It requires a database password that is neither a placeholder nor shorter than 24 characters, a high-entropy JWT secret, and a non-loopback HTTPS origin. A half-configured server now fails immediately with a precise message instead of serving traffic. Development and test are unaffected.

The API mounts `backups/` read-only so it can report backup age and outcome without being able to create, alter or delete an archive. Set `BACKUP_STATUS_FILE` only if the archives live elsewhere.

`GET /api/ops/status`, behind the new `ops.read` permission, reports database reachability, backup age and outcome, the Phase 12 delivery backlog and filesystem headroom, with the aggregate severity equal to the worst individual signal. Grant `ops.read` to owners and administrators through Roles; migration `202609180001_ops` grants it to protected OWNER automatically.

After upgrading, verify that the stack starts, that `GET /api/ops/status` returns `severity` with four checks for an owner and 403 for a cashier, and that a deliberate misconfiguration of `DATABASE_URL` in a scratch environment causes the API to exit rather than start.

## Phase 3 upgrade

Back up the existing database. Build the updated images and start Compose; its migration/provisioning service applies `202609110002_layout` before the API starts. Runtime provisioning revokes mutation rights on LayoutEvent, so use `node scripts/migrate.mjs` for host-managed deployments as well. Existing protected owners receive layout.read, layout.manage and layout.status.manage with an audit event; other existing roles need explicit grants. Seed creates no areas or tables. Verify a map edit, status change, persisted audit/event and second-client refresh. No WebSocket proxy change is needed for this phase's authenticated change-feed polling.

## Phase 2 upgrade

Back up the Phase 1 database before upgrading. Build the updated images and run Compose; its migration service applies `202609110001_menu` and provisions the new runtime grants before the API starts. Existing protected owners receive menu.read/menu.manage with an immutable migration audit record. Other existing roles retain their grants; an owner assigns menu access intentionally through Roles. Seed is still idempotent and creates no categories, products or sample stations. Validate the menu create/edit/archive workflow and audit records after upgrading. For host-managed PostgreSQL, run `node scripts/migrate.mjs` rather than only `prisma migrate deploy`, so association-table runtime grants are refreshed.

## Prerequisites and status

Use Docker Engine/Desktop with Linux containers and Compose v2.24.4 or later, trusted LAN TLS certificates and a stable server address. Development requires Node.js 24 and PostgreSQL 17. This foundation is not yet approved for restaurant production: Docker service execution, TLS, load, WAN-loss and recovery drills must pass first.

The Compose graph is PostgreSQL -> migration/provisioning one-shot -> API -> admin -> Nginx. PostgreSQL has a named persistent volume, no host database port and an isolated backend network. Nginx is the only exposed service. Images must be pulled/built while internet is available and retained locally for restart during an outage.

## Loopback Docker evaluation

1. Copy `.env.example` to `.env`.
2. Set real bootstrap business identity. Generate independent random hex `POSTGRES_PASSWORD`, `APP_DATABASE_PASSWORD`, `JWT_SECRET` and owner password. Hex avoids Compose URL-encoding ambiguity. The runtime password must be at least 24 characters; JWT secret at least 64.
3. Set `NODE_ENV=development` and `APP_ORIGIN=http://localhost:8080`.
4. Run from the root:

```sh
docker compose --env-file .env -f infrastructure/docker/compose.yml config --quiet
docker compose --env-file .env -f infrastructure/docker/compose.yml up -d --build
docker compose --env-file .env -f infrastructure/docker/compose.yml ps
```

`migrate` must exit successfully; db/api/admin must be healthy. Bootstrap once with the same business configuration, but do not supply the owner password to normal runtime services:

```sh
docker compose --env-file .env -f infrastructure/docker/compose.yml run --rm --env-from-file .env migrate node scripts/docker-seed.mjs
```

The standalone bootstrap command needs Compose support for `run --env-from-file`; if unavailable, use explicit `--env SEED_...` values from a protected shell environment. Never put literal passwords into shared command history. `scripts/docker-seed.mjs` builds an internal database-owner URL from the supplied environment. Existing identity/grants are preserved.

Open `http://localhost:8080`. This binding is loopback only. The normal runtime API receives only runtime DB credentials and the JWT secret, not migration/seed credentials.

## LAN deployment with HTTPS

Place trusted certificates in ignored `infrastructure/nginx/certs/fullchain.pem` and `privkey.pem`; restrict private-key file access. Set `NODE_ENV=production` and `APP_ORIGIN=https://your-lan-hostname` without a trailing slash. The API rejects non-HTTPS production origins. Use an internal CA trusted by all POS/waiter devices or appropriate DNS certificates; certificate renewal must work without interrupting local operations.

```sh
docker compose --env-file .env -f infrastructure/docker/compose.yml -f infrastructure/docker/compose.production.yml config --quiet
docker compose --env-file .env -f infrastructure/docker/compose.yml -f infrastructure/docker/compose.production.yml up -d --build
```

Only Nginx should be reachable from the LAN. `TRUST_PROXY=1` is valid only with this single trusted proxy and no exposed API port. Restore operator firewall rules, monitor disk/CPU/memory, and keep host OS and container images patched. API/admin containers run as the node user. Current images prioritize a reproducible build and share workspace dependencies; image slimming, read-only roots and resource limits remain deployment-hardening work.

## Upgrades and rollback

Back up and test restore before migration. Build/test the candidate, preserve the prior image and apply reviewed migrations using owner credentials. Never run `migrate reset` or `docker compose down -v` against a restaurant. Destructive schema changes require expand/contract rollout and a documented data migration. Rolling application code back is safe only while the migrated schema remains compatible; otherwise restore into a new database and follow the controlled recovery procedure.

## Readiness checks

`GET /api/health/live` checks process health; `/api/health/ready` checks PostgreSQL. A database outage must produce readiness failure and explicit UI errors. Verify login, runtime permissions, terminal registration, audit persistence after restart, TLS/cookie flags, backup schedule/retention and restore before actual staff use. No load capacity or production uptime SLA has been measured in Phase 1.

# Phase 4 upgrade

Take a verified backup, then rebuild API/admin/migration images and run Compose readiness. Migration `202609120001_orders` is additive, transactional and retains all menu/layout data. The migration runner reprovisions runtime grants, denying order/history deletion and event/modifier mutation. Only protected OWNER receives new permissions automatically; owner grants access to existing operational roles. Repeat seed preserves customized role grants. Reload Nginx after recreating upstream containers, then verify authenticated order creation, item totals, table occupancy, history and restart persistence. See [Phase 4 verification](docs/PHASE_4_VERIFICATION.md) for the executed checks.

## Phase 5 upgrade

Back up the Phase 4 database, rebuild the existing Docker targets and apply `202609120002_kitchen` through the migration service. Reprovision runtime grants and explicitly assign kitchen permissions to existing staff through OWNER. Configure product station routes before submission. The existing frontend serves /kds; no new service, port or public-cloud dependency is needed. Reload Nginx after recreation. Verify routing, preparation, cancellation, printer contract reads, denied financial/admin access for kitchen staff and persistence across stack restart. See [Phase 5 verification](docs/PHASE_5_VERIFICATION.md). Payment collection stays disabled.

## Phase 6 upgrade

Take a database backup before deploying `202609120003_payments`; then rebuild api/admin/migrate, run Compose migration/provisioning and start the stack. Seed is idempotent and preserves installed role customizations; OWNER must explicitly grant payment keys to existing cashiers/managers in Roles. Register active POS terminals before opening cash shifts. No payment examples or open drawers are seeded. Verify cash/card mixed settlement, receipt replay, counted shift close and restart persistence through Nginx. See docs/PHASE_6_VERIFICATION.md.

Card recording does not move funds: staff must inspect the separate terminal approval/reversal receipt. Configure LAN HTTPS and managed cashier devices before live operations. Printed fiscal receipts, ATK rules and tax certification are not supplied by Phase 6.

## Phase 7 upgrade

Build api/admin/migrate images, take a verified backup, then stop the old API before applying `202609130001_inventory` with the migration service. The migration adds mandatory inventory-plan checks to new settlements, so the old API must not accept payments against the upgraded database. Start the matching API/frontend images together and reload Nginx upstream resolution. The migration is transactional, inserts only unit/permission reference data, and reprovisions immutable-ledger runtime grants. Existing business records and passwords remain intact.

Configure warehouses, stock items, opening adjustments, low-stock thresholds and product recipes through Inventory before relying on consumption figures. An unset recipe intentionally has no consumption. Grant inventory permissions to existing staff through OWNER; seed never replaces customized grants. No new service or public-cloud dependency is required. Check stock/history access, forbidden cross-branch requests and payment settlement against an isolated test database before deployment. See [Phase 7 verification](docs/PHASE_7_VERIFICATION.md).

## Phase 8 upgrade

Back up before applying `202609140001_purchasing`. Build matching api/admin/migrate images, stop the old API, run the migration service (including restricted runtime provisioning), start API/admin and reload Nginx. Preserve the PostgreSQL volume and existing secrets. No business examples or supplier balances are seeded. New StockMovement references are nullable for existing stock history; historical sales/payments are not rewritten.

OWNER grants Phase 8 permissions to existing staff through Roles. Set up supplier records and use the branch's existing Inventory warehouses/items. Purchase costs are net per selected unit; enter tax from actual supplier documents. Verify a staged partial receipt, command replay, remaining quantities and supplier balance before live receiving. Supplier payment entry is a recording action; bank/card execution and POS cash-shift movements remain separate. Posted receipt reversal/credit notes and closing an unfulfilled partially received order are not implemented.

The browser test harness now chooses an available loopback frontend port to avoid Windows Hyper-V port exclusions. APP_ORIGIN is passed to Playwright and its API fixtures. The installed Docker endpoint remains localhost:8080 and application configuration is unchanged.

## Phase 12 upgrade

Back up as usual, rebuild the api, admin and migrate images and run Compose. Migration `202609170001_sync` adds the `SyncCheckpoint` table and the `sync.read` permission; it alters no existing table, so restore procedures are unchanged, though the new table is included in archives like any other. Runtime provisioning must be rerun so the runtime role receives INSERT and UPDATE but not DELETE or TRUNCATE on the checkpoint, which `node scripts/migrate.mjs` and the Compose migrate service both do.

Cloud delivery is disabled unless `SYNC_TARGET_URL` is set, which is the default. Leave it unset for a restaurant that does not replicate. With it set, the worker records an explicit transport-not-implemented failure, because no cloud endpoint is specified or certified for this system yet; that is reported as a failed sync rather than a healthy one. Delivery never blocks local operation either way.

After upgrading, verify that the header shows the restaurant server as connected, that stopping the api container changes it to unavailable while the page stays loaded, and that `GET /api/sync/status` lists seven streams for an owner and is refused for a cashier.

## Phase 11 upgrade

Back up as usual, rebuild the api, admin and migrate images and run Compose. Migration `202609160001_reporting` is data-only: it inserts the `report.read` permission and grants it to protected OWNER with an audit record, and creates or alters no table, column, index or trigger, so the schema, backup and restore procedures are unchanged and `prisma migrate diff` against the schema is empty. OWNER grants `report.read` to existing managers or accountants through Roles; nothing else is seeded. The dashboard is the **Dashboard** tab of the existing frontend behind the same Nginx route and CSP; CSV exports are served by the API as `text/csv` attachments through the same `/api` proxy. Verify after upgrade that an owner sees the Dashboard tab, that today's figures match the Payments and Companies screens, and that a CSV export downloads.

## Phase 10 upgrade

Phase 10 adds no migration and no schema change, so the database is untouched and backup/restore is unaffected. Rebuild the admin image and recreate the container; the waiter surface is served at `/waiter` by the same deployment, behind the same Nginx route and CSP. The policy gains explicit `worker-src` and `manifest-src` directives.

Install the PWA from a waiter device by opening `/waiter` and choosing the browser's install action. Service workers require a secure context: this works on loopback for evaluation, but a real LAN deployment must serve HTTPS with a certificate the devices trust, per the production profile above. Without TLS the surface still runs as a normal page; only installation and shell precaching are unavailable. Grant existing staff the WAITER role, or the five equivalent keys, through Roles.

## Phase 9 upgrade

Back up before applying `202609150001_companies`. Build matching api/admin/migrate images, stop the old API, run the migration service including restricted runtime provisioning, start API/admin and reload Nginx. Preserve the PostgreSQL volume and existing secrets.

The migration is transactional and additive: it creates the eight company tables, adds `COMPANY_ACCOUNT` to the PaymentMethod enum, adds nullable `companyId`/`companyEmployeeId` to Payment, and replaces the `payment_valid` constraint and the `guard_reversal_insert`/`check_payment_integrity` functions so they handle the new method explicitly. Existing cash and card payments are unaffected and no historical row is rewritten. Because the enum value is uncommitted inside the migration transaction, its predicates cast the enum to text; do not "simplify" those casts in a later edit.

**Stop the old API before migrating.** Once the constraint is replaced, an older API build that does not know the new method is still safe for cash and card, but the new company routes and the COMPANY_ACCOUNT tender require the matching build. Start API and admin from the same image set.

No companies, contracts, employees or balances are seeded. OWNER grants the seven Phase 9 permissions to existing staff through Roles; the migration grants and audits only protected OWNER. Before live use, create a company, agree and activate a contract with a real credit limit, authorize its employees, then verify on an isolated test database that a COMPANY_ACCOUNT collection settles the order, writes no cash movement, posts one charge, and is refused once the credit limit is reached. Verify a recorded account payment and a statement for a closed period. Supplier and company account settlement remain separate ledgers; neither touches a POS cash shift.
