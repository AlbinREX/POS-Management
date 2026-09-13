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
