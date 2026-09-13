# Delivery phases

Phases 1-6 are implemented under separate user authorizations. Phase 6 adds payment ledgers, deterministic splits, immutable settlement and cash shifts. WebSocket push, physical printing and card-acquirer adapters remain future work. Do not automatically start Phase 7, Inventory or Fiscalization.

1. Foundation: identity, organization/branch, permission system, terminals, audit, migrations, tests and local deployment scaffold.
2. Menu: categories, products, modifier groups/modifiers, configurable kitchen stations and product station mappings.
3. Layout: configurable areas and tables, floor plan and realtime table states.
4. Orders: historical item snapshots, lifecycle, dine-in/takeaway and later delivery/company extensions.
5. Kitchen: routing, KDS realtime workflow and printer-ready ticket contracts.
6. Payments: atomic payment ledger, splits/items, cash shifts, refunds and money invariants.
7. Inventory: ingredients, recipes, warehouses, movement ledger and sale consumption.
8. Purchasing: suppliers, goods receiving and purchase transactions.
9. Company contracts: company employees, credit/discount rules and statements.
10. Waiter PWA.
11. Transaction-backed reporting and owner dashboard.
12. Offline/local-first failure testing and synchronization implementation/hardening.
13. Backup/recovery drills, production security and deployment hardening.
14. Fiscalization only after official Kosovo ATK specifications and certification requirements.

## Phase 2 acceptance

The Phase 1 Docker deployment checks passed in `PHASE_1_VERIFICATION.md`. Menu money/tax representation, branch ownership, permission upgrade and migration design are recorded in `adr/0002-branch-menu-catalog.md`. Tax rates are explicitly configured; no fiscal rule is guessed.

Create category/product/modifier/station migrations with proper scoped uniqueness, lifecycle fields and indexes. Prices/tax configuration must use decimal-safe values; menu modifications are audited. Add role grants intentionally without overwriting customized Phase 1 grants. Protect all backend writes with permission checks, preserve soft-deleted menu entities for future order snapshots, test cross-branch isolation and repeat the verified foundation suites.
