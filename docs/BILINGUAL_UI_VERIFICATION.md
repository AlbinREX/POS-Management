# Bilingual UI verification

Worktree: `C:\Users\rexhe\Documents\Codex\Pos Managment FastFood-i18n`

Branch: `feature-bilingual-ui`; starting HEAD: `61ddf82`. No commits, pushes, branch changes, rebases or main-worktree deployment were performed.

## Scope

Connected the existing catalogues to the existing locale provider and completed missing references and display translations across Home, Dashboard/Reports, POS, Orders, Menu, Tables/floor-plan, Kitchen/KDS, Payments, Inventory, Purchasing, Companies, Waiter, Operations/Sync, Fiscal/F-LINK, Team, Roles, Terminals and shared shells.

The catalogue contains **1,341 SQ/EN keys**, including 53 permission descriptions and 12 prepared device labels. The render-only API message translator has **202 exact mappings**, plus catalogue lookup and parameterized/validation-message handling.

Albanian remains the default. English is selectable and stored per device. Switching languages also updates an existing `?lang=` override, so a reload does not undo the selection. PWA installation text uses the same catalogue; `/manifest.webmanifest`, `/waiter`, scope, icons and installation identity are preserved. Localized metadata is rendered declaratively to avoid duplicate manifest links.

Business/API values, CASH/CARD values, enums, permission identifiers, financial calculations, database schema, migrations, request payloads, existing test IDs and product images are unchanged. No new business modules were implemented. Unknown server messages, configured names, user-entered text, immutable snapshots, identifiers and backend-generated exports remain verbatim.

## Device Management limitation

This worktree does not contain the Device Management component, API module, device permissions or device migration. It has the original 14 migrations. No other branch was imported.

Prepared labels: Pajisjet/Devices, Receipt Printer, NFC Reader, Kitchen Printer, Bar Printer, Connected, Disconnected, Offline, Not tested, Configure, Test Print and Test NFC. These are catalogue entries only: device-screen wiring, device-specific errors and browser execution cannot be verified until the actual module exists on this branch.

## Coverage

- Three dedicated browser scenarios, each run on desktop and mobile: default language/switch/reload/query override/localized manifest; navigation and draft submission in both languages with unchanged TAKEAWAY payloads; raw API errors rendered in both languages and language persistence in waiter/KDS shells.
- Existing 15 operational browser scenarios retain an explicit English fixture. This does not change the application's Albanian default.
- Added stable login, navigation, order-form and permission-checkbox IDs; contract/purchase status assertions use internal status attributes. Company ledger assertions use stable entry IDs.
- Source regression checks scan all frontend TSX files for missing catalogue references, missing interpolation parameters, hardcoded JSX/accessible labels and options without explicit values. Brand names, SKU and URL syntax are intentional exceptions.
- Catalogue tests check both languages, placeholder parity, device vocabulary, formatting and render-only error handling. Targeted source review also checked literal API exceptions and client notice/error setters.
- The browser harness now finishes independent workflows after a failure and then fails the overall gate, instead of hiding later failures behind the first one.

## Final gates

- PASS — lint, with zero warnings.
- PASS — TypeScript checks for shared packages, API, UI package and admin app.
- PASS — unit tests: 18 files, 232 tests.
- PASS — production build: Prisma client, packages, NestJS API and Next.js admin application. The localized manifest route was included in the production output.
- PASS — migrations and seed: 14 migrations applied twice and seed executed twice against disposable PostgreSQL 17.10.
- PASS — integration: 184 checks across foundation, menu, layout, orders, kitchen, payments, inventory, purchasing, companies, waiter, reporting, sync, operations and fiscal boundaries.
- PASS — browser E2E: 36 scenarios, 0 failures (18 desktop and 18 mobile, including six dedicated bilingual executions).
- PASS — `git diff --check`.

The complete production-build/integration/browser output is retained in the ignored `.local/i18n-e2e.log` file. The only test warning is Vitest's existing notice about its future native config loader; it does not fail a gate.
