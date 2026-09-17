# ADR 0012: local-first hardening and outbound synchronization

Phase 12 hardens what the restaurant already does without the public internet, makes the four operational states legible, and adds a durable delivery checkpoint for an optional cloud consumer. It does not add offline ordering, and this document is explicit about that rather than leaving the boundary to interpretation.

## The outbox already exists

Phases 3 through 9 each committed a durable event row in the same transaction as its business change: `LayoutEvent`, `OrderEvent`, `KitchenEvent`, `PaymentEvent`, `InventoryEvent`, `PurchasingEvent` and `CompaniesEvent`. Each carries a branch-scoped monotonic revision, the originating command id, a canonical request hash, the actor and the persisted response. That is a transactional outbox in every respect that matters: a record cannot exist without its event, and an event cannot exist without its record.

Phase 12 therefore does not add a second log. Duplicating those rows into a generic outbox table would create a second copy of financial history that could drift from the first, and it would make the transactional guarantee weaker rather than stronger. What was missing is only a record of how far an external consumer has confirmed receipt, so the single new table is `SyncCheckpoint`: one row per branch and stream holding a delivered cursor, the last attempt and delivery times, the last error and a failure count. It holds no business data, and deleting every row in it would lose nothing except the knowledge of what had already been sent.

## Delivery can never block or overwrite local operation

The worker runs on its own timer outside every request and every business transaction. No local write waits on it, no local write consults it, and its failure path is a logged warning rather than a propagated error. It is inert unless an operator sets `SYNC_TARGET_URL`, which is the default deployment, so a restaurant that never wants cloud delivery carries no additional runtime cost beyond one table that stays empty.

Delivery is outbound only. Nothing received from a cloud target is applied to the local database in this phase, which makes destructive cloud-to-local overwrite impossible by construction rather than by policy. A delivered cursor moves forward only: an out-of-order or replayed acknowledgement is ignored rather than rewinding delivery, and a cursor found ahead of local history, which is what a restored backup looks like, reports an empty backlog instead of a negative one and never triggers reprocessing.

The transport itself is deliberately not implemented. No cloud endpoint is specified or certified for this system yet, so a worker that claimed successful delivery would either invent a protocol or mark records delivered that no consumer received. With a target configured, the worker records an explicit "transport not implemented" failure, which surfaces as `failed` rather than as healthy. That is an honest state, and it exercises the failure, backoff and reporting paths that a real transport will use.

## Four states, not one "offline"

Losing the public internet and losing the restaurant server are different events with different consequences, and collapsing them into a single offline indicator trains staff to ignore the one that matters. The client therefore distinguishes: the local server is connected; the local server is unavailable, which pauses writes; the internet is unavailable while the restaurant continues normally; and separately the delivery health, which is pending, healthy, failed or disabled.

Local reachability is derived from whether an authenticated read reaches the server at all. A rejected request that carries an HTTP status means the server answered, so the link is healthy even when the call failed; only a request that never completed indicates an unreachable server. `navigator.onLine` reports link-layer state and can claim connectivity behind a captive portal, so it is used to report internet loss and never to decide whether local operation may proceed.

## Retry is standardized, queueing is not

Every workspace already carried the same recovery shape: hold the exact command with its `commandId` in scoped `sessionStorage` before sending, block further writes while an outcome is unknown, and offer an explicit retry that survives a reload. Phase 12 standardizes the connectivity vocabulary those surfaces share rather than rewriting seven working implementations, because the existing behaviour is correct and a rewrite would risk the financial recovery path for no user-visible gain.

No command is queued for later delivery, and this is the central safety decision of the phase. Replay safety in this system comes from the server: the command id, request hash and actor binding are checked against durable event rows, and credit limits, stock availability, shift ownership and cash drawer state are all enforced by the authoritative database at commit time. A queued write would be a write whose preconditions were checked against state the device could not see. A company charge could exceed a credit limit approved elsewhere, a settlement could land against an order another terminal already paid, and a cash movement could reference a shift that has since been counted and closed. None of those can be made safe by a client-side queue, so none is queued.

The honest statement is therefore: the restaurant runs entirely without the public internet, and it does not run without its local server. Anything else would be a claim the implementation does not support.

## Conflict rules

Immutable history is never merged. Orders, settlements, payments, reversals, cash movements, stock movements, supplier entries, company ledger entries, statements and every event row are append-only, are enforced as such by database triggers and runtime grants, and are replicated as facts. A consumer that disagrees with a local financial record is wrong by definition, because the local server committed it under the constraints that define validity.

Mutable configuration, such as menu, layout, contracts and roles, already carries monotonic versions and is edited through expected-version commands. A conflicting configuration change is refused with a version conflict for an operator to resolve; it is never merged by timestamp. Derived values, including stock balances, supplier balances and company balances, are sums of immutable rows and are recomputed rather than transferred, so they cannot drift into a conflict of their own.

## Restart and recovery

All delivery state is in the checkpoint table, so a crash, a restart or a power loss resumes from the last confirmed cursor and re-delivers only records that were already committed locally. The worker guards against overlapping passes, backs off exponentially against a failing endpoint up to five minutes, and never holds a database transaction open across an outbound attempt. Restoring a backup restores the checkpoints with it; if a restore rewinds local history behind a cursor, the backlog reads as zero and an operator resets the cursor deliberately rather than the system silently resending.

## Out of scope

Offline ordering and any client write queue, cloud-to-local application of records, a WebSocket push gateway, background sync, the cloud transport protocol itself, multi-branch consolidation and fiscalization.
