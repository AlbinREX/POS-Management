# Foundation and menu API

## Phase 3 layout API

All paths below include the `/api` prefix and use the existing session, Origin, input-validation and error rules. The session selects the branch; clients cannot supply a branch or organization in a request body/query.

| Route                            | Permission and contract                                                                                                                                           |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET layout/areas                 | layout.read; page/limit/search/archived queries, `{items, page, hasMore}`. Names are arbitrary; Indoor/Terrace are examples.                                      |
| GET layout/areas/:id             | layout.read; safe current or archived Area record.                                                                                                                |
| POST layout/areas                | layout.read + layout.manage; `{name, description?, sortOrder?, canvasWidth?, canvasHeight?, active?}`; 201.                                                       |
| PUT layout/areas/:id             | layout.read + layout.manage; `{version, data: <complete area input>}`; 200.                                                                                       |
| POST layout/areas/:id/archive    | layout.read + layout.manage; `{version}`; 201, preserves records and requires no unarchived tables.                                                               |
| GET layout/tables                | layout.read; page/limit/search/archived plus optional areaId; same-branch records only.                                                                           |
| GET layout/tables/:id            | layout.read; safe current or archived RestaurantTable record.                                                                                                     |
| POST layout/tables               | layout.read + layout.manage; `{areaId, name, number, capacity, positionX, positionY, width, height, shape}`; 201, initially FREE/active.                          |
| PUT layout/tables/:id            | layout.read + layout.manage; `{version, data: <complete table input>}`; 200. Physical area changes do not transfer any order.                                     |
| PATCH layout/tables/:id/geometry | layout.read + layout.manage; `{version, positionX, positionY, width, height, shape}`; 200, used for drag commits.                                                 |
| PATCH layout/tables/:id/status   | layout.read + layout.status.manage; `{version, status}`; 200. Permits FREE ↔ RESERVED and FREE ↔ DISABLED. Same-state requests with a current version are no-ops. |
| POST layout/tables/:id/archive   | layout.read + layout.manage; `{version}`; 201. Only FREE/DISABLED tables; sets deletedAt and DISABLED/inactive.                                                   |
| GET layout/areas/:id/map         | layout.read; coherent `{area, tables, revision}` repeatable-read snapshot; includes all unarchived tables in the selected area.                                   |
| GET layout/changes               | layout.read; `after` canonical BIGINT decimal string (default `"0"`), limit 1–100 (default 100); `{events, cursor, hasMore}`.                                     |

Area dimensions are integer layout units from 200 to 10000 (defaults 1200×800). Table coordinates are nonnegative integers; dimensions are 44–1000, capacity 1–100 and number 1–99999. Number is unique per branch, including archives. Shape is RECTANGLE, SQUARE or CIRCLE; the last two require equal dimensions. Geometry must fit the area's canvas without overlapping any unarchived table's bounding box. No floating-point monetary calculation is involved.

All edits require an integer version 1–2147483647; stale edits, geometry collisions, invalid dependencies and forbidden lifecycle transitions return 409. Tables must be FREE/DISABLED before metadata/geometry edits or archival. Areas must have all tables disabled before deactivation. Archived entities cannot be changed. `active` is derived from the table status and cannot be supplied through table configuration endpoints. OCCUPIED, ORDER_SENT and WAITING_PAYMENT exist only as future status vocabulary and are rejected as status inputs with 400.

Layout events contain `{id, revision, entityType, entityId, entityVersion, action, createdAt}`. UUIDs are global; revisions are ordered within a branch and serialized as strings, never JS numbers. Events contain no client secrets or state payload; consumers refetch the authoritative map, deduplicate IDs and resume from the last processed cursor. The snapshot revision can replace the feed cursor because it covers all committed layout changes up to that revision. Writes, event insert, revision increment and audit are one atomic transaction. Polling is implemented; WebSocket push, cloud sync and event pruning are deferred.

All routes have `/api` prefix. JSON bodies are strict and capped at 32 KB. Protected routes require `Authorization: Bearer <access token>`. Every mutation requires an `Origin` header exactly matching `APP_ORIGIN`, including API-client calls. Session organization/branch comes from the server. Credential/session responses use `Cache-Control: no-store`.

| Method and path               | Body / result                                                                                                        |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| GET health/live, health/ready | Public process/database health.                                                                                      |
| POST auth/login               | `{organization, branch, email, password, terminalId?}` -> `{accessToken, expiresIn, user}`, HttpOnly refresh cookie. |
| POST auth/refresh             | Rotates refresh cookie; returns fresh access/user data.                                                              |
| POST auth/logout              | Revokes cookie session, clears cookie, returns 204.                                                                  |
| GET auth/me                   | Current safe profile and resolved permissions.                                                                       |
| POST auth/password            | `{currentPassword, newPassword}`; changes one's password, revokes all sessions, clears cookie, returns 204.          |
| GET organization, branch      | Current organization/current branch, permission protected.                                                           |
| GET users                     | Up to 200 branch memberships, safe user projection, roles.                                                           |
| POST users                    | `{name, email, password, roleIds}`; creates user and membership/roles atomically.                                    |
| PATCH users/:id/access        | `{active}`; updates branch access and revokes sessions when disabled.                                                |
| PATCH users/:id/roles         | `{roleIds}`; audited assignment replacement.                                                                         |
| GET roles, permissions        | Organization roles; known permission keys.                                                                           |
| POST roles                    | `{name, permissions}`.                                                                                               |
| PATCH roles/:id/permissions   | `{permissions}` with grant/lockout/scope protections.                                                                |
| GET terminals                 | Up to 200 same-branch devices.                                                                                       |
| POST terminals                | `{name, type}`; valid types POS/KDS/WAITER/ADMIN/OWNER/KIOSK.                                                        |
| PATCH terminals/:id           | `{name?, active?}`; audited, revokes bound sessions when disabled.                                                   |
| POST terminals/heartbeat      | Requires a terminal-bound session; updates only its own last-seen timestamp.                                         |
| GET audit-logs                | Latest 100 same-branch immutable records.                                                                            |

Errors are `{statusCode, code, message, requestId}`. The server never returns database error text, stacks, password hashes or refresh secrets in JSON. Validation uses 400, invalid session 401, permission/Origin 403, missing scoped record 404, duplicate/serialization conflicts 409, oversized body 413 and throttling 429. An unexpected dependency failure yields a generic 500 or readiness 503.

No public user registration, branch switching, forgot-password email, terminal hardware certificate or financial endpoint exists in this phase. Terminal ID labels audit/session context and does not replace user authentication. Default role names do not restrict terminal type; device-application enforcement will be added with each application boundary.

## Phase 2 menu

`kind` is one of `categories`, `products`, `modifier-groups`, `modifiers`, `kitchen-stations`.

| Method and path             | Contract                                                                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET menu/:kind              | menu.read; query page (default 1), limit (default 50, maximum 100), search (name; also SKU/barcode for products), archived (`false` default, or `true`). Returns `{items, page, hasMore}`. |
| GET menu/:kind/:id          | menu.read; returns a same-branch record, including an archived record when explicitly addressed.                                                                                           |
| POST menu/:kind             | menu.read + menu.manage; full create data including matching `kind`; 201.                                                                                                                  |
| PUT menu/:kind/:id          | menu.read + menu.manage; `{version, data}` with full current entity input; 200. Stale versions return 409.                                                                                 |
| POST menu/:kind/:id/archive | menu.read + menu.manage; `{version}`; soft archive, 201. Dependencies or already-archived records return 409.                                                                              |

Common input: kind, name, description (nullable, default null), sortOrder (integer, default 0), active (default true). Product additionally requires sku, categoryId, sellingPrice, taxRate and taxMode (`INCLUSIVE`/`EXCLUSIVE`); optional barcode/imageUrl are nullable, modifierGroupIds/kitchenStationIds default to empty arrays (no duplicates; at most 100 each). Modifier groups require minSelections/maxSelections. Modifiers require groupId and priceAdjustment. Categories/stations use only common fields. Updates are replacements: send all fields to retain their values. Changing a modifier's group is rejected.

All amounts and tax percentages are fixed-scale strings, e.g. `"5.50"`, `"18.00"`, `"-0.50"` for a modifier. Number inputs are rejected; no tax or order-total calculation occurs. No implicit tax default is supplied. Image URLs accept HTTP(S) only, and are stored without fetching remote content. Local-server image hosting is appropriate for offline deployment; uploads/previews are not implemented.

Responses include kind, id, lifecycle timestamps, version and type-specific configuration; prices remain two-decimal strings. Scope fields cannot be supplied in bodies or queries. Archive retains identifiers and audit snapshots. Remove dependencies before archiving categories, groups or stations. A required group cannot lose choices used by active products. No DELETE endpoint exists.

Example product input (replace IDs with same-branch catalog IDs):

```json
{
  "kind": "products",
  "name": "Operator-configured product",
  "sku": "OPERATOR-SKU",
  "categoryId": "77c7f4a3-067d-4ce4-a898-8a28d7b1d171",
  "sellingPrice": "5.50",
  "taxRate": "0.00",
  "taxMode": "INCLUSIVE",
  "modifierGroupIds": [],
  "kitchenStationIds": []
}
```

The sample tax value is an input example, not a tax recommendation.

# Phase 4 orders

All paths below are under `/api`, use the existing access token/session/Origin controls, and derive scope from the server principal. Money uses two-decimal strings; number/revision use BIGINT strings. Details include historical voided items.

| Method/path              | Body/query                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| GET orders               | page, limit, optional status (DRAFT/OPEN/WAITING_PAYMENT/CANCELLED); returns items, hasMore, revision |
| GET orders/:id           | Order snapshot including all items/modifiers                                                          |
| GET orders/changes       | after revision string, limit; metadata events, cursor, hasMore                                        |
| GET orders/:id/history   | after, limit; events include full historical snapshots                                                |
| GET orders/waiters       | page, limit; only eligible member ID/name; requires order.assign                                      |
| POST orders              | commandId UUID, type DINE_IN/TAKEAWAY, tableId (dine-in only), optional waiterId and notes            |
| POST orders/:id/commands | commandId UUID, expected version, action and fields below                                             |

Command actions: `add_item` (productId, integer quantity, modifierIds, notes), `update_item` (itemId, quantity, notes), `void_item` (itemId, reason), `discount` (amount, reason), `notes` (notes), `assign_waiter` (waiterId or null), `status` (OPEN or WAITING_PAYMENT), `cancel` (reason). All payloads are strict; no supplied scopes, totals or snapshot prices are accepted. Modifiers on an existing line are changed by explicitly voiding and adding a replacement line; historical snapshots never get rewritten. Table/type association is fixed at creation in this phase.

Successful command replay returns the original snapshot (possibly older than current state); refresh order detail after replay. Concurrent writes/invalid transitions or configuration dependencies return 409. Wrong-branch IDs return 404; missing permissions return 403. Validation failures return 400. Order commands cannot directly dispatch KDS or mark PAID. Use the separately authorized kitchen submission and payment settlement routes. Inventory consumption remains unavailable.

## Phase 5 kitchen routes

| Method/path (under /api)               | Input/result                                                                                 |
| -------------------------------------- | -------------------------------------------------------------------------------------------- |
| POST orders/:id/kitchen-submit         | Strict commandId UUID and expected order version; returns order snapshot                     |
| GET kitchen/stations                   | Branch station ID/name/active only; includes historical ticket stations                      |
| GET kitchen/tickets                    | page, limit, optional stationId, view=active/history; tickets, revision, serverTime, hasMore |
| GET kitchen/tickets/:id                | Money-free preparation snapshot and lifecycle metadata                                       |
| POST kitchen/tickets/:id/state         | Strict commandId, version and PREPARING/READY/COMPLETED                                      |
| GET kitchen/changes                    | after BIGINT string, limit; metadata events/cursor/hasMore                                   |
| GET kitchen/tickets/:id/history        | after, limit; history with full ticket snapshots                                             |
| GET kitchen/tickets/:id/print-contract | Version 1 KitchenPrintContract; original or cancellation document, no transport execution    |

NEW -> PREPARING -> READY -> COMPLETED is the only preparation path. Skip/backward/stale/cancelled transitions conflict. READY/COMPLETED aggregate to order READY; completed kitchen work never marks an order paid or served. Cancellation remains the order command and preserves all ticket timestamps/content. Submitted order content is locked; READY may request WAITING_PAYMENT. Order details now include kitchenSubmitted. The status list filter also accepts SENT_TO_KITCHEN/PREPARING/READY, but manual status commands cannot set kitchen states or PAID. Replayed responses can be older than the live state: refresh after retry.

## Phase 6 payment routes

All routes below have `/api` prefix, session-derived branch scope and explicit permission guards. Strict commands reject unknown fields. Monetary values must be fixed two-decimal strings; never numbers. Commands use UUID commandId, with exact actor/payload replay and 409 for conflicts. A replay returns the original receipt; refresh detail afterward.

| Method/path                          | Request or response                                                                                                                                      |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET payments/orders/:id              | Original order, bill mode, collected/cancelled/refunded/net/due, settlement time, immutable receipts/allocations/reversals and remaining unit quantities |
| POST payments/orders/:id/collect     | commandId, version, mode AMOUNT/ITEMS, tenders (1..20)                                                                                                   |
| POST payments/orders/:id/settle-zero | commandId, version; nonempty zero-total WAITING_PAYMENT bill only                                                                                        |
| POST payments/:paymentId/reverse     | commandId, kind CANCELLATION/REFUND, amount, reason, cash shiftId or card transactionReference                                                           |
| GET payments/orders/:id/history      | after string cursor, limit <=100; event receipt snapshots                                                                                                |
| GET payments/changes                 | after string cursor, limit <=100; branch order-payment event metadata                                                                                    |
| GET payments/terminals               | page/limit <=100; active registered POS choices                                                                                                          |
| GET payments/shifts                  | page/limit <=100; branch shift summaries plus current actor open shift                                                                                   |
| POST payments/shifts                 | commandId, terminalId, openingAmount                                                                                                                     |
| GET payments/shifts/:id              | page/limit <=100; shift reconciliation plus movement history                                                                                             |
| POST payments/shifts/:id/commands    | commandId, version, action close + closingAmount/reason; or cash_in/cash_out + amount/reason                                                             |

AMOUNT tender: `{method:"CASH",amount:"4.00",tendered:"10.00",shiftId:"uuid"}` or `{method:"CARD",amount:"6.00",transactionReference:"terminal-receipt"}`. Cash change is 6.00 in this example; applied cash is 4.00. Submit both tenders together for an atomic mixed collection. Amount below due remains partial; exact due creates settlement and PAID. Overcollection is rejected.

ITEMS tenders replace amount with `items:[{itemId:"uuid",quantity:1}]`; server computes their immutable discounted unit amounts. Bill mode cannot change. Limits: 200 payments per order, 100 reversals per payment, 2000 source units in item mode, 20 tenders per command. Zero-priced units may share a positive collection; zero-total bills use explicit settlement. There is no fractional physical unit split or split by seats.

Cancellation is full and only before settlement; a cash cancellation returns applied amount (change was already returned), and card cancellation requires external confirmation. Refunds are bounded by the original payment minus prior reversals and preserve PAID. No frontend action or order command can manually set PAID. Submitted kitchen tickets must be READY/COMPLETED before WAITING_PAYMENT; READY tickets may complete after PAID without changing order totals or order version.

## Inventory (Phase 7)

All paths below are under `/api/inventory`. They require authenticated branch membership and `inventory.read`; mutation keys are listed in PERMISSIONS.md. Branch/user identity always comes from the session. List endpoints accept page, limit (maximum 100), search, optional warehouseId/itemId and includeArchived=true/false. All quantities are decimal strings with at most six fractional digits; version fields are integers. Never convert quantities or monetary values through JavaScript floating-point calculations.

| Method/path                                          | Contract                                                                                              |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| GET units                                            | Fixed unit code, dimension and conversion metadata                                                    |
| GET items / warehouses / recipes / stock / movements | Paginated branch data with items and hasMore                                                          |
| GET products                                         | Paginated id/name/active picker without price/administrative fields                                   |
| POST items                                           | commandId, name, sku, kind INGREDIENT/STOCK_ITEM, unitCode                                            |
| PUT items/:id                                        | commandId, version, name, active                                                                      |
| POST items/:id/archive                               | commandId, version                                                                                    |
| POST warehouses                                      | commandId, name, description                                                                          |
| PUT warehouses/:id                                   | commandId, version, name, description, active                                                         |
| POST warehouses/:id/archive                          | commandId, version                                                                                    |
| POST recipes                                         | commandId, productId, warehouseId, version (0 for new), active, items [{itemId,quantity,unitCode}]    |
| GET recipes/:id/history                              | Paginated immutable revisions                                                                         |
| POST movements                                       | commandId, warehouseId, itemId, kind ADJUSTMENT/WASTE, quantity, unitCode, reason                     |
| POST thresholds                                      | commandId, warehouseId, itemId, version (0 for an unregistered position), lowStockThreshold, unitCode |
| GET events                                           | after decimal-integer string cursor, limit <=100                                                      |

Example movement: `{commandId:"uuid",warehouseId:"uuid",itemId:"uuid",kind:"ADJUSTMENT",quantity:"1.250",unitCode:"kg",reason:"Opening stock count"}`. For an item stored in g this records `1250.000000` g. WASTE takes a positive input and records a negative movement; ADJUSTMENT accepts a signed nonzero delta. Movement inputs cannot forge SALE_CONSUMPTION or source order references. Incompatible units, rounding, stale versions and recipe/archive conflicts are rejected. Reuse the same commandId and body after an uncertain network result; explicit conflict responses require refreshing state before preparing a new command.


## Purchasing (Phase 8)

Routes are under `/api/purchasing`; branch, organization and actor are derived from the authenticated session. All writes use commandId UUIDs; repeat an uncertain command with identical input. Stale versions, duplicate reference/invoice, overreceiving and overpayment return conflicts. List endpoints accept page, limit <=100, search, supplierId, purchaseOrderId, optional status and includeArchived. Stock/purchase quantities and money are decimal strings.

| Method/path | Input or result |
| --- | --- |
| GET suppliers | Paginated supplier configuration |
| POST suppliers | commandId, name; optional businessNumber, taxNumber, contactPerson, phone, email, address, notes |
| PUT suppliers/:id | Supplier fields plus version and active |
| POST suppliers/:id/archive | commandId, version; no open purchase orders |
| GET suppliers/:id/account | Currency, receivedValue, outstanding, lastReceiptAt, receiptCount and paginated entries |
| GET catalog/items / catalog/warehouses / catalog/suppliers | Active branch pickers under purchase.read |
| GET orders / orders/:id | Purchase snapshots, exact totals and per-item received/remaining quantities |
| POST orders | commandId, supplierId, warehouseId, reference, notes, expectedDate; items [{itemId,quantity,unitCode,unitPrice,taxRate}] |
| PUT orders/:id | Draft input plus version; only DRAFT |
| POST orders/:id/order | commandId, version; confirms and freezes content |
| POST orders/:id/cancel | commandId, version, reason; only DRAFT or unreceived ORDERED |
| POST orders/:id/receive | commandId, version, reference, optional invoiceNumber/invoiceDate (together), dueDate, HTTPS documentReference, notes; items [{purchaseItemId,quantity}] |
| GET receipts / receipts/:id | Immutable goods snapshots, receivedBy, source purchase and current unpaid amount |
| POST payments | commandId, receiptId, positive amount, method BANK_TRANSFER/CASH/CARD/OTHER, reference, reason |
| POST payments/:id/reverse | commandId, reason; full correction of original supplier payment record |
| GET events / orders/:id/history | after string bigint cursor, limit <=100; history includes safe response snapshots |

Purchase quantities accept compatible kg/g and l/ml conversion with no rounding. Unit prices are net, up to four decimals; tax is an operator-supplied percentage, up to two decimals. Receipt net amounts round to cents per line, tax rounds from that net amount, then totals sum exactly. Ordered prices cannot be overridden by receiving inputs. Partial deliveries are separately rounded accounting charges; their sum may differ slightly from the original order estimate.

Example receipt items: `[{purchaseItemId:"uuid",quantity:"1.250000"}]` for a kg-based purchase line of an inventory item stored in g creates `1250.000000` g in StockMovement. Posting requires all selected quantities to be positive and within remaining amounts. UI zero quantities are omitted before submission. Receipt reference and any invoice number are unique per supplier/branch ignoring case and surrounding spaces. One receipt represents one delivery/charge; multi-delivery invoice grouping, credit notes/returns, unallocated supplier credits and payment execution are outside Phase 8.
