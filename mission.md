# Phase 2 — Unit 2.7: Stripe Checkout Session

## Goal

Add the server-controlled Stripe Checkout Session workflow for the current Checkout Intent.

This Unit creates or resumes a Stripe-hosted payment attempt. It does not process webhooks, confirm payment, create Customers or Orders in Payload, or add frontend pages.

## Baseline and Preflight

* Phase 2 Unit 2.6 is committed.
* Record the starting HEAD and require a clean worktree except for the intentional `mission.md` modification.
* Read `AGENTS.md` completely and run the existing repository, database, Storage, and migration-status preflight.
* Require `STRIPE_SECRET_KEY` and a trusted canonical application base URL.
* Use Stripe Test mode only during verification.
* Never print, log, rewrite, or expose environment values.

Stop with exact evidence if preflight or Stripe Test-mode access is unavailable.

## Fixed Decisions

* Stripe-hosted Checkout
* One-time payment in USD
* Guest checkout
* United States shipping addresses only
* Fixed shipping charge, configurable in Payload, default 100 cents
* Stripe creates a Customer for every confirmed Checkout
* Do not request future payment-method storage
* Card payments only in this Unit
* Automatic tax disabled
* Success redirects never confirm payment or create records
* Only a verified webhook in a later Unit may create the Payload Customer and Order

## Authorized Changes

Install only the official `stripe` runtime dependency and update the lockfile.

Add server-only environment validation for:

* `STRIPE_SECRET_KEY`
* `APP_BASE_URL`, unless an equivalent trusted canonical URL variable already exists

Update the environment example without adding real values.

Add `shippingFeeCents` to Checkout Settings:

* Required integer
* Default `100`
* Minimum `0`
* Maximum `10000`
* Admin read/write only

Extend Checkout Intents with the minimum internal fields required for safe recovery:

* Add `checkout_pending` to the status options
* `checkoutAttemptId`: unique, server-generated, internal
* `checkoutStartedAt`
* `shippingAmountCents`
* `totalAmountCents`
* `stripeCheckoutSessionId`: unique and internal
* `stripeCheckoutSessionExpiresAt`

These fields are server-managed. Anonymous collection access remains denied.

Generate, review, and apply one migration for these changes. Regenerate Payload types and schema artifacts through existing project commands.

## Endpoint

Add:

`POST /api/storefront/checkout-intents/current/checkout-session`

The endpoint accepts JSON containing exactly an empty object. Reject unexpected fields, files, content types, query-controlled return URLs, and malformed bodies.

Require:

* Valid Checkout Intent HttpOnly cookie
* Same-origin `Origin`
* Unexpired Intent
* Valid amount meeting the current Checkout Settings minimum
* Between one and three valid uploads
* A state that can safely create, recover, or resume the same payment attempt

Return `Cache-Control: no-store`.

For a successful new Session, return `201`. For safe recovery or reuse of the same open Session, return `200`.

The response may contain only:

* `checkoutUrl`
* `expiresAt`

Do not separately return internal Intent IDs, attempt IDs, Stripe Session IDs, Customer IDs, token material, metadata, Storage information, or raw Stripe objects.

## Session Contract

Create the Session server-side with:

* `mode: payment`
* Currency `usd`
* One postcard line item whose amount is the Intent’s server-validated `amountCents`
* Quantity `1`
* United States shipping-address collection only
* One fixed shipping option using the snapshotted `shippingFeeCents`
* `customer_creation: always`
* Card payment methods only
* Automatic tax disabled
* No promotion codes
* No invoice creation
* No `setup_future_usage`
* No client-supplied Stripe parameters

Build success and cancel URLs only from the validated canonical application base URL:

* Success: `/checkout/success?session_id={CHECKOUT_SESSION_ID}`
* Cancel: `/checkout?checkout=cancelled`

The success URL is informational only. Do not add a success-page API, Session-detail endpoint, payment confirmation, or Order creation.

Put only the minimum reconciliation identifiers in Stripe metadata and `client_reference_id`. Never place credentials, cookie tokens, filenames, Storage keys, email addresses, or other PII in metadata.

The Stripe Session must expire no later than the Checkout Intent. If fewer than 30 minutes remain, expire the Intent, clear its cookie, and require creation of a fresh Intent instead of exceeding Stripe’s minimum Session lifetime.

## Idempotency and Concurrency

Use a recoverable two-phase flow:

1. Start a database transaction and lock the owning Checkout Intent row.
2. Revalidate credentials, status, expiry, amount, uploads, and current settings.
3. Snapshot subtotal, shipping, and total amounts.
4. Create and persist one cryptographically random `checkoutAttemptId`.
5. Set the Intent to `checkout_pending` and commit the reservation.
6. Call Stripe outside the database transaction using an idempotency key derived only from the persisted attempt.
7. Lock the same Intent again and persist the returned Session ID and expiry, then set `checkout_created`.

Concurrent requests for the same Intent must converge on the same attempt and Stripe Session.

If the Stripe response is lost or the database finalization fails, retry with the same persisted attempt and idempotency key. Do not create a second Session.

An open existing Session may return its current URL. An expired Session must not be revived. A completed Session must not be interpreted as paid; return a stable processing/conflict response and wait for the future webhook Unit.

Once an Intent becomes `checkout_pending` or `checkout_created`:

* Its amount and uploads are immutable.
* Unit 2.6 create/resume must not silently replace it with another Intent.
* Current-state responses may additionally expose only the safe shipping and total amount snapshots.

Do not hold a database transaction open during Stripe network calls.

## Verification

Add focused red-first coverage for:

* Dynamic minimum and configurable shipping fee
* Exact Session parameters and safe response
* United States-only shipping
* Customer creation enabled
* Payment-method saving and automatic tax disabled
* Missing uploads, invalid amount, expiry, invalid cookie, cross-origin, malformed body, and unexpected-field denial
* Amount and upload immutability after checkout begins
* Concurrent calls producing one internal attempt and one Stripe Session
* Stripe timeout and post-creation database-failure recovery through the same idempotency key
* No duplicate Session after retry
* No Customer or Order rows created
* No payment state inferred from the success URL
* Existing anonymous Payload, GraphQL, and unsigned Storage denial

Run deterministic tests with an injected Stripe test double, followed by a real Stripe Test-mode lifecycle that creates and then expires its synthetic Checkout Session.

Remove all synthetic database rows, Storage objects, cookies, and local fixtures. Stripe test Sessions cannot be deleted, so expire synthetic open Sessions and report that cleanup.

Run the existing acceptance, migration, type generation, import-map, TypeScript, lint, production build, route, GraphQL-denial, and postcard-scene regression gates required by `AGENTS.md`.

## Excluded Work

Do not implement:

* Webhooks or Stripe CLI forwarding
* Payment confirmation
* Payload Customer or Order creation
* Success or cancel frontend pages
* Saved payment methods
* Sales-tax collection
* International shipping
* Discount codes
* Refunds
* Email
* Admin UI customization
* Live-mode charges
* Unit 2.8

Do not modify `AGENTS.md`. Do not commit or push.

## Completion Report

Report:

* `COMPLETE` or `BLOCKED`
* Starting and ending HEAD
* Final schema, migration, endpoint, Session, and safe-response contracts
* Stripe Test-mode and idempotency evidence
* Concurrency and failure-recovery results
* Final database and Storage counts
* Dependency and validation results
* Files changed and final Git status
* Confirmation that no secret, live payment, webhook, Customer, Order, email, tax collection, saved payment method, frontend work, or persistent synthetic data was introduced
