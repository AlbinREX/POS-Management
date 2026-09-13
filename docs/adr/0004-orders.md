# ADR 0004: local transactional orders

Status: accepted for Phase 4.

Orders remain in the NestJS modular monolith and the existing authenticated admin workspace. The standalone POS and waiter applications remain later delivery surfaces. PostgreSQL on the restaurant LAN is authoritative.

## Scope and lifecycle

Create DINE_IN (required table) or TAKEAWAY (no table) in DRAFT. DRAFT -> OPEN -> WAITING_PAYMENT; WAITING_PAYMENT -> OPEN explicitly reopens editing. Any of these may be CANCELLED with a reason and separate permission. Opening/requesting payment requires a nonempty order. Kitchen states and PAID are reserved vocabulary, rejected in this phase. Cancellation preserves totals and items; it does not imply a refund or inventory consumption.

A dine-in draft reserves its table operationally as OCCUPIED. One nonterminal order per table is enforced by a partial unique index. Order creation, occupancy, layout version/event, order event and audit commit together. Waiting changes the table to WAITING_PAYMENT; cancellation releases it. Table reassociation is not yet a transfer workflow. Waiter assignment references an active membership in the same branch with order.manage permission, independently of role names.

## Money and historical data

All amounts cross JSON as decimal strings and use exact decimal/BigInt arithmetic on the server. Quantities are whole sale units, 1–999. Each new line snapshots product name, SKU, category name, price, tax mode/rate and selected modifier names/group names/adjustments. Changing quantity uses the original snapshot; adding a new line uses the current catalog. Removing a line marks it void with a reason; it is never deleted. Modifier selections enforce current configured group limits on insertion.

The subtotal is explicitly **gross before discount**, tax is the included tax after discount, and total = subtotal - discount. Tax-exclusive catalog prices are converted to gross per line; tax-inclusive prices already include tax. Round half up to cents per line. A fixed gross order discount is allocated proportionally across active lines in integer cents by largest remainder, with UUID tie-breaking, then included tax is extracted from each discounted gross line and rounded half up. This is a documented commercial calculation policy, not an assertion of Kosovo fiscal compliance. Discount changes require order.discount and a reason. No customer-supplied totals are accepted. Negative prices after modifiers, excessive discounts and amount overflow are rejected.

## Concurrency, history and events

Serializable transactions and expected order versions reject conflicting edits. UUID command IDs plus a canonical request hash, actor and stored response in immutable OrderEvent make successful commands replayable without duplicating effects; reuse with different content or actor conflicts. Clients must retain the original command on an ambiguous network failure. Branch counters serialize order numbers and event revisions; BIGINT values use JSON strings. This intentionally trades some branch-level write contention for a gap-free committed event feed at the initial terminal scale. Serialization conflicts return 409 and require explicit refresh/retry.

Every successful mutation records a full allowlisted order snapshot in an immutable event and audit entry. An authenticated revision feed supports replay and future WebSocket delivery. There is no in-memory-only delivery, cloud dependency, or offline write queue. Lost LAN/server access pauses writes; public internet loss does not affect the local stack. Paid/cancelled orders and snapshot fields have database mutation guards; runtime cannot delete orders/items or alter events/modifier snapshots.

## Risks and future boundaries

Phase 5 must add kitchen submission/routing transitions and post-submission item-change rules. Phase 6 must settle payments atomically, protect paid totals, and release tables without deleting history. Phase 7 must consume stock exactly once from finalized sales, never from drafts or cancellation. Fiscal references/provider integration must follow official certified specifications; none are invented here. Event retention, reliable push delivery and full disaster recovery remain separate hardening work. Large histories need retention planning; API lists/history are paginated.
