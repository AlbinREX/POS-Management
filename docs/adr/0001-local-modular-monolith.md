# ADR 0001: Local modular monolith and branch-scoped identity

Accepted for Phase 1.

A single local NestJS process and PostgreSQL database simplify atomic restaurant operations, backups and deployment for 4–6 POS terminals plus kitchen and waiter devices. Separate microservices would create distributed transaction and offline failure modes without a current scaling need.

Organization contains branches and users. Membership explicitly authorizes access to a branch; roles attach to membership. Permissions are resolved from the database per request. Each session selects exactly one branch. Switching branches requires a new authenticated session in Phase 1.

The owner receives all initial permissions through a protected bootstrap role. Business entities are configured during bootstrap, not hard-coded as restaurant demo data. New permission keys require a migration/seed update and an intentional grant; existing customized role mappings are not overwritten by repeated seed runs.

Future cloud authority is limited to explicitly delegated configuration domains. Financial records stay branch-authoritative. No order, payment, kitchen or inventory tables are added prematurely.
