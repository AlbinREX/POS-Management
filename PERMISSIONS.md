# Permissions and roles

Authorization is enforced in the NestJS global guard, using database-resolved permissions on each request. Role names are never trusted from the client, and OWNER is not a hard-coded authorization bypass. A valid session selects one organization and one branch through an active membership.

| Permission        | Allowed operation                                                           |
| ----------------- | --------------------------------------------------------------------------- |
| organization.read | Read the session organization.                                              |
| branch.read       | Read the session branch.                                                    |
| user.read         | Read members in the session branch.                                         |
| user.manage       | Create a user/member, enable/disable branch access, assign grantable roles. |
| role.read         | Read organization roles and defined permission keys.                        |
| role.manage       | Create roles and change permission mappings subject to scope/lockout rules. |
| terminal.read     | List registered terminals in the session branch.                            |
| terminal.manage   | Register, rename, enable or disable same-branch terminals.                  |
| audit.read        | Read the latest 100 events in the session branch.                           |

Fresh OWNER and ADMIN receive all current keys, including menu.read and menu.manage. MANAGER receives organization.read, branch.read, user.read, role.read, terminal.read and menu.read. CASHIER, WAITER, KITCHEN and STOREKEEPER receive no administrative keys. Their current operational grants are documented in the phase-specific sections below. Inventory grants are listed below; purchasing awaits Phase 8.

Phase 2 adds `menu.read` for all catalog list/detail routes and `menu.manage` for create/update/archive. Writes require both keys. The admin hides the Menu tab without read access and hides editing controls without manage access. Existing installations receive the two new keys only for protected OWNER via migration `202609110001_menu`, with immutable `role.permissions_migrated` organization-level audit events. Existing ADMIN/MANAGER/custom roles keep their prior mappings; an owner can grant new keys in Roles. Organization-level migration audit events are retained in the database; the existing branch audit screen shows branch-scoped user changes.

Every protected handler declares required permissions or authenticated-only access; handlers without metadata are denied. Health and cookie-auth endpoints are explicitly public. Authenticated-only endpoints are current profile, changing one's password and bound-terminal heartbeat.

## Grant rules

Phase 3 adds `layout.read` for areas, tables, map snapshots and the change feed; `layout.manage` for configuration, geometry and soft archiving; and `layout.status.manage` for manual status changes. Every write also requires layout.read. Fresh OWNER/ADMIN receive all three; MANAGER receives layout.read/layout.status.manage. Existing roles keep their mappings, except protected OWNER receives the three keys through audited migration `202609110002_layout`. Owners explicitly grant new access to existing roles. Feed requests recheck session and permissions, so revocation prevents further event/map reads. Current manual statuses are FREE, RESERVED and DISABLED; permissions cannot enable the deferred order statuses.

- A caller cannot grant permissions they do not already possess.
- User management cannot grant a protected role, modify protected owners or modify the caller's own branch access.
- The owner role is protected against UI/API edits. Owner succession and permission-key upgrades require a reviewed, audited operator migration; this deliberately narrow exception avoids accidental lockout.
- Roles belong to an organization. A role assigned outside the current branch cannot be edited from the current branch. Create a dedicated role instead. A role assigned to the caller cannot be edited by that caller.
- Role assignments require an existing active-session organization and a same-organization branch membership/role relationship.
- Branch disabling revokes that member's branch sessions. Password change revokes all the user's sessions across branches. User/organization/branch/terminal lifecycle is checked during every authenticated request.
- Seed inserts default mappings only when a role is first created, so repeated seed does not silently restore revoked grants.

The frontend uses permission keys to choose visible controls. Those controls are convenience only; the backend remains authoritative even with a forged request or stale browser state.

# Phase 4 order permissions

| Key            | Access                                                                      |
| -------------- | --------------------------------------------------------------------------- |
| order.read     | Branch order list/detail, history and revision feed                         |
| order.manage   | Create and edit orders, line voids with reason, open/request-payment/reopen |
| order.discount | Change fixed gross discounts with a reason; also requires read/manage       |
| order.cancel   | Cancel with a reason; also requires read/manage                             |
| order.assign   | Assign/unassign a waiter and list eligible branch members                   |

All writes require order.read/order.manage. Creation can self-assign without order.assign; assigning another user requires it. Assignment validates active same-branch membership, active user and order.manage permission, never a role name. Existing role mappings remain unchanged except the protected OWNER upgrade in `202609120001_orders`, recorded in immutable migration audit. Fresh OWNER/ADMIN/MANAGER receive all five order permissions; fresh WAITER receives menu.read, layout.read, order.read and order.manage. Existing operators need explicit owner grants. No kitchen or payment transition is unlocked by these permissions.

## Phase 5 kitchen permissions

`order.submit_kitchen` permits submission with order.read/order.manage. `kitchen.read` permits branch station/ticket lists, history, replay feeds and printer contracts. `kitchen.manage` plus kitchen.read permits forward ticket preparation transitions. These do not grant order financial, menu editing or administrative access. Order cancellation still requires order.read/manage/cancel and cancels linked kitchen tickets atomically.

Fresh OWNER/ADMIN/MANAGER receive all three keys; fresh WAITER receives order.submit_kitchen; fresh KITCHEN receives only kitchen.read/manage. Existing role mappings are preserved except the protected OWNER grant in audited migration `202609120002_kitchen`. Existing kitchen staff must receive explicit owner grants. The dedicated /kds route displays only kitchen controls, even for owners. Authorization is still enforced by backend guards on every request, including history and printer contract reads.

## Phase 6 payment permissions

| Permission           | Backend authority                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------- |
| payment.read         | Payment details/history and order payment event feed; order details also require order.read |
| payment.collect      | Collect and settle waiting bills, with payment.read/order.read                              |
| payment.cancel       | Full unsettled-payment cancellation, with payment.read                                      |
| payment.refund       | Partial/full settled-payment refund, with payment.read                                      |
| cash.shift.read      | Branch cash shifts, drawer history and available POS terminals                              |
| cash.shift.manage    | Open/close own cashier shift, with cash.shift.read                                          |
| cash.movement.manage | Cash in/out of own open shift, with cash.shift.read/manage                                  |

Fresh CASHIER receives order.read, payment.read/collect and cash.shift.read/manage plus cash.movement.manage. Refunds and cancellation require separate grants. Fresh OWNER/ADMIN/MANAGER receive all seven new keys. Existing roles are unchanged except the protected OWNER grant, audited by the migration. Merely having order.manage cannot set PAID or edit a billed order. Payment collect/refund cash entries require the actor's own open shift, valid POS terminal and matching currency. The server never accepts a client-selected cashier or branch.

## Phase 7 inventory permissions

| Permission       | Backend authority                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| inventory.read   | Branch stock, items, warehouses, recipes/revision history, movements and event feed; limited product id/name/active picker |
| inventory.manage | Create/edit/archive stock items and warehouses; configure low-stock thresholds, with inventory.read                        |
| inventory.adjust | Record signed stock adjustment deltas with reasons, with inventory.read                                                    |
| inventory.waste  | Record waste with reasons, with inventory.read                                                                             |
| recipe.manage    | Create/revise/disable product recipes, with inventory.read                                                                 |

Fresh OWNER, ADMIN, MANAGER and STOREKEEPER receive all five keys. Existing customized roles are preserved. Migration grants only the protected OWNER new permissions and audits that change; OWNER must explicitly grant access to other existing staff through Roles. STOREKEEPER does not receive user administration, menu price administration or payment permissions by default. Runtime authorization reloads branch membership and grants on each request. Settlement-driven consumption uses the existing authorized payment workflow and does not require cashiers to have manual stock adjustment authority.

## Phase 8 purchasing permissions

| Permission               | Authority                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| supplier.read            | Branch supplier directory, account balances and entry history                                                            |
| supplier.manage          | Supplier create/edit/archive, with supplier.read                                                                         |
| purchase.read            | Orders, receipt details including outstanding amounts, purchase history/events and restricted inventory/supplier pickers |
| purchase.manage          | Create/edit drafts, confirm unreceived orders and cancel unreceived purchases, with purchase.read                        |
| purchase.receive         | Post partial/full goods receipts, with purchase.read                                                                     |
| supplier.payment.record  | Record externally completed supplier payments, with supplier.read                                                        |
| supplier.payment.reverse | Reverse an erroneous supplier payment record, with supplier.read                                                         |

Fresh OWNER/ADMIN/MANAGER receive all seven keys. Fresh STOREKEEPER receives supplier.read/manage and purchase.read/manage/receive, retaining Phase 7 inventory grants without supplier-payment or POS-payment authority. The migration adds and audits only protected OWNER grants; existing customized roles are preserved. Suppliers and receipt balances stay readable after archival. Cashier payment permissions do not imply supplier-account access. Direct receiving commands cannot choose the actor, branch, receipt totals or stock movement kind.

## Phase 11 reporting

| Permission  | Authority                                                                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| report.read | Every read-only report and CSV export under `/api/reports`: overview, sales, orders, products, staff, cash, inventory, purchasing and companies |

Reporting is a distinct authority from operating. No other permission implies `report.read`, and `report.read` grants nothing else: a report-only account is refused orders, payments, companies and every other operational route. Fresh OWNER, ADMIN and MANAGER receive the key; CASHIER, WAITER, KITCHEN and STOREKEEPER do not. Existing customized roles are preserved; data-only migration `202609160001_reporting` registers the key and grants and audits only protected OWNER. Reports are branch-scoped through the session, accept no branch or organization identifier, expose only GET routes and write nothing; revoking the key takes effect on the next request of an existing session.

## Phase 10 waiter surface

Phase 10 adds no permission key. The waiter PWA is a client over existing grants: fresh WAITER holds `menu.read`, `layout.read`, `order.read`, `order.manage` and `order.submit_kitchen`, which cover the floor plan, catalog, order lifecycle and kitchen submission. Requesting payment is an ordinary order command, so a waiter moves an order to WAITING_PAYMENT with `order.manage` and never holds a payment key; collection stays behind `payment.read`/`payment.collect`, and a company account charge still requires `company.charge`. A waiter therefore cannot discount, cancel, reassign another waiter, read the kitchen display, list eligible waiters or settle money, and the server enforces that regardless of what the mobile client renders.

## Phase 9 company contract permissions

| Permission               | Authority                                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| company.read             | Branch company directory, contracts, authorized employees, account balances, ledger history and statements |
| company.manage           | Company create/edit/archive and authorized employee administration, with company.read                      |
| contract.manage          | Contract drafting, editing and status transitions, with company.read                                       |
| company.charge           | Settle an order against a company account using the COMPANY_ACCOUNT payment method                         |
| company.payment.record   | Record an externally completed company payment against the account balance, with company.read              |
| company.payment.reverse  | Reverse an erroneous company payment record, with company.read                                             |
| company.statement.manage | Generate an immutable period statement, with company.read                                                  |

Fresh OWNER/ADMIN/MANAGER receive all seven keys. Fresh CASHIER receives only company.read and company.charge, so a cashier can settle an order on an existing account without editing contracts, recording account payments or issuing statements. WAITER, KITCHEN and STOREKEEPER receive none. Existing customized roles are preserved; migration `202609150001_companies` grants and audits only protected OWNER.

Collecting on a company account requires the existing payment.read/payment.collect keys **and** company.charge, so payment authority alone cannot extend credit. Charging is additionally refused unless the company holds an ACTIVE contract and the charge stays within its credit limit; a database constraint trigger re-checks both at commit. Account payments and correction reversals remain permitted after a contract expires or is terminated so an outstanding balance can always be settled. Company, contract, employee, ledger and statement reads are branch-scoped: a company belonging to another branch returns 404 from every route, including per-company history.
