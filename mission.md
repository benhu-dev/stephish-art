# Phase 2 — Unit 2.8: Verified Stripe Webhook Fulfillment

## Goal

Add the verified Stripe webhook workflow that creates exactly one Payload Customer and Order only after Stripe confirms payment.

This Unit handles payment fulfillment only. It does not add frontend pages, email, refunds, shipping operations, tax collection, or live-mode deployment.

## Preflight

* Require Phase 2 Unit 2.7 to be committed.
* Record starting HEAD and Git status.
* Allow only the intentional `mission.md` modification.
* Read `AGENTS.md` completely and run its required preflight.
* Confirm Stripe CLI 1.51.0 is authenticated in Sandbox mode and forwarding to the local endpoint.
* Require `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` without printing, rewriting, or exposing either value.
* Keep all Stripe verification in Test mode.

Stop on unrelated changes, missing configuration, unapplied migrations, or schema drift.

## Webhook Endpoint

Add a Next.js App Router endpoint:

`POST /api/webhooks/stripe`

Use the App Router directly so the exact raw request body is available. Do not implement this through a handler that parses or mutates JSON before signature verification.

The endpoint must:

* Read a bounded raw body with a 1 MiB maximum.
* Require exactly one valid `Stripe-Signature` header.
* Verify the raw body with the official Stripe SDK and `STRIPE_WEBHOOK_SECRET`.
* Keep Stripe’s normal timestamp tolerance.
* Never log the body, signature, secret, customer PII, or raw Stripe objects.
* Return a generic `400` for missing or invalid signatures or malformed payloads.
* Return `200` for safely ignored, already-processed, or successfully processed events.
* Return `500` for transient processing failures so Stripe retries.

Do not require an Origin header, storefront cookie, CSRF token, or browser authentication. The Stripe signature is this endpoint’s trust boundary.

Add `STRIPE_WEBHOOK_SECRET` to server-only environment validation and `.env.example` without a real value.

## Supported Events

Handle only these snapshot events:

* `checkout.session.completed`
* `checkout.session.async_payment_succeeded`
* `checkout.session.async_payment_failed`
* `checkout.session.expired`

A verified event without this application’s reconciliation metadata may be acknowledged and ignored without persistence or disclosure.

A verified event claiming this application’s metadata but conflicting with stored state, Session ID, attempt ID, amounts, currency, or ownership must not mutate fulfillment data.

## Paid Session Verification

For completion or asynchronous-success events:

1. Verify the event signature.
2. Retrieve the latest Checkout Session from Stripe using the server key before opening a database transaction.
3. Require:

   * Test mode
   * `mode: payment`
   * `payment_status: paid`
   * Currency `usd`
   * A Stripe Customer ID
   * A PaymentIntent ID
   * Matching Checkout Intent and attempt reconciliation metadata
   * Session ID matching the stored Checkout Intent
   * Subtotal, shipping, and total matching the immutable Unit 2.7 snapshots
   * United States shipping address
   * Valid customer email and name
   * Between one and three existing private uploads belonging to the Intent

Do not trust redirect query parameters, client data, event metadata alone, or an unrefreshed event snapshot as proof of payment.

A completed but unpaid Session must not create a Customer or Order. A later valid `async_payment_succeeded` event may fulfill it.

## Atomic Fulfillment

After external Stripe verification, start one database transaction and lock the owning Checkout Intent.

Inside the transaction:

* Revalidate Intent status, attempt, Session ID, amounts, expiry relationship, and uploads.
* Deduplicate by Stripe event ID, Checkout Session ID, and PaymentIntent ID.
* Normalize the Stripe email to lowercase.
* Create or reuse the Payload Customer:

  * Reuse an exact existing email/Stripe Customer match.
  * Attach the Stripe Customer ID only if the existing customer has none.
  * Never overwrite a different existing Stripe Customer ID or silently merge conflicting identities.
* Create exactly one Order using the existing Orders schema.
* Store immutable customer, shipping-address, upload, currency, subtotal, shipping, total, Session, PaymentIntent, and paid-time snapshots required by the existing schema.
* Use the existing initial paid/unfulfilled Order status.
* Preserve the private upload objects and durably associate their records/snapshots with the paid Order.
* Do not copy files, expose Storage keys, or create public/signed URLs.
* Mark the Checkout Intent `completed`.
* Record the webhook event as processed.
* Commit all fulfillment changes together.

Any failure must roll back the Customer, Order, Intent, upload association, and webhook-event writes together.

Concurrent deliveries and differently ordered success events must converge on the same Customer and Order.

## Webhook Event Ledger and Constraints

Add one internal Stripe webhook-event collection/table containing only the minimum audit data:

* Unique Stripe event ID
* Event type
* Processing disposition
* Related internal reconciliation reference
* Stripe event creation time
* Processed time
* Non-sensitive failure or ignore code when applicable

Do not persist the raw webhook payload, address, email, card details, signature, or secret in the ledger.

Access must be admin-read-only. Anonymous REST/GraphQL create, update, and delete remain denied. Trusted webhook writes must explicitly override access only inside the fulfillment service.

Reuse existing Order payment uniqueness constraints. If Checkout Session or PaymentIntent uniqueness is missing, add the minimum required constraints.

Generate, review, and apply one migration for the webhook ledger and any strictly necessary uniqueness or relationship changes. Do not add dependencies or redesign existing collections.

## Failure and Expiry Events

For `checkout.session.async_payment_failed`:

* Never create Customer or Order records.
* Record the verified event.
* Mark the matching unfulfilled Intent expired so a later storefront request can start a fresh Intent.

For `checkout.session.expired`:

* Never create Customer or Order records.
* Mark the matching unfulfilled Intent expired.
* Never change an already completed Intent or Order.

Unknown Sessions without this application’s metadata may be acknowledged and ignored. Conflicting events must not overwrite paid state.

## Verification

Add focused red-first tests for:

* Exact raw-body signature verification
* Missing, malformed, expired, incorrect-secret, duplicated-header, mutated-body, and oversized-body rejection
* Safe handling of unrelated and unsupported signed events
* Paid completion creating one Customer and one Order
* Completed-but-unpaid behavior followed by asynchronous success
* Exact customer, shipping, upload, and payment snapshots
* Duplicate delivery, concurrent delivery, and reversed event order
* Existing-customer reuse and identity-conflict denial
* Amount, currency, Session, PaymentIntent, metadata, country, upload, and ownership mismatches
* Transaction rollback after injected failures
* Async failure and Session expiry without Order creation
* Anonymous REST, GraphQL, and private Storage denial
* No secrets or PII in logs, errors, URLs, or webhook ledger

Use Stripe SDK-generated signatures and deterministic Stripe test doubles for exhaustive tests.

Also verify one real Stripe CLI signed delivery reaches the production-built local endpoint. It may be an unrelated synthetic Stripe event and must be safely acknowledged without creating data.

Remove all Unit-created database rows, Storage objects, cookies, and fixtures. Test-mode Stripe payment objects that cannot be deleted may remain, but identify their type and confirm that no live charge occurred.

Run the shared validation and regression gates defined by `AGENTS.md`.

## Excluded Work

Do not implement:

* Success or cancel frontend pages
* Order-status polling endpoints
* Email or notification delivery
* Refunds, disputes, cancellations, or chargebacks
* Shipment creation or tracking
* Tax collection
* Saved payment methods
* International shipping
* Background queues or cleanup jobs
* Dashboard webhook registration
* Live-mode payments
* Unit 2.9

Do not modify `AGENTS.md`, commit, or push.

## Completion Report

Report:

* `COMPLETE` or `BLOCKED`
* Starting and ending HEAD
* Final endpoint, signature, event, schema, and migration contracts
* Paid-session verification and atomic fulfillment evidence
* Duplicate, concurrency, ordering, and rollback evidence
* Stripe CLI delivery result
* Final database and Storage counts
* Remaining Stripe Test objects, if any
* Dependency, migration, and validation results
* Files changed and final Git status
* Confirmation that no secret, live charge, frontend, email, refund, shipment, tax, saved payment method, public file access, or persistent local fixture was introduced
