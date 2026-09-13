# Phase 2 verification

Verified on 2026-09-11. **PASS: menu management only.** Tables, orders, KDS execution and payments were not started.

## Implemented

- Branch-owned categories, products, modifier groups, modifiers and configurable kitchen stations, plus product/group and product/station association tables.
- Strict validated REST create/detail/list/update/archive operations and a responsive Menu section in the existing Next.js administration application. Search, pagination, inactive states, explicit archive confirmation, product assignments and conflict messages are included.
- Exact decimal strings and PostgreSQL NUMERIC for selling prices, signed modifier adjustments and explicitly configured tax percentages/mode. No tax rate or fiscal rule is assumed.
- Backend menu.read/menu.manage permissions; server-derived branch scope and composite foreign keys; optimistic versions; serializable catalog transactions with immutable before/after audit snapshots. Catalog entities are never hard deleted by the runtime role.
- Audited permission migration for existing protected owners, preserving every other existing role's grants. Fresh role defaults are documented in PERMISSIONS.md. Seed creates no menu business entities.

## Checks and evidence

| Check                                      | Result | Evidence                                                                                                                                                                                                                                            |
| ------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prisma schema validation                   | PASS   | `npx.cmd prisma validate`.                                                                                                                                                                                                                          |
| New database migration and repeat          | PASS   | Isolated real PostgreSQL 17.10; all three migrations deployed, second deployment reports no pending changes. Seed runs twice.                                                                                                                       |
| Existing Phase 1 database upgrade          | PASS   | Docker `restaurant-local` database upgraded by `202609110001_menu`; migration service exited 0. Before/after role snapshots show only protected OWNER gains menu.read/menu.manage. One immutable role.permissions_migrated event records the grant. |
| Runtime grants and repeated migration/seed | PASS   | `scripts/migrate.mjs` re-provisions association grants; repeat reports no pending migrations. Docker seed remains idempotent. Audit immutability triggers remain enabled.                                                                           |
| Lint                                       | PASS   | `npm.cmd run lint`, zero warnings/errors.                                                                                                                                                                                                           |
| Typecheck                                  | PASS   | `npm.cmd run typecheck` after production build completed.                                                                                                                                                                                           |
| Unit tests                                 | PASS   | `npm.cmd test`: 31 tests across two files; 18 menu cases and 13 foundation cases.                                                                                                                                                                   |
| API/database integration                   | PASS   | 28 foundation checks plus 13 menu check groups, using restricted runtime credentials and real PostgreSQL.                                                                                                                                           |
| Production build                           | PASS   | `npm.cmd run build`: shared packages, API and optimized Next.js production output.                                                                                                                                                                  |
| Desktop/mobile E2E                         | PASS   | `node scripts/integration.mjs --browser` after the build: four Playwright tests, desktop 1280×720 and mobile Chromium/iPhone 13 emulation at 390×664.                                                                                               |
| Docker Compose and images                  | PASS   | Compose config validated; migrate/API/admin images built from the final application source.                                                                                                                                                         |
| Running deployment                         | PASS   | PostgreSQL/API/admin healthy, Nginx HTTP verified at http://localhost:8080; migration service exited 0. Nginx has no Docker healthcheck, so readiness was checked through HTTP.                                                                     |
| Authenticated deployed workflow            | PASS   | Through Nginx: owner login, all five menu creates, product price update, before/after audit, invalid image URL returns 400, dependency-safe archives. Fixtures remain archived for audit; no active test products remain.                           |
| Deployed browser smoke                     | PASS   | Desktop 1280×800 and mobile 390×844: sign in → Menu → archived product visible → sign out. No page errors, no console warnings/errors after login, and no horizontal document overflow.                                                             |
| Runtime logs                               | PASS   | API/admin/migration/Nginx logs checked after upgrade; no application error/fatal/panic/failed-request entries.                                                                                                                                      |
| Changed source formatting                  | PASS   | Prettier checks on menu API, UI, validation, shared types and tests.                                                                                                                                                                                |

Menu integration checks cover unauthenticated/forged-scope requests, all read-only write denials, live permission revocation, multi-station/group assignments, exact large decimals, uniqueness, same-organization and cross-organization branch isolation, composite FK rejection, required modifier availability, dependency archive protection, edits of every entity, historical audit values, simultaneous edits (one success, one 409), forced audit failure with complete price/link rollback, database CHECK constraints, denied runtime hard deletion, paginated search and retained archives.

The browser acceptance workflow creates all five catalog types, configures product associations and tax fields, changes the price, observes the audit event and archives entries in dependency order. Desktop/mobile screenshots were inspected: controls and labels are readable, the form wraps to one column on mobile, and no framework error overlay or clipping was observed. Browser plugin not available; the repository's Playwright workflow was used. Current deployment screenshots are saved outside the repository at `%TEMP%/restaurant-phase2-desktop.png` and `%TEMP%/restaurant-phase2-mobile.png`. Ignored test screenshots and logs remain under `.local/`.

## Issues found and resolved

- One initial typecheck overlapped with Next.js replacing generated `.next/types` files. It failed with missing generated files; rerunning after the build passed. This was a verification sequencing issue, not an application defect.
- URL validation initially used a URL constructor inside a refinement, which could throw for malformed text. It now uses a safe HTTP(S) check combined with URL validation; invalid text is covered by unit tests and returns HTTP 400 in the deployed API.
- Existing foundation tests asserted exactly nine permissions; they now use the shared permission vocabulary so Phase 2's two explicit keys are included.

Non-failing tool warnings remain: the existing Vitest configuration warns about future Vite native config loading; pg warns about concurrent query scheduling in the existing foundation authentication path; Playwright's environment reports NO_COLOR/FORCE_COLOR precedence. Docker progress on stderr is displayed by Windows PowerShell as NativeCommandError in captured output, while the Docker process exits 0. Actual service status and HTTP checks were verified independently. These warnings were not treated as application failures or silently suppressed.

## Deployment and limitations

The local stack is left running at http://localhost:8080. A pre-upgrade backup was saved as `backups/restaurant-20260911T180256Z.dump` with its checksum. The Phase 1 restore drill remains recorded in PHASE_1_VERIFICATION.md; no new Phase 2 restore drill is claimed here. This installation uses loopback HTTP test configuration; real LAN deployments still require the documented trusted HTTPS configuration.

No new dependencies or secrets were added. Database RLS, WAN-disconnection/load testing and commercial production readiness are not claimed. The local server remains required for writes. Cloud synchronization and business WebSocket events are not implemented. Product image references are stored URLs; uploads/previews and archive restoration are not included. Tax configuration is stored, not calculated or fiscalized. Recipes, order snapshots, kitchen tickets, table states, payments and inventory remain in their later phases.

Important files: `packages/database/prisma/schema.prisma`, `packages/database/prisma/migrations/202609110001_menu/migration.sql`, `apps/api/src/menu/`, `apps/admin/src/components/menu-catalog.tsx`, `packages/validation/src/index.ts`, `packages/shared-types/src/index.ts`, `scripts/provision-runtime.mjs`, `tests/unit/menu.test.ts`, `tests/integration/menu.mjs`, `tests/e2e/menu.spec.ts`, and `docs/adr/0002-branch-menu-catalog.md`. Existing architecture, API, database, deployment, permissions, README and roadmap documentation was updated.

The next phase is restaurant layout, only after separate user authorization. No Phase 3 implementation was added.
