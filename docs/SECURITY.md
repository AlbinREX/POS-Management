# Phase 14 fiscal handoff boundary

FastFood Riza does not perform Kosovo fiscalization; EnterNet operates the fiscal device and F-LINK software. The integration surface is deliberately minimal: two permissions, `fiscal.read` for visibility and `fiscal.retry` for the operator action, neither of which grants business authority and neither implied by any business permission.

Provider configuration comes from the environment only. No credential or endpoint is stored in the database, accepted from a request, exposed to the frontend, or written to a log or audit record. No fiscal identifier is accepted from a client: the retry schema is strict, and a provider reference is stored only as an adapter reports it. Delivery runs outside every business transaction, so a provider failure cannot revert a PAID order or alter any financial record. Handoff rows are branch-scoped by composite foreign key, and the runtime role may advance them but never delete or truncate them.

Not claimed: ATK compliance, fiscal certification, fiscal signing, device attestation or any F-LINK transport security property, since that transport is not implemented.

# Phase 13 production hardening

Runtime images contain only compiled output and production dependencies. Source, tests, documentation and scripts are absent from the API and admin images, and the migration image is separate, carrying the Prisma CLI and the two scripts it runs. Four packages remain because upstream declares them as production dependencies: `playwright` and `@playwright/test` via `next`, and `prisma` and `typescript` via `@prisma/client`. Removing them by hand would risk breaking Next.js or Prisma at runtime, so they are documented rather than stripped.

A production API fails at startup on placeholder or weak configuration: a placeholder or sub-24-character database password, a placeholder or low-entropy JWT secret, or a loopback production origin. Development and test are deliberately unaffected. The seed already refused placeholders at bootstrap; this closes the same gap at every API start.

The backup script reports its own health to `backups/backup-status.json` on success and failure, deletes partial archives on failure and exits non-zero. `GET /api/ops/status`, behind the new `ops.read` permission, reports database reachability, backup age and outcome, Phase 12 delivery backlog and filesystem headroom, with the aggregate severity equal to the worst individual signal. The endpoint is read-only, writes nothing, mounts the backup directory read-only, and returns no credential, connection string, driver error or business record. `ops.read` grants no business authority and no business permission implies it.

Reviewed and unchanged because they were already sound: append-only audit triggers, refresh-token rotation with family revocation on reuse, HttpOnly/SameSite=Strict/Secure cookies, exact Origin checks with CORS closed, runtime database grants that cannot migrate schema or mutate audit, financial or event history, rate limits on API/login/refresh/password, an internal backend network with no published database or API port, and a dependency scan reporting zero vulnerabilities.

Not claimed: nonce-based CSP, multi-factor authentication, account lockout, off-host tamper-evident audit, backup encryption or offsite replication, container read-only roots and resource limits, penetration testing and fiscal certification.

# Phase 1 security boundary

Passwords use Argon2id (64 MiB, 3 iterations, parallelism 1). Initial passwords require 12–128 characters. Password changes verify the current secret, atomically compare the previous hash, revoke all user sessions and write a safe audit event. Admin password-recovery tooling and compulsory first-login password rotation remain future hardening work.

JWTs use HS256 with an explicit issuer/audience and five-minute expiry. Refresh tokens are 32 cryptographically random bytes, hash-only at rest, rotated with a database compare-and-set. Replay revokes the session family and writes an audit event. Absolute session lifetime is twelve hours. Access tokens remain in browser memory and are never written to localStorage/IndexedDB. Refresh cookies are HttpOnly, SameSite=Strict, path-limited and Secure on HTTPS.

Global guards deny undeclared handlers. All administration queries scope by verified branch/organization; relational composite keys add a second barrier against bad writes. Current branch reads are not an all-branch owner dashboard. Session status and grants are reloaded on every request. Runtime database credentials cannot migrate schema or mutate audit history.

Exact Origin checks protect every state-changing request against CSRF, including login/logout/refresh. CORS is not opened. A single trusted Nginx proxy supplies client IPs in Docker. Direct deployment must leave `TRUST_PROXY=0` unless the API is unreachable except through the trusted proxy.

Helmet and frontend headers protect framing, MIME handling, referrer and browser capabilities. The Next.js CSP permits inline scripts/styles required by its current rendering configuration; a nonce-based stricter CSP is remaining production hardening. Development additionally permits eval for tooling.

Rate limits are in-memory and per IP: 300 API requests/minute, 15 login attempts/minute, 30 refresh attempts/minute and 10 password changes/minute. They assume one local API process; scaling workers requires shared counters. Review limits against actual device/network topology; a compromised LAN device or distributed credential attack requires additional controls. Rate-limit persistence, account lockout policy, MFA and penetration testing are not claimed.

Logs contain request ID, method, status and safe error class, not bodies, URLs with queries, credentials, tokens or database errors. Audit snapshots are constructed from allowed fields. Failed login events intentionally omit unverified user/branch identity and are available to the operator in the database, not the branch audit UI. Audit data can include user/terminal IDs and IPs; retention/privacy controls need operator policy.

Database administrators, filesystem owners, compromised OS accounts and stolen runtime database credentials are privileged threats. Immutable audit triggers do not provide off-host cryptographic tamper evidence. Use disk encryption, controlled operator access, trusted TLS, secret rotation and externally retained backups. There is no claim of Kosovo fiscal certification, card-processing compliance or completed production security review.

Dependency overrides pin patched `multer`, `mysql2` and `deepmerge-ts` releases because the resolved upstream dependency ranges included advisories. No file-upload/MySQL integration is implemented. Keep the overrides until upstream dependencies safely resolve patched versions, and rerun migration/build/tests when changing them. Npm audit covers package advisories, not a complete application/container security assessment.

# Phase 4 additions

Orders reuse database-resolved branch permissions, strict validation and same-origin mutation controls. Discounts, cancellation and assignment add separate permission checks. Financial snapshots and events are allowlisted; audit/events commit atomically with order/table changes. No card credentials, payment processing, KDS dispatch or fiscal numbers are introduced. The pending-command receipt in browser sessionStorage contains business IDs/notes only, scoped to the signed-in identity; it is not a token store. It persists across reloads, so protect shared device profiles and do not assume closing a browser confirms or cancels a server command.

## Phase 5 kitchen

Kitchen roles receive no financial order or administration access. Ticket details, printer contracts and history are money-free allowlisted snapshots; branch membership/session and permissions are rechecked on every request. Order submission requires separate order.submit_kitchen permission. Ticket cancellation uses the protected order cancellation path and commits with all related histories. Submitted order contents cannot be reopened or silently edited. Printer contracts are structured data only: future printer adapters must sanitize control bytes and authorize physical devices. No printer network connection or secret-bearing transport is introduced.

## Phase 6 financial boundary

Payment and cash APIs use the existing verified-session RBAC, strict validation, CSRF/origin rules, log redaction and rate limits. Cash shift ownership is server-derived from the session; terminal IDs are checked against active branch POS registrations and any session terminal binding. External card reference text is limited and obvious bare card numbers are rejected; no PAN/CVV fields or gateway credentials exist. Staff must not place sensitive card data in references or notes.

Serializable transactions, immutable command receipts, constrained unit allocation, capped reversals and deferred settlement/cash integrity checks protect financial writes. Paid orders stay immutable, including after refunds; cash close is final. Database-owner/superuser access can bypass controls by altering the schema, so production migration credentials must remain isolated. Full external terminal reconciliation, hardware attestation, TLS rollout and fiscal certification remain separate deployment work.
