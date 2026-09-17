# ADR 0013: production, security and backup hardening

Phase 13 makes the system deployable, recoverable and observable without redesigning any business module. It adds no business rule, no financial behaviour and no change to the Phase 1-12 guarantees. The single schema-affecting change is a data-only migration that registers one permission.

## Runtime images carry only what they run

The runtime stages previously derived from the build stage, so the shipped API and admin images contained the entire workspace: `tests/`, `docs/`, `scripts/`, `infrastructure/`, every TypeScript source file and a `node_modules` tree that had been pruned in place. Pruning after the fact leaves binaries and transitive files behind, so the images carried development tooling that has no business on a restaurant server.

The build now resolves production dependencies in a separate `deps` stage with a fresh `npm ci --omit=dev`, and each runtime stage copies only the built output it needs: compiled JavaScript, the generated Prisma client, package manifests, and for the admin image the Next.js build and public assets. Source, tests and documentation are absent. The migration image is separate again, carrying the Prisma CLI, the migration SQL and the two scripts it runs, because it executes once with owner credentials and exits.

Four packages remain present that look like tooling: `playwright` and `@playwright/test` arrive as production dependencies of `next`, and `prisma` and `typescript` as production dependencies of `@prisma/client`. They are upstream declarations, not this repository's choice, and removing them by hand would risk breaking Next.js or Prisma at runtime. This is recorded as a limitation rather than papered over.

## Production refuses to start on placeholder configuration

The seed already refused placeholders at bootstrap, but the API would start with any syntactically valid configuration. A production deployment now fails fast, before serving a request, when the database password is a placeholder, shorter than 24 characters or absent, when the JWT secret is a placeholder or low-entropy despite meeting the length rule, or when the production origin is loopback. Development and test are deliberately untouched, because local work must keep running on loopback HTTP with simple secrets.

Failing at startup is the right trade. A half-configured restaurant server that appears to work is more dangerous than one that refuses to boot with a precise message.

## Backups report their own health

The backup script produced a good archive and a checksum but told no one when it stopped working, which is the failure mode that matters: silent absence of protection. It now writes `backup-status.json` beside the archives on both success and failure, recording the attempt time, the last successful time, the archive name, its size and checksum, and any error text. A failure deletes partial archives, writes the failure record while preserving the previous success timestamp, and exits non-zero so a scheduled task reports it. No credential or connection string is ever written or logged.

## Operational status is a first-class, read-only view

`GET /api/ops/status`, behind a new `ops.read` permission, reports four signals: database reachability with latency, backup age and outcome, Phase 12 delivery backlog, and filesystem headroom. The aggregate severity is the worst individual signal, never an average, so one failure cannot be hidden by three healthy checks.

Two classification decisions are deliberate. A backup is critical when the last attempt failed even if a recent archive exists, because protection has stopped advancing; and never having produced an archive is also critical rather than unknown. Cloud delivery, by contrast, never rises above a warning: it is optional, it never gates local operation, and treating it as critical would train operators to ignore the severity field entirely.

The API mounts the backup directory read-only. It can report on archives; it cannot create, alter or delete one.

## What was reviewed and found already sound

Audit history is append-only through database triggers that reject update, delete and truncate. Refresh tokens are random, stored hashed, rotated with a compare-and-set, and reuse revokes the session family. Cookies are HttpOnly, SameSite=Strict and Secure on HTTPS. Every state-changing request requires an exact Origin match; CORS is not opened. The runtime database role cannot migrate schema or mutate audit, financial or event history. Rate limits cover the API, login, refresh and password change. The backend Docker network is internal, no database port is published, and only Nginx is exposed. The dependency scan reports zero vulnerabilities. None of this needed changing, and the phase did not manufacture work to appear thorough.

## Out of scope

Nonce-based CSP, multi-factor authentication, account lockout policy, off-host tamper-evident audit, backup encryption and offsite replication, container read-only roots and resource limits, penetration testing, and fiscal certification. Each is named in the verification document rather than implied to be complete.
