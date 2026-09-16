# Local-first and future synchronization

## Phase 12 local-first hardening and outbound delivery

### What works without the public internet

Authentication, orders, kitchen routing, payments, cash shifts, inventory, purchasing, company accounts and reporting are served entirely by the local NestJS server and its PostgreSQL database on the restaurant LAN. No remote font, CDN, cloud authentication or external API is on any operational path. Losing the public internet therefore does not interrupt service, and the header reports it as an informational state rather than a fault.

Losing the local server is different and is treated as such: writes pause with an explicit message, no action is synthesized as successful, and the existing per-workspace retry receipt remains the recovery path for a command whose outcome is unknown.

### What is deliberately not implemented

There is no offline ordering and no client write queue. This is a safety decision, not an omission of effort. Replay safety in this system is enforced by the server: a command id, request hash and actor binding are checked against durable event rows, and credit limits, stock availability, shift ownership and cash drawer state are validated by the authoritative database at commit time. A queued write would have been validated against state the device could not see, so a company charge could exceed a credit limit approved elsewhere, a settlement could land against an order another terminal already paid, and a cash movement could reference a shift that has since been counted and closed. No client-side queue can make those safe.

The accurate claim is therefore: the restaurant operates without the internet, and it does not operate without its local server.

### Four operator-facing states

| State                                                  | Meaning                                                        | Effect on operation              |
| ------------------------------------------------------ | -------------------------------------------------------------- | -------------------------------- |
| Restaurant server connected                            | The local API answered an authenticated read                   | Normal                           |
| Restaurant server unavailable                          | A request never reached the server                             | Writes pause; no action is faked |
| No internet                                            | The browser reports no WAN link while the local server answers | None; informational              |
| Cloud sync healthy / pending / failed / not configured | Outbound delivery state                                        | None; never gates local work     |

Local reachability is decided by whether a request reached the server at all. A rejected request carrying an HTTP status proves the server answered, so the link is healthy even when the call failed. `navigator.onLine` reports link-layer state and can claim connectivity behind a captive portal, so it is used only to report internet loss, never to decide whether local operation may proceed.

### The outbox is the existing event logs

`LayoutEvent`, `OrderEvent`, `KitchenEvent`, `PaymentEvent`, `InventoryEvent`, `PurchasingEvent` and `CompaniesEvent` are each written in the same transaction as their business change and carry a branch-scoped monotonic revision, the command id, a canonical request hash, the actor and the persisted response. Phase 12 adds no second log, because duplicating financial history into a generic outbox would create a copy that can drift from the original.

`SyncCheckpoint` adds one row per branch and stream recording the delivered cursor, the last attempt and delivery times, the last error and a failure count. It holds no business data and is never a source of truth.

### Delivery rules

Delivery is outbound only: nothing received from a cloud target is applied to the local database in this phase, so destructive cloud-to-local overwrite is impossible by construction rather than by policy. A delivered cursor moves forward only, so a replayed or out-of-order acknowledgement is ignored instead of rewinding. A cursor found ahead of local history, which is what a restored backup looks like, reports an empty backlog rather than a negative one and never triggers reprocessing.

The worker runs on its own timer outside every request and business transaction, so a slow or unreachable endpoint cannot delay a local order or payment. It is inert unless `SYNC_TARGET_URL` is configured. The transport itself is not implemented in this phase because no cloud endpoint is specified or certified for this system; with a target configured the worker records an explicit transport-not-implemented failure, which is reported as failed rather than healthy.

### Conflict rules

Immutable history is never merged. Orders, settlements, payments, reversals, cash movements, stock movements, supplier entries, company ledger entries, statements and event rows are append-only, enforced by database triggers and runtime grants, and are replicated as facts. Mutable configuration such as menu, layout, contracts and roles carries monotonic versions and is edited through expected-version commands; a conflicting change is refused for an operator to resolve and is never merged by timestamp. Derived values such as stock, supplier and company balances are sums of immutable rows and are recomputed rather than transferred.

### Restart and recovery

All delivery state lives in the checkpoint table, so a crash, restart or power loss resumes from the last confirmed cursor and re-delivers only records already committed locally. The worker refuses overlapping passes, backs off exponentially against a failing endpoint up to five minutes, and never holds a database transaction open across an outbound attempt. Restoring a backup restores checkpoints with it; if a restore rewinds local history behind a cursor, the backlog reads as zero and an operator resets the cursor deliberately.

### Waiter PWA cache boundary

The service worker precaches the application shell and icons only. Every `/api` request returns before any cache is consulted or written, so no authenticated branch-scoped response is stored on a shared device or replayed stale. This is installability, not offline ordering. See [ADR 0012](docs/adr/0012-offline-local-first-sync.md).

## Phase 3 layout events

Area/table commands atomically append immutable LayoutEvent records and increment LayoutRevision alongside their audits. Events are ordered per branch, resumable through `GET /api/layout/changes?after=<decimal-string-cursor>`, and contain invalidations rather than authoritative business snapshots. `GET /api/layout/areas/:id/map` supplies a coherent repeatable-read snapshot plus its cursor. The admin checks the feed every five seconds, reloads on changes, and visibly pauses editing when connection checks fail; no offline command is queued or silently acknowledged.

A future WebSocket adapter must authenticate every branch subscription, handle token expiry/revocation, resume/replay from durable cursors, deduplicate events and force a snapshot after a detected gap. It can read the same event log; no financial last-write-wins merge is implied. Events are retained in Phase 3, so there is no pruning gap yet. This phase verifies polling reconnect behavior only where documented, not actual WebSocket delivery or cloud synchronization. Menu/auth behavior remains local-server based as before.

## Implemented in Phase 1

Authentication, authorization, identity, terminals and audit use only the local NestJS/PostgreSQL server. Browser assets are locally built; there are no remote fonts, CDNs, cloud auth or AI calls in the running application. These choices remove public-internet dependencies from the foundation, but WAN isolation has not yet been formally tested on a restaurant deployment.

If the local API cannot be reached, the UI shows a connection failure. It does not synthesize a successful action. Local server/LAN failure is different from internet failure: Phase 1 has no offline write queue or service worker, and a client cannot continue without the local server.

## Planned authority model

```text
Future cloud: backups, owner analytics, organization configuration
                  ↑ accepted immutable events / explicit configuration commands
Restaurant local server: authoritative branch business state
                  ↓ authenticated REST and branch-scoped realtime events
POS / kitchen displays / waiter devices / manager devices on the LAN
```

All operational IDs use UUIDs. Future records include aggregate versions and origin/branch identity. Each synchronized event will have an event ID, branch, aggregate ID/type, sequence/version, timestamp, schema version and payload. An outbox row is inserted in the same PostgreSQL transaction as the business change. A retryable worker transports events; the receiver deduplicates by event ID and tracks branch cursors.

Financial events are immutable and append-only. Duplicate payment, consumption or receiving requests must be rejected/deduplicated by source operation keys. Cloud records must never overwrite local financial transactions using last-write-wins. Conflicting configuration commands require expected-version checks and operator resolution.

## Realtime plan

WebSockets arrive with table/kitchen functionality. Subscription authentication resolves the session and branch on the server, including revalidation on expiry/revocation. The client may not choose an arbitrary branch room. Events publish after transaction commit, with replay/backfill where required. Reconnect triggers authoritative REST reconciliation; an event is not proof of a successful financial mutation.

## Device offline plan

IndexedDB may retain explicitly marked drafts and a bounded command queue when justified. Drafts must carry command IDs and expected versions. UI must distinguish local draft, server-accepted and rejected states. A cached menu is not authorization to accept or finalize money independently. Device credentials must not be stored in IndexedDB/localStorage.

The waiter PWA requires trusted LAN HTTPS for service workers and secure cookies. DNS, certificates, local clock, Wi-Fi roaming, server reboot, power loss, outbox backlog and recovery are explicit Phase 12 acceptance tests. No cloud worker, conflict resolver, WebSocket business event or PWA cache is implemented in Phase 1.

# Phase 4 order delivery

Every successful order command has a branch-scoped UUID, canonical request hash, actor and persisted response in OrderEvent. Retries must reuse the exact command/body; differing content or actor conflicts. Versions detect conflicting edits, with no last-write-wins merge. Orders and table state changes publish their durable events in the same transaction as audit and totals. `/api/orders/changes` supports BIGINT string cursors; history supports the same pagination. A snapshot list includes its coherent branch revision.

The order workspace refreshes authoritative snapshots every five seconds and pauses editing when reads fail. Before sending, it records only the exact pending command in sessionStorage, scoped to user/organization/branch. On an ambiguous response it blocks subsequent writes and offers an explicit retry, including after page reload. It never silently queues offline operations and does not store credentials. SessionStorage receipts last only for the browser tab session: after closing the tab/browser, inspect authoritative orders/history before issuing a replacement command. Shared terminals must close/sign out sessions and protect browser profiles; pending notes can contain business data. HTTP loopback is suitable for machine-local verification; restaurant device access requires trusted LAN TLS deployment.

## Phase 5 kitchen delivery

Kitchen events use committed branch revisions represented as decimal strings. Submission/ticket/audit/order/layout changes are atomic. Ticket state commands carry UUIDs and expected versions; replay is actor/hash bound. Submission shares the order command namespace; ticket transitions use a kitchen namespace. `/api/kitchen/changes` supports replay, and board snapshots carry a coherent revision/server time. A future WebSocket adapter can deliver the same event metadata; no push gateway or cloud dependency is introduced.

KDS refreshes every five seconds and locks state changes on failure. An uncertain command is retained in sessionStorage until explicitly retried or definitively rejected; it survives tab reload, not browser closure. Elapsed times use the server clock offset. Station routing changes never rewrite existing tickets, and stations with historical tickets remain selectable. Physical print dispatch is deferred: original/cancellation document IDs provide stable deduplication keys, but adapters must implement persistence, device authorization, text/control-byte sanitization, delivery acknowledgements and explicit reprint semantics before claiming successful printing.

## Phase 6 payment events and retry receipts

PaymentEvent records branch-scoped increasing BIGINT revisions in the same serializable transaction as collections, reversals or shift changes. PaymentRevision is updated atomically; string cursors avoid JS integer precision loss. The order payment change feed excludes unrelated shift details. Shift history is read through the authorized drawer endpoints. These durable events prepare later WebSocket/sync delivery; current clients poll authoritative local reads.

The Payments workspace persists the exact command UUID/body in scoped sessionStorage before sending and retries it explicitly after an uncertain response, including after reload. Receipts never store authentication tokens. Do not charge the physical card again when retrying a local receipt. Clearing browser storage/tab closure can lose the retry receipt: reconcile order/shift history and the card terminal before any new collection. Device/LAN failure pauses financial actions; there is no disconnected autonomous checkout. External card-terminal approval and local recording are separate failure domains and require operator reconciliation until a certified provider adapter exists.

## Phase 7 inventory events and recovery

Inventory commands persist a UUID, request hash, actor, branch revision and response together with the movement/configuration change and audit. A repeated command with identical input replays its receipt; conflicting reuse is rejected. Exact decimal strings survive transport and storage. `GET /api/inventory/events?after=...` exposes a branch-scoped, string bigint cursor for a future realtime dispatcher. The current UI refreshes from the LAN API every ten seconds and preserves an uncertain command locally for explicit retry after reload; editing is blocked while a result remains uncertain.

There is no disconnected stock write queue or cloud reconciliation in this phase. Loss of public internet does not affect local stock operations; loss of the local API produces an explicit unavailable/stale state. Settlement, its frozen ingredient plan, stock movements and durable events commit atomically. Future synchronization must replicate those immutable source-linked records together, never merge financial or stock balances with last-write-wins. Movement sums are authoritative; stock display values are derived and may be rebuilt.

## Phase 8 purchasing synchronization boundary

PurchasingEvent provides branch string-bigint cursors, immutable command hashes/responses, actor, supplier and purchase references. Receipt posting appends purchasing and inventory events in the same transaction as stock and supplier entries. A receipt must replicate with its source purchase lines, stock movements and charge; derived supplier balances are never conflict-merged. Branch purchasing serialization is acquired before the inventory revision; inventory and sales operations do not acquire purchasing locks.

The responsive Purchasing screen refreshes from the local API every ten seconds and preserves uncertain command bodies in branch/user-scoped sessionStorage for explicit retry. Writes are disabled during stale reads or unresolved saves. This is local LAN operation with replay recovery, not an offline browser write queue or cloud synchronization. Public internet is unnecessary for core purchasing; opening external HTTPS supplier document references may require it. No document content is fetched by the API.

## Phase 10 waiter PWA boundary

The waiter service worker precaches the application shell and its icons so an installed device launches without a network round trip. Every `/api` request bypasses the cache entirely: authenticated, branch-scoped responses are never stored on a shared device and never replayed stale at order time. No write is queued offline. Losing the local server pauses ordering with an explicit connection failure, exactly as the desktop surfaces do, and the existing sessionStorage retry receipt remains the recovery path for an uncertain command. Offline ordering, background sync, push delivery and conflict resolution remain Phase 12. Service workers require a secure context, so an installed PWA on a LAN hostname needs the documented TLS deployment; plain HTTP registers a worker only on loopback.

## Phase 9 company account synchronization boundary

CompaniesEvent provides branch string-bigint cursors with immutable command hashes, responses, actor, company and contract references. A company charge appends its ledger entry, payment, settlement, inventory consumption, audit and events in one transaction, so replication must carry those records together; a derived balance is never conflict-merged, because the ledger rows are the authority and the balance is their sum.

Credit limits cannot be enforced across a partition. A disconnected terminal must not extend company credit on its own: the charge requires the local server, which holds the authoritative balance and the deferred credit constraint. The Companies workspace refreshes every ten seconds and keeps uncertain command bodies in branch/user-scoped sessionStorage for explicit retry after reload; replaying a collection returns the original receipt rather than charging the account again. Statements are immutable documents rather than recomputed views, so a synchronized statement remains reproducible even as later ledger entries arrive.
