# Phase 14 verification: EnterNet / F-LINK fiscal handoff integration

Verified locally on **2026-09-19**. Scope is Phase 14 only. No new phase was started.

## We do not fiscalize

FastFood Riza does not perform Kosovo fiscalization. **EnterNet operates the fiscal device and the F-LINK software and remains responsible for every fiscal behaviour**: ATK rules, fiscal signing, certificates, tax-authority communication, fiscal numbering, receipt format and device protocol.

This phase implements only the integration boundary this system controls: preparing finalized sale data from records it already owns, and tracking whether that data has been handed off. No fiscal rule was invented, no fiscal document is produced, and no fiscal number is generated anywhere in this codebase.

## What was built

- **A deterministic sale payload** built from immutable settlement, order, line, modifier and payment snapshots. The same settlement always produces a byte-identical payload, which is what makes a retry provably the same sale.
- **A provider abstraction** (`FiscalProvider`) with the EnterNet adapter boundary defined but its transport deliberately unimplemented, plus an unconfigured adapter that never claims success and a sandbox adapter used only by verification.
- **Handoff delivery state** in a new `FiscalHandoff` table: PENDING, SENT, CONFIRMED, FAILED, RETRY_REQUIRED, keyed one-to-one to a settlement with an idempotent correlation key.
- **Two permissions**, `fiscal.read` for visibility and `fiscal.retry` for the operator action, so seeing unresolved work does not confer the right to act on it.
- **UI**: a compact fiscal state on payment detail with an inline retry, and a Fiscal tab in the Owner/Admin dashboard listing unresolved handoffs.

## What sale data is prepared

Settlement and order identity, order number, settlement timestamp, order type, currency, the recorded subtotal, discount, tax and total; per line the frozen product name, SKU, category, quantity, unit price, tax rate and mode, discount and line total, with selected modifiers; a tax breakdown grouped by the rate and mode already recorded; tenders with method, amount, external terminal reference and company id where applicable; the seller's organization and branch identity with timezone; and the cashier who settled, plus table and waiter snapshots.

No figure is recomputed. The tax breakdown aggregates what the POS recorded; it applies no Kosovo tax rule.

## What remains blocked on EnterNet

The transport is not implemented, and cannot be without the following. Configuring `FISCAL_PROVIDER=enternet-flink` resolves to the unconfigured adapter until these arrive.

1. **Integration mechanism**: local HTTP API, TCP socket, file drop, local agent, database bridge or SDK, and its connection parameters.
2. **Payload format and field mapping**: the exact schema F-LINK expects, and which of our prepared fields map to it, including any field we do not currently produce.
3. **Response contract**: success shape, the provider reference to store, and the error taxonomy distinguishing retryable from permanent failure.
4. **Idempotency contract**: whether F-LINK deduplicates by our correlation key, and its required format if not.
5. **Timing requirement**: whether handoff may be asynchronous, or whether their rules require synchronous blocking at settlement.
6. **Authentication and TLS**: credential type, provisioning and rotation, certificate and pinning expectations.
7. **B2B treatment**: whether company-account sales follow the same path or a separate one.
8. **Refunds, voids and corrections**: whether these require their own handoff, and in what form.
9. **Receipt printing responsibility**: whether F-LINK prints, or expects the POS to.
10. **Sandbox environment**: test endpoint and credentials so the adapter can be verified against a real contract.

## Verification results

| Check               | Result  | Evidence                                                                                                                                                                                                                                                                                                                           |
| ------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint                | PASS    | `npm.cmd run lint`; zero warnings or errors.                                                                                                                                                                                                                                                                                       |
| Typecheck           | PASS    | `npm.cmd run typecheck`; shared packages, database, API, UI and Next.js.                                                                                                                                                                                                                                                           |
| Unit tests          | PASS    | `npm.cmd test`; **170 tests across fifteen files**, including 22 new fiscal tests covering deterministic payload construction, settled-order eligibility, state rules, idempotency and the provider boundary.                                                                                                                      |
| Integration tests   | PASS    | **184 checks**, including **fiscal 12**: permission gating, settled-only eligibility, deterministic payload, honest failure without a transport, no mutation of financial truth, duplicate protection, audited retry, terminal confirmation, database state constraints, branch isolation, strict inputs and immediate revocation. |
| Browser tests       | PASS    | `npm.cmd run test:e2e`; **26 specs, 13 desktop and 13 mobile, zero failures**, covering the whole surface with the fiscal state rendered on payment detail and the dashboard Fiscal tab.                                                                                                                                                                                                                                                                                                      |
| Production build    | PASS    | Next.js optimized production build compiled successfully and generated all static pages as part of the browser gate.                                                                                                                                                                                                                                                                                                 |
| Deployed container  | PASS    | Rebuilt images, verified through Nginx on `localhost:8080`: migration applied with its three CHECKs and both permissions granted to protected OWNER, anonymous `fiscal/status` is 401, status reports no configured transport, a real settled sale of 16.80 produced a payload, a failed attempt left order, payment, settlement and ledger rows and the order version unchanged, duplicate protection held at one handoff, and no credential appeared in any response.                                                                                                                                                                                                                                                                                           |
| Migration from zero | PASS    | **14 migrations from an empty database**, ending with `202609190001_fiscal`; the runtime role still cannot mutate audit, payment or stock history, and a second deploy reports nothing pending.                                                                                                                                                                                                                                                                                     |
| Backup/restore      | PASS    | Drill on archive `restaurant-20260917T120320Z.dump` restored into an isolated database: 14 finished migrations, every business count and financial total matching the live database (orders 12, payments 8, settlements 7, ledger 2, statements 1, fiscal handoffs 0), audit triggers and immutability grants intact, and the live database never touched.                                                                                                                                                                                                                                                                                    |
| Dependency scan     | PASS    | `npm.cmd audit --omit=dev`; **0 vulnerabilities**.                                                                                                                                                                                                                                                                                 |

Local evidence is ignored under `.local/phase14-*`.

## Safety properties asserted by tests

A provider failure never alters financial truth: the integration suite fails delivery repeatedly and then compares order, payment, settlement and company-ledger row counts, the order status and the order version before and after. All are unchanged, and the sale remains PAID.

Duplicate handoff is impossible: exactly one row exists per settlement, retries increment attempts on that row, a second row is rejected by unique constraints even from direct SQL, and a CONFIRMED handoff refuses any further attempt with a conflict.

No fiscal identifier is accepted from a client: the retry schema is strict and rejects `providerReference` and `fiscalNumber`; the stored provider reference is only ever what an adapter reports.

## Known limitations

- **The F-LINK transport is not implemented.** Handoffs accumulate as unresolved and are never reported as delivered. This is deliberate: the alternative is a fake success.
- **No automatic retry worker.** Retry is operator-initiated. Automatic scheduling waits on the provider's timing and rate expectations.
- **Settlements are not auto-registered for handoff.** A handoff row is created on first attempt or explicit registration, because whether every sale requires fiscalization is an EnterNet rule, not ours to assume.
- **No refund, void or correction handoff**, pending their specification.
- **No receipt printing.** Whether F-LINK prints is an open question above.
- **Company-account sales carry their tender in the payload** but follow no separate B2B path, since none is specified.
