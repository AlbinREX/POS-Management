# Restaurant platform architecture

Status: Phases 1-14: foundation, menu, layout, orders, kitchen preparation, payments and cash shifts, inventory, purchasing, company contracts, the waiter PWA read-only reporting with the owner dashboard, and local-first hardening with an outbound delivery checkpoint. Settlement is the only API path to PAID.

## Topology and ownership

Phase 2 catalog decisions, decimal contracts, selection rules and permission migration are documented in [ADR 0002](docs/adr/0002-branch-menu-catalog.md). The menu controller/service extend the existing API; no additional service or client app is introduced. Product imagery uses the existing `Product.imageUrl` field: it accepts an app-relative path such as `/food/riza-burger.webp` for photography bundled with the admin app, or an absolute http(s) URL for a catalogue hosted elsewhere on the restaurant network. Bundled assets are served by the app itself rather than hotlinked, so the POS grid does not depend on an external host. A product without a usable image falls back to a branded initial placeholder. See [product images](docs/PRODUCT_IMAGES.md).

Phase 3 layout, geometry/status invariants and durable change-event delivery are documented in [ADR 0003](docs/adr/0003-restaurant-layout.md). The floor plan is edited visually: draw a table by dragging on the grid, move it from its body and resize it from corner and side handles, with grid snapping and canvas clamping. Geometry and metadata form one draft that is persisted together by an explicit Save through the existing table endpoints, so pointer movement never writes and no second geometry model exists. Area/table writes atomically update the entity, AuditLog, LayoutRevision and immutable LayoutEvent. The map uses authenticated five-second change-feed polling and repeatable-read snapshots. A future WebSocket gateway can consume the same branch cursor/event contract; push delivery is not implemented in this phase.

The restaurant local server owns live operations. Next.js clients connect over the LAN to a NestJS modular monolith and a local PostgreSQL database. Internet loss must not interrupt local authentication or future order/payment workflows. Cloud services will consume explicit synchronization events; they will never be a dependency of a local transaction.

```text
apps/admin            Next.js foundation and menu administration, login
apps/pos              Reserved for the touchscreen POS
apps/kds              Reserved for kitchen display
apps/waiter           Reserved for mobile PWA
apps/owner-dashboard  Reserved boundary; the owner dashboard is served by apps/admin (Phase 11)
apps/api              NestJS REST application, later WebSocket adapters
packages/database     Prisma schema, migrations, client, bootstrap seed
packages/shared-types API contracts and permission vocabulary
packages/validation   Shared strict input schemas
packages/ui           Shared accessible UI primitives
packages/config       Shared TypeScript configuration
infrastructure/docker Dockerfiles and Compose
infrastructure/nginx  LAN reverse proxy and TLS configuration
scripts               Development, verification, backup and restore
docs/adr              Architectural decisions
```

Use npm workspaces and a committed lockfile, Node.js 24 LTS, Next.js/React/TypeScript, Tailwind and shadcn-compatible primitives, NestJS, Prisma 7 and PostgreSQL 17. npm avoids an additional package-manager bootstrap requirement. Independent app directories preserve separate deployment and permission surfaces. Only admin and API run in Phase 1; empty future apps have explicit scope notes instead of fake functionality.

## Initial database design

- Organization: business identity, slug, lifecycle timestamps.
- Branch: organization-owned location, unique organization/code pair, timezone and currency.
- User: organization-owned identity, normalized email unique within organization, Argon2id password hash, active/deleted lifecycle.
- BranchMembership: explicit user access to a branch, constrained to one organization.
- Role: organization-specific configurable role; the seven requested names are bootstrap defaults, never authorization shortcuts.
- Permission: versioned application permission keys. The server defines actions; role mappings are configurable.
- RolePermission: role-to-permission assignments.
- UserBranchRole: role assignment to a membership, constrained to the same organization.
- Terminal: branch-scoped registered device, type, active state, last seen and timestamps. Registration is not proof of hardware identity.
- AuthSession: revocable branch-bound session, optional terminal, absolute expiry.
- RefreshToken: opaque random secret stored only as SHA-256 hash, rotation chain through session, one-use consumption and expiry; replay revokes the entire session.
- AuditLog: append-only event, organization/branch/actor/session context where available, safe before/after snapshots, database timestamp. PostgreSQL triggers reject UPDATE, DELETE and TRUNCATE.

UUID identifiers are generated independently of the cloud. Composite foreign keys enforce organization and branch relationships. All protected queries derive organization and branch from a verified session, never from request-body permission claims. Audit writes and corresponding sensitive mutations share a database transaction.

## Authentication and authorization

Short-lived JWT access tokens use explicit issuer, audience and algorithm. Access tokens remain in browser memory. Opaque refresh tokens use HttpOnly, SameSite=Strict cookies and rotate atomically; the database stores hashes only. Sessions are checked on every protected request so logout, disabling a user/branch/terminal or changing permissions takes effect without waiting for token expiry. Cookie-bearing mutations require an exact allowlisted Origin to prevent CSRF; development allows loopback HTTP, production requires HTTPS. No public self-registration exists. Bootstrap identity and organization come from operator-supplied environment variables without seeded passwords in source control.

Global authorization defaults to deny. Each non-public handler must declare required permissions or explicitly declare authenticated-only access. OWNER is a configurable permission assignment, not an unconditional code bypass. Role management requires the caller to possess every permission they grant and protects the initial owner role against accidental lockout. Administrative changes are audited and branch role assignments require matching membership.

## Consistency rules for subsequent phases

- Money crosses API boundaries as validated decimal strings; PostgreSQL NUMERIC and decimal arithmetic are mandatory. No JavaScript floating-point money arithmetic. Currency rounding policies must be documented before payments.
- Orders snapshot product names/prices/taxes. Paid totals cannot be mutated. Payments/refunds and stock movements are append-oriented, with reversals referencing their source.
- Financial actions, inventory consumption, audit events and eventual outbox events commit in one transaction. Idempotency keys and unique source constraints prevent duplicate effects.
- Concurrent workflows use row locks or serializable transactions with bounded retries. Optimistic versions apply to mutable operational aggregates.
- Future realtime delivery uses a transactional outbox, per-branch authorization and event sequence/replay. WebSocket messages are notifications; clients refetch authoritative state after reconnect. No WebSocket business states are invented in Phase 1.
- Fiscal integration stays behind a provider interface. No fiscal number or Kosovo legal behavior is synthesized. Phase 14 delivers that interface for EnterNet / F-LINK; the transport itself awaits their specification.

## Risks and mitigations

| Risk                              | Design response / remaining work                                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Internet failure                  | Local assets, local database and local auth; test WAN isolation in Phase 12.                                                                                                   |
| LAN/server/power failure          | Cannot safely finalize independently on disconnected devices; explicit unavailable state, UPS, restore drills and future IndexedDB draft queue. Local-first is not serverless. |
| Financial concurrency or retries  | Transactional ledgers, idempotency and immutable finalized snapshots; verified for payments in Phase 6; inventory remains Phase 7.                                             |
| Inventory double consumption      | Unique source movements and same-transaction finalization; recipes and unit conversion require explicit decimal policy in Phase 7.                                             |
| Lost or duplicate realtime events | Durable outbox and replay cursors in later phases; clients reconcile from local authoritative reads.                                                                           |
| Future fiscal requirements        | Isolated provider contract and pending/succeeded/failed reconciliation states; no undocumented ATK API calls.                                                                  |
| Cross-branch exposure             | Composite constraints plus server session scope and adversarial integration tests.                                                                                             |
| Local machine compromise          | Least-privileged runtime database role, HTTPS, secret handling, encrypted offline backup; database owners can defeat application controls.                                     |
| Cloud conflict                    | One operational authority per branch; append-only replication and explicit conflict resolution, no last-write-wins financial merges.                                           |

## Verification boundary

Phase 1 must pass lint, type checks, unit tests, real PostgreSQL migration/integration tests, API HTTP tests, frontend build and login browser tests. Docker configuration and service health must be verified where a Docker engine is available. Missing infrastructure is reported explicitly rather than treated as a pass. No commercial readiness or certified fiscal compliance is claimed by this foundation.

## Reference decisions

Implementation follows official [NestJS authentication](https://docs.nestjs.com/security/authentication), [Next.js installation](https://nextjs.org/docs/app/getting-started/installation), and [Prisma generator configuration](https://www.prisma.io/docs/orm/v7/reference/prisma-schema-reference). Dependency versions are resolved to stable releases and pinned in the lockfile; release candidates are excluded.

# Phase 4 orders

Orders extend the local modular monolith with atomic table occupancy, decimal-safe snapshots, permission-gated discounts/cancellation, optimistic versions and a durable branch revision feed. See [ADR 0004](docs/adr/0004-orders.md) for lifecycle, rounding and idempotency decisions. Kitchen execution and payments remain outside this phase.

## Phase 5 kitchen

Kitchen submission, station tickets and durable preparation events extend the same transactional boundary. The dedicated `/kds` route shares the existing frontend deployment and authentication. [ADR 0005](docs/adr/0005-kitchen.md) defines snapshot routing, cancellation, immutable content, printer contracts and the Phase 5 lifecycle. Kitchen completion after settlement preserves PAID and does not update the immutable order.

## Phase 6 payments

[ADR 0006](docs/adr/0006-payments.md) defines append-only Payment/PaymentReversal ledgers, deterministic item-unit allocations, immutable bills/settlements, cash shifts and transactional event receipts. Serialized branch revision rows and optimistic order/shift versions protect concurrent commands. Database constraints verify settlement, cash reconciliation and immutable source records. The existing frontend adds Payments; no new service or Internet dependency is required. Card entries confirm external terminal operations, with provider reconciliation deferred until a specified integration exists.

## Phase 7 inventory

[ADR 0007](docs/adr/0007-inventory.md) defines exact-unit quantities, append-only stock history, immutable recipe versions and inventory plans frozen with bills. Final settlement consumes stock atomically with PAID. The existing local API and Riza frontend host inventory; no additional service or Internet dependency is introduced.

## Phase 8 purchasing

Supplier, purchase-order and receiving modules extend the existing local API and frontend. Receipt stock and supplier charges are atomic and source-linked; see [ADR 0008](docs/adr/0008-purchasing.md). Existing sales/payment/stock ledgers remain authoritative.

## Phase 14 EnterNet / F-LINK fiscal handoff

FastFood Riza does not perform Kosovo fiscalization. EnterNet operates the fiscal device and F-LINK software and remains responsible for ATK rules, fiscal signing, certificates, fiscal numbering and device protocol. This phase adds only the integration boundary: a deterministic sale payload built from immutable settlement and order snapshots, a `FiscalProvider` abstraction, and a `FiscalHandoff` table tracking delivery state per settlement with an idempotent correlation key. Delivery is strictly downstream of settlement and runs outside any business transaction, so a provider failure can never revert a PAID order. The F-LINK transport is not implemented, because its protocol has not been supplied; the configured adapter never claims success, leaving undelivered sales visible. See [ADR 0014](docs/adr/0014-enternet-flink-integration.md).

## Phase 13 production, security and backup hardening

Runtime images carry only compiled output and production dependencies; source, tests and documentation are absent, and the migration image is separate. A production API fails fast on placeholder or weak configuration rather than serving. The backup script reports its own health to a status file, and a read-only `GET /api/ops/status` behind `ops.read` surfaces database reachability, backup age, Phase 12 delivery backlog and disk headroom, with the aggregate severity equal to the worst signal. No business module was redesigned and no Phase 1-12 guarantee was weakened. See [ADR 0013](docs/adr/0013-production-security-hardening.md).

## Phase 12 local-first hardening and synchronization

The seven per-module event logs written since Phase 3 are already a transactional outbox: each row commits with its business change. Phase 12 adds only `SyncCheckpoint`, a per-branch, per-stream record of how far an optional cloud consumer has confirmed delivery, plus a `sync.read` status endpoint and a compact header indicator. The delivery worker runs on its own timer outside every request and business transaction, is inert unless `SYNC_TARGET_URL` is configured, and is outbound only: nothing received from a cloud target is applied locally, so destructive cloud-to-local overwrite is impossible by construction. Delivered cursors move forward only, and a cursor ahead of local history reports an empty backlog rather than reprocessing. The client distinguishes local server connected, local server unavailable, internet unavailable and the delivery health as separate states. No command is queued offline: replay safety depends on server-side credit, stock, shift and drawer constraints that a partitioned device cannot evaluate. See [ADR 0012](docs/adr/0012-offline-local-first-sync.md).

## Phase 11 reporting and owner dashboard

Reporting is a read-only module of the same local API under `/api/reports`, behind one new `report.read` permission, with the dashboard rendered as a tab of the existing Riza frontend. It adds no table and no business rule: sales, orders, products, staff, cash, stock, purchasing and company figures are derived on request from the immutable settlement, payment, cash-movement, stock-movement, ledger and statement rows in `RepeatableRead` snapshots, with exact decimal arithmetic and branch-local day boundaries resolved from `Branch.timezone`. Sales are recognized at settlement time, refunds appear separately on the day recorded, product revenue comes from frozen line snapshots rather than current prices, and balances are the same ledger sums the operational modules enforce. CSV export is the first non-JSON response in the API and serializes the identical figures. The only migration is data-only. See [ADR 0011](docs/adr/0011-reporting-owner-dashboard.md).

## Phase 10 waiter PWA

The installable waiter surface is a route of the existing Next.js deployment at `/waiter`, mirroring the Phase 5 `/kds` precedent. It adds no table, migration, permission key or business rule: table service, mobile ordering, kitchen submission and payment handoff all run through the existing order, layout, menu and kitchen APIs with their established command, audit, event and idempotency guarantees. The service worker precaches the application shell only and never caches `/api` responses, so no authenticated branch-scoped data is stored on a shared device. This is installability, not offline ordering; a disconnected device reports an explicit failure rather than queueing writes. See [ADR 0010](docs/adr/0010-waiter-pwa.md).

## Phase 9 company contracts

Companies, contracts, authorized employees, an append-only account ledger and immutable statements extend the same local API and Riza frontend. COMPANY_ACCOUNT is a third payment method: it settles an order through the existing settlement path, writes no cash movement, and posts the company charge in the same Serializable transaction as the payment, settlement, inventory consumption, audit and events. Balances are ledger sums, never stored columns; credit limits are enforced in the service and backstopped by a deferred database trigger. See [ADR 0009](docs/adr/0009-company-contracts.md). No fiscalization is introduced.
