# Restaurant platform architecture

Status: Phases 1-6: foundation, menu, layout, orders, kitchen preparation, payments and cash shifts. Settlement is the only API path to PAID.

## Topology and ownership

Phase 2 catalog decisions, decimal contracts, selection rules and permission migration are documented in [ADR 0002](docs/adr/0002-branch-menu-catalog.md). The menu controller/service extend the existing API; no additional service or client app is introduced.

Phase 3 layout, geometry/status invariants and durable change-event delivery are documented in [ADR 0003](docs/adr/0003-restaurant-layout.md). Area/table writes atomically update the entity, AuditLog, LayoutRevision and immutable LayoutEvent. The map uses authenticated five-second change-feed polling and repeatable-read snapshots. A future WebSocket gateway can consume the same branch cursor/event contract; push delivery is not implemented in this phase.

The restaurant local server owns live operations. Next.js clients connect over the LAN to a NestJS modular monolith and a local PostgreSQL database. Internet loss must not interrupt local authentication or future order/payment workflows. Cloud services will consume explicit synchronization events; they will never be a dependency of a local transaction.

```text
apps/admin            Next.js foundation and menu administration, login
apps/pos              Reserved for the touchscreen POS
apps/kds              Reserved for kitchen display
apps/waiter           Reserved for mobile PWA
apps/owner-dashboard  Reserved for owner reporting
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
- Fiscal integration stays behind a provider interface. No fiscal number or Kosovo legal behavior is synthesized. Phase 14 requires official specifications and certified integration.

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
