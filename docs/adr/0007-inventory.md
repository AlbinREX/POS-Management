# ADR 0007: branch inventory ledger and settlement consumption

Phase 7 keeps the local NestJS/PostgreSQL authority and the existing Riza frontend. Suppliers, purchasing, contracts and fiscalization remain outside this phase.

InventoryItem is the single stock catalog: its kind distinguishes ingredients from other stock items without duplicating identities. Immutable reference units kg/g, l/ml and pcs define dimensions and exact conversion factors. Each item's chosen stock unit is immutable. Quantities use NUMERIC(20,6), decimal strings and bigint arithmetic; incompatible dimensions, overflow and conversions requiring rounding are rejected.

Warehouse and InventoryItem are branch-scoped, versioned and soft-archivable. StockPosition stores a warehouse/item low-stock threshold, never a quantity. Current stock is SUM(StockMovement.quantity). Adjustments are signed deltas with reasons; waste is a negative movement. All movements are immutable, audited and linked to replayable command receipts. Negative stock is allowed and surfaced to operators so inventory setup errors do not invalidate a real sale.

Recipe has one identity per product and immutable RecipeVersion/RecipeItem revisions. A version chooses the consumption warehouse and specifies quantities per one product. Editing a recipe cannot alter an earlier version. Base-product recipes are supported; modifier-specific ingredient substitutions are deferred and must not be inferred from modifier names.

At the first successful collection, InventoryPlan and its normalized lines freeze recipe versions and exact ingredient quantities from the existing order item snapshots. Products without an active recipe deliberately have no consumption lines. Existing partially paid bills from before this migration freeze their inventory plan at their next collection. Zero-total sales freeze a plan during explicit zero settlement. Already settled historical orders are not retroactively consumed.

Final settlement creates every SALE_CONSUMPTION movement in the same Serializable transaction as OrderSettlement, payments, cash movements, audit, PAID and table release. Unique plan-line references prevent duplicates, including retries. Deferred database checks enforce settlement-plan completeness and exact movement matching. Partial payments do not consume stock. Refunds and payment cancellations do not imply food returning to stock; an authorized adjustment with a reason records a physical correction.

Branch inventory revision rows serialize configuration/ledger changes and provide exact bigint event cursors. Composite foreign keys prevent cross-branch warehouse, item, recipe and source-order associations. Immutable triggers and runtime grants protect recipes, plans, movements and events. Financial transactions acquire inventory state after existing order/payment state; inventory management does not acquire order locks. Serialization conflicts use the existing 409/retry contract.

Low stock is current quantity <= threshold. A warehouse/item position is registered by its first movement or threshold configuration. An item or warehouse referenced by an active recipe cannot be archived; frozen plans remain usable even after later configuration changes. Stock valuation and supplier-backed receiving await Phase 8.
