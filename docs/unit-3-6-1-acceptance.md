# Unit 3.6.1 - Multi-Portrait Payment Core

## Availability and migration gate

The homepage still opens the legacy checkout. `/checkout/preview` remains development-only with payment disabled. The public replacement, complete cancellation/recovery UI and minimum artist workbench belong to Unit 3.6.2.

Forward migration `20261012_103336_add_portrait_payment_snapshots` was applied with user approval on 2026-10-12 as batch 19. It adds nullable Intent/Order payment JSON, a reserved preview relationship and an upload-to-paid-portrait relationship with indexes. It changes no existing records or RLS policies and adds no tables. Existing tables retain their previously reviewed RLS. Shared Intent/webhook queries require these columns on every deployed database. Never run the down migration against paid portrait data without a separately approved recovery plan.

Migration apply was approved and completed. Live fixtures and Stripe Sandbox acceptance still need separate user approval. Stop/restart development as needed around migration; preserve user-owned processes unless authorized to stop them.

## Payment contract

`POST /api/storefront/checkout-intents/current/cart/checkout-session`

- Requires the existing HttpOnly Intent cookie, same-origin request and no query parameters.
- Exact bounded JSON: `{ "policyAccepted": true, "shippingRegion": "us" }` or `"international"`.
- Uses the existing distributed `checkoutSession` rate limit and no-store responses.
- Returns only the existing `{ checkoutUrl, expiresAt }` contract; no private snapshot or identifiers.
- No browser-controlled prices, rates, countries, subject counts or Stripe parameters.

An Intent transaction validates the whole cart, freezes text/subjects/notes/photo identities and mappings, records policy version/time, reserves preview media and changes the Intent to `checkout_pending`. Stripe calls occur after commit. Retry preserves the original random attempt/idempotency key and exact line items/countries/rate. A changed shipping region returns conflict. An existing frozen attempt can be resumed or abandoned through the shared Session service without recreating it from the current catalog.

Legacy checkout remains supported. Its endpoint cannot begin payment on a draft portrait cart. Legacy amount writes cannot overwrite portrait subtotals.

## Shipping and payment authority

- USD, card-only, Sandbox-only; Link hidden, Adaptive Pricing and promotion codes disabled for portrait checkout.
- One line item per portrait, one shipping option per Order.
- US: 1000 cents, tracked, only `US` address selection.
- International: 500 cents, untracked, concrete destinations from the installed Stripe 22.6.2 address enum excluding `US` and unknown placeholder `ZZ`.
- The list is provisional and is not a guarantee of postal service or deliverability. Confirm final destinations, postage sustainability and policy text before production launch.
- `portrait-final-sale-v1` records acceptance of the existing preview policy; it does not establish a production deadline or waive remedies/refund capability for non-fulfillment, damage, incorrect work, charges, disputes or applicable law.

Webhook retrieval validates matching version/correlation, Sandbox/payment mode, completed status, card-only methods, USD, zero tax/discount and exact totals. Fulfillment separately validates the frozen region/country list and exact photo identity/ownership/mapping. One transaction creates the Customer/Order, immutable Order Portraits, upload ownership, completed Intent, outbox jobs and event ledger. All paid photos remain private. No names, notes, photos or Storage addresses enter Stripe metadata. Snapshot template names are the only catalog presentation text sent as Stripe product names.

Reserved and paid previews cannot be replaced/deleted; upload a new preview and change the catalog relationship instead. Unpaid reservations keep the preview protected until existing draft cleanup removes their portrait rows. Retention timing is unchanged.

## Local evidence

- PASS: focused mocked payment tests cover maximum cart, prices/shipping, exact request authority, policy acceptance, frozen snapshots, photo coverage/ownership, distributed rate-limit wrapper, uncertain create/finalization retry and concurrency serialization.
- PASS: mocked paid graph creation, same/new-event replay, transaction rollback after Customer/Order/portrait/upload/Intent/outbox/ledger writes, and post-commit email failure.
- PASS: legacy amount/session isolation, catalog collection/storefront checks, webhook signature boundary and refund reconciliation validation.
- PASS: generated types, TypeScript, changed handwritten-file ESLint and production build.
- PASS: `payload migrate:status` / `payload migrate` / final status show batch 19 applied and no pending migration. Read-only schema audit confirms all four columns, both foreign keys and both indexes. The affected tables retain RLS and zero policies. Baseline/final counts are identical: Orders 8, Order Portraits 0, Checkout Intents 10, Checkout Portraits 2, Order Uploads 15, Template Media 3.
- NOT RUN: actual PostgreSQL payment locking/rollback lifecycle and constraint enforcement under fixtures, live private Storage fixtures, actual Stripe Sessions/payments/webhooks and Resend delivery.
- NOT RUN / not required for this backend-only Unit: visual/browser acceptance. No UI changed.

The in-memory transaction harness is service-level evidence, not proof of PostgreSQL behavior. After explicit approval for live lifecycle checks, use uniquely identifiable synthetic fixtures with baseline/final database and Storage counts. Do not use customer photographs or send real email. Full customer/artist acceptance and public rollout remain Unit 3.6.2.

Follow-up on 2026-10-12: authorized Unit 3.6.2 fixtures passed real PostgreSQL/private Storage concurrency, signed synthetic fulfillment/replay, rollback and private artist HTTP checks, plus actual Stripe Sandbox Session creation/resume/expiration. All baseline counts and Storage objects were restored, and no email was sent. Paid provider retrieval was injected for synthetic signed events; an actual Hosted Checkout payment remains untested. See `unit-3-6-2-acceptance.md` for the precise execution record and remaining manual acceptance.
