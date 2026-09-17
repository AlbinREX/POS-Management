# ADR 0014: EnterNet / F-LINK fiscal handoff integration

FastFood Riza does not perform Kosovo fiscalization. EnterNet operates the fiscal device and the F-LINK software, and remains responsible for every fiscal behaviour: ATK rules, fiscal signing, certificates, fiscal numbering, receipt format and device protocol. This phase builds only the boundary this system actually controls, which is preparing finalized sale data and tracking whether it has been handed off.

## What this system is responsible for

One thing: taking a sale that is already final in this POS, expressing it deterministically from records it already owns, and remembering whether the provider has received it. Nothing more. No fiscal document is produced here, no fiscal number is generated, and no tax rule is applied.

That boundary is deliberately narrow because the alternative is worse. A POS that half-implements fiscal rules produces documents that look authoritative and are wrong, and the error surfaces at an audit rather than at the counter.

## Financial truth is never affected by delivery

The handoff is strictly downstream of settlement. A settlement row exists if and only if an order is PAID, enforced by the database since Phase 6, and the handoff references that settlement rather than participating in it. The provider call happens outside any database transaction, so a slow or unreachable device cannot hold locks on financial tables or delay a sale.

The consequence, stated plainly: a fiscal handoff failure never reverts a PAID order, never alters a payment, a settlement, a cash movement or a company ledger entry, and never marks an order unpaid because printing or transmission failed. The integration test asserts this directly by failing delivery repeatedly and comparing every financial row count and the order's own version before and after.

## The payload is ours, not F-LINK's

The prepared payload is this system's own contract, built from immutable snapshots: settlement identity and time, order number, type, currency, the recorded subtotal, discount, tax and total, the sold lines with their frozen product name, SKU, category, quantity, unit price, tax rate and mode, discounts and line totals, selected modifiers, the tenders with method and external terminal reference, the seller's branch and organization identity, and the cashier who settled.

No figure is recomputed. The tax breakdown groups the tax the POS already recorded per line; it does not apply a Kosovo tax rule, because that is EnterNet's responsibility and not something this system is entitled to decide. Modifier price adjustments are listed for context and never summed again, since they are already folded into line totals.

Construction is deterministic: lines sort by identity, modifiers sort by group and name, and tenders sort by method and amount, so two builds of the same settlement are byte-identical. That is what makes a retry provably the same sale rather than a new one, and it is enforced by a payload fingerprint compared across attempts.

## The transport is not implemented, and that is the point

The F-LINK protocol, payload format, endpoint semantics, authentication and error taxonomy have not been supplied. The adapter interface exists; the EnterNet transport does not. Configuring `FISCAL_PROVIDER=enternet-flink` resolves to the unconfigured adapter, because naming a provider must not conjure a transport that has not been specified.

The unconfigured adapter never claims success. It returns a retryable failure explaining that the specification is required, so handoffs accumulate visibly as unresolved rather than being silently marked delivered. A sandbox adapter exists solely for verification, refuses to construct in production, and marks its references as sandbox so no test artefact can be mistaken for a fiscal number.

## Delivery state and idempotency

Five states track delivery: PENDING, SENT, CONFIRMED, FAILED and RETRY_REQUIRED. CONFIRMED is terminal and immutable, so a delivered sale is never re-sent and a provider answering twice cannot erase the first confirmation. A retryable failure becomes RETRY_REQUIRED; a permanent rejection becomes FAILED and stays visible until a human resolves it.

The correlation key is derived from the settlement identity, which is the order id, and is unique per branch in the database. Combined with a unique constraint on the order, this makes a second handoff row for the same sale impossible, including from direct SQL. Retries reuse that identity rather than creating a new one, and every attempt is audited.

## Company accounts

A company-account tender appears in the payload as a tender with its method and company id, exactly as recorded. Whether Kosovo rules treat a B2B sale differently is not assumed here, and no separate B2B fiscal path is implemented, because that would require EnterNet's specification. The Phase 9 ledger and statements are untouched.

## Security

Provider configuration comes from the environment only. No credential appears in the database, in a request, in the frontend or in a log or audit record. The stored `providerReference` holds a value the provider supplies, verbatim, and is null until one is received.

## Out of scope

ATK rules, fiscal signing, certificates, tax-authority APIs, fiscal numbering, device protocol, receipt layout and printing, and any B2B fiscal distinction. All of these belong to EnterNet, and the specific items still required from them are listed in the verification document.
