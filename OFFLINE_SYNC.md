# Local-first and future synchronization

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


## Phase 9 company account synchronization boundary

CompaniesEvent provides branch string-bigint cursors with immutable command hashes, responses, actor, company and contract references. A company charge appends its ledger entry, payment, settlement, inventory consumption, audit and events in one transaction, so replication must carry those records together; a derived balance is never conflict-merged, because the ledger rows are the authority and the balance is their sum.

Credit limits cannot be enforced across a partition. A disconnected terminal must not extend company credit on its own: the charge requires the local server, which holds the authoritative balance and the deferred credit constraint. The Companies workspace refreshes every ten seconds and keeps uncertain command bodies in branch/user-scoped sessionStorage for explicit retry after reload; replaying a collection returns the original receipt rather than charging the account again. Statements are immutable documents rather than recomputed views, so a synchronized statement remains reproducible even as later ledger entries arrive.
