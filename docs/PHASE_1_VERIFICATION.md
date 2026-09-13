# Phase 1 verification

**Result: PASS for every requested deployment check on 2026-09-11. Phase 2 remains untouched.**

This replaces the Docker-blocked status from 2026-09-10. No application features, schema changes, dependency updates or deployment-code fixes were needed. The existing Dockerfile, Compose files, migrations, seed, backup and restore scripts were exercised as written. Only this source verification report was intentionally changed; temporary probes and evidence are ignored local files.

## Environment and final state

- Host: Windows PowerShell, Node.js 24.19.0, npm 11.17.0.
- Docker Engine 29.7.2; Compose v5.5.1; Linux containers.
- Containers: Node.js 24.21.0, PostgreSQL 17.10, Nginx 1.28.3.
- Project: `restaurant-local`; persistent volume: `restaurant-local_postgres_data`.
- The stack is left running at **http://localhost:8080**, with verification data. Only Nginx is published, on loopback. PostgreSQL/API/admin have no published host ports.
- Ignored `.env` holds random credentials for organization `deployment-verification`, branch `main`. These are test fixtures, not live business configuration. Credentials were neither printed nor committed.
- PostgreSQL/API/admin report healthy; Nginx serves successful requests; migration service exits 0. API/admin run as UID/GID 1000 (`node`). Nginx has no configured Docker healthcheck; its readiness was verified through HTTP and `nginx -t`.

## Deployment PASS/FAIL

| Check                     | Result   | Evidence                                                                                                                                                                                                                                                                                 |
| ------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dockerfile validation     | **PASS** | `docker compose ... build --check` checked migrate/api/admin targets without warnings; all targets subsequently built.                                                                                                                                                                   |
| Compose validation        | **PASS** | `config --quiet` passed for base, base + production, and temporary loopback TLS verification configurations.                                                                                                                                                                             |
| Build/start full stack    | **PASS** | `up -d --build` built application images, pulled PostgreSQL/Nginx, created the volume and started services in dependency order.                                                                                                                                                          |
| PostgreSQL                | **PASS** | Version/readiness, migrations, seed, restricted runtime access, persistence and restore tested against the container database.                                                                                                                                                           |
| API                       | **PASS** | Both health endpoints return 200 through Nginx; authenticated mutation/read/audit/logout workflow passed.                                                                                                                                                                                |
| Frontend                  | **PASS** | Production Next.js page/assets served through Nginx. Desktop/mobile browser login, terminal read, session restoration and logout passed.                                                                                                                                                 |
| Nginx                     | **PASS** | `nginx -t` passed for HTTP and production TLS; frontend/API proxying worked.                                                                                                                                                                                                             |
| Production HTTPS          | **PASS** | Production override exercised with a temporary localhost certificate. Node explicitly trusted that test CA using `NODE_EXTRA_CA_CERTS`, with hostname verification enabled. HTTPS authentication, HTTP 308 redirect, HSTS and Secure/HttpOnly/SameSite=Strict cookies passed.            |
| Migrations                | **PASS** | Both migrations applied to the fresh Docker database; explicit rerun and stack restarts reported no pending migrations and exit 0.                                                                                                                                                       |
| Seed                      | **PASS** | Documented Docker bootstrap ran twice. One organization, branch and owner remained, with seven roles and nine permission definitions.                                                                                                                                                    |
| Authenticated workflow    | **PASS** | Login -> register POS terminal -> read terminal list -> verify `terminal.registered` audit -> logout -> old access token rejected with 401.                                                                                                                                              |
| Backup                    | **PASS** | Existing `backup.ps1 -RetentionDays 14` produced a custom-format dump, validated archive contents and wrote a SHA-256 sidecar.                                                                                                                                                           |
| Restore                   | **PASS** | Existing `restore.ps1` verified the checksum and restored into separate database `restaurant_restore_phase1`; source database was not overwritten.                                                                                                                                       |
| Restored data/permissions | **PASS** | All **12 application tables** had identical row counts and deterministic content fingerprints before backup and after restore. Both migration records and both audit-protection triggers were present. After grant provisioning, runtime audit UPDATE and schema CREATE remained denied. |
| Restored API              | **PASS** | An isolated API authenticated against the restored database, read the source terminal and logged out. Temporary API container was then stopped and removed.                                                                                                                              |
| Restart/recovery          | **PASS** | `down` without volume removal, then `up -d --wait --wait-timeout 120`, recreated the full stack. All 12 tables retained identical counts/fingerprints. Login, persisted terminal, audit and logout checks passed again.                                                                  |
| Container logs            | **PASS** | PostgreSQL, migrate, API, admin and Nginx logs reviewed before restart, during TLS checks and after final recovery. No unexpected error/fatal entries or configured secrets found. Known deprecation warning noted below.                                                                |

The test HTTPS overlay was subsequently removed from the active deployment by starting the base Compose configuration again. The final endpoint is loopback HTTP on port 8080. No test certificate was installed into the host trust store or distributed to LAN devices.

## Required final reruns

| Check                   | Result                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `npm.cmd run lint`      | **PASS** — no errors/warnings.                                                                                                  |
| `npm.cmd run typecheck` | **PASS** — shared packages, API, UI and Next.js.                                                                                |
| `npm.cmd test`          | **PASS** — 13 unit tests.                                                                                                       |
| `npm.cmd run test:e2e`  | **PASS** — production build, real PostgreSQL migration/seed checks, 28 integration checks and 2 desktop/mobile Chromium tests.  |
| Production build        | **PASS** — Prisma generation, shared/API compilation and optimized Next.js build/prerender; also passed inside Docker.          |
| Docker dependency audit | **PASS** — image installation/pruning reported zero npm vulnerabilities. This is an advisory check, not security certification. |

The integration suite covers authentication, CSRF, invalid/oversized input, JWT expiry/tampering/algorithm, transaction rollback, permissions, protected owner access, organization/branch isolation, terminals, refresh concurrency/replay, audit immutability, runtime grants, password changes, logout and rate limits. Its separate PostgreSQL database did not modify the Docker verification database.

## Browser evidence

Browser plugin was unavailable; the installed Playwright was used. Docker checks ran through `http://localhost:8080` at 1280x720 and 390x844. Both showed the correct page title and meaningful content, no framework overlay, no page JavaScript errors and no document-level horizontal overflow. Admin tables scroll within their mobile container.

Flow: sign in -> view the API-created terminal -> reload and restore session -> sign out. Screenshots: `.local/docker-1280.png` and `.local/docker-390.png`. The existing two E2E tests were independently rerun against the production Next.js build and also passed.

## Backup and recovery evidence

- Archive: `backups/restaurant-20260911T173554Z.dump`, 42,606 bytes, with SHA-256 sidecar.
- At backup: one organization, branch, user, membership, terminal and user-role assignment; seven roles, nine permissions, 23 role-permission mappings, eight audit events, three sessions and five refresh-token records.
- Comparison covered complete row content, not counts alone, across all 12 application tables.
- Original database `restaurant` remained active. Restored database `restaurant_restore_phase1` remains available for inspection; restored-API verification added its own audited login/logout afterward.
- Local evidence is retained under ignored `.local/`: HTTP/browser/database probes, before/after fingerprints, `docker-before-restart.log`, `docker-tls.log` and `docker-final.log`.

## Reproduction commands

Run from the repository root. `.env` is private; `config --quiet` avoids dumping secrets.

```powershell
docker compose --env-file .env -f infrastructure/docker/compose.yml config --quiet
docker compose --env-file .env -f infrastructure/docker/compose.yml -f infrastructure/docker/compose.production.yml config --quiet
docker compose --env-file .env -f infrastructure/docker/compose.yml build --check
docker compose --env-file .env -f infrastructure/docker/compose.yml up -d --build
docker compose --env-file .env -f infrastructure/docker/compose.yml run --rm --env-from-file .env migrate node scripts/docker-seed.mjs
docker compose --env-file .env -f infrastructure/docker/compose.yml run --rm migrate node scripts/migrate.mjs
docker compose --env-file .env -f infrastructure/docker/compose.yml exec -T nginx nginx -t
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/backup.ps1 -RetentionDays 14
# Use the actual archive name and a NEW restore database for future drills.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/restore.ps1 -BackupName restaurant-20260911T173554Z.dump -NewDatabase restaurant_restore_next_drill
docker compose --env-file .env -f infrastructure/docker/compose.yml down
docker compose --env-file .env -f infrastructure/docker/compose.yml up -d --wait --wait-timeout 120
docker compose --env-file .env -f infrastructure/docker/compose.yml ps -a
docker compose --env-file .env -f infrastructure/docker/compose.yml logs --no-color
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:e2e
```

## Warnings and remaining limits

- Missing Docker is resolved. One early Nginx probe ran before initial dependency startup completed; rerunning after Compose completion passed. No code fix was required.
- The existing Prisma/node-postgres concurrent-query deprecation warning remains. All checks pass on pinned pg major version 8; review upstream compatibility before pg 9. The warning was not suppressed.
- Vitest emits a future native-config-loader warning; browser workers emit NO_COLOR/FORCE_COLOR warnings. Build output contains normal noninteractive installation notices. These did not prevent operation.
- The deliberate post-logout 401 proves token revocation and is not an unexpected service error.
- Scheduled/unattended backup execution, deletion of aged archives, encrypted/off-device copies, power-loss/WAN-loss and load/soak drills were not executed in this pass. The restore drill does not establish a recovery SLA or financial reconciliation; Phase 1 has no financial tables.
- HTTPS used a temporary one-day test certificate, not a restaurant's LAN certificate or renewal process. Test certificates remain ignored under `.local/tls/` and are inactive. Browser coverage is Chromium only; GitHub Actions did not run remotely.
- Production concerns in `SECURITY.md` still apply. This verification is not fiscal certification or approval to operate a live restaurant.

All requested deployment-verification checks are complete. **Do not start Phase 2 without a separate instruction.**
