# Phase 2 — Unit 2.9: Safe Checkout Status and Result Pages

## Goal

Add a cookie-authenticated checkout-status API and minimal success/cancel pages.

The pages display server-authoritative state only. They must never confirm payment, create Orders, or treat a Stripe Session ID or redirect as proof of payment.

## Preflight

* Require Unit 2.8 to be committed.
* Record starting HEAD and Git status.
* Allow only the intentional `mission.md` modification.
* Read `AGENTS.md` completely and run its required preflight.
* Confirm all nine existing migrations are applied.
* No Stripe CLI listener is required for this Unit.
* Never print or modify environment secrets.

## Status Endpoint

Add:

`GET /api/storefront/checkout-intents/current/status`

Requirements:

* Authenticate only with the existing `stephish_checkout_intent` HttpOnly cookie.
* Reuse the established credential hashing and constant-time verification.
* Do not accept an Intent ID, Order ID, Stripe Session ID, token, email, or other identifier from query parameters or headers.
* Read only PostgreSQL/Payload state. Do not call Stripe.
* Return `Cache-Control: no-store`.
* Return a generic `401` for a missing, malformed, unknown, or incorrect credential.
* Do not reveal whether another Intent, Order, or Stripe Session exists.

For a valid cookie, return only:

* `state`: `not_started`, `processing`, `confirmed`, or `expired`
* For `confirmed` only, the immutable safe monetary summary:

  * `subtotalAmountCents`
  * `shippingAmountCents`
  * `totalAmountCents`
  * `currency: "usd"`
* An existing public-safe Order reference only if the current schema already provides one

State mapping:

* `draft` → `not_started`
* `checkout_pending` or `checkout_created` → `processing`
* `completed` with its transactionally linked Order → `confirmed`
* `expired` → `expired`

A `completed` Intent without its expected Order is an internal inconsistency. Do not report it as confirmed or expose details.

Never return:

* Internal database IDs
* Stripe Session, PaymentIntent, Customer, Charge, or Event IDs
* Cookie tokens or hashes
* Customer name, email, phone, or address
* Upload records, filenames, Storage keys, or URLs
* Webhook records or internal timestamps

## Checkout Redirect URLs

Update newly created Checkout Sessions to use:

* Success: `/checkout/success`
* Cancel: `/checkout/cancelled`

Do not include `{CHECKOUT_SESSION_ID}` or any other identifier in either redirect URL.

Previously created Test Sessions may retain their old URLs and require no migration.

If an old success link contains `session_id` or other query parameters:

* Never read, send, display, log, or use them for authorization.
* Remove them from the browser address after the page loads.
* The displayed result must still depend only on the protected cookie and status endpoint.

## Success Page

Add an accessible responsive page at:

`/checkout/success`

Use a small client component only where polling is required. Keep the rest server-rendered where practical.

Display these states:

* Initial/loading: “Confirming your payment…”
* Confirmed: “Your postcard order is confirmed.”
* Processing: explain that confirmation may take a moment
* Expired: explain that no confirmed Order was found
* Unauthorized/unavailable: explain that this checkout cannot be accessed from this browser

Requirements:

* Poll the status endpoint only while state is `processing`.
* Use a bounded interval and stop after at most 60 seconds.
* Abort requests on unmount.
* Retry when the tab becomes visible, without creating overlapping requests.
* After the polling limit, show a safe manual refresh action.
* Never poll indefinitely.
* Use an accessible live region for state changes.
* Respect `prefers-reduced-motion`.
* Do not promise an email until email delivery exists.
* Do not expose PII or internal identifiers.
* Add `noindex` metadata and a restrictive referrer policy.

A page load or refresh must remain read-only and must never call the webhook fulfillment service.

## Cancel Page

Add:

`/checkout/cancelled`

Display clearly:

* Payment was not completed.
* No Order was created by visiting this page.

Provide:

* A “Return home” action.
* A “Return to payment” action that posts exactly `{}` to the existing controlled Checkout Session endpoint and redirects only to the returned server-approved `checkoutUrl`.

Handle expired, invalid, completed, or unavailable Intents without exposing details. Never create a new Order or infer payment state from the cancel redirect.

## Visual and Accessibility Scope

Create a restrained result-page layout consistent with the existing postcard site’s typography, color palette, day/night treatment, and responsive behavior.

Do not copy the full 2.5D scene or change its animation.

Requirements:

* Desktop, mobile portrait, and mobile landscape support
* Visible keyboard focus
* Semantic headings and buttons
* Appropriate contrast
* No layout overflow
* No motion-dependent information
* Checkout-specific styles must not regress the existing scene

This is a functional result-page design, not the final storefront checkout form.

## Schema and Dependencies

No schema, migration, environment, or dependency change is expected.

Do not generate a migration or add a package. Stop and report evidence if either becomes necessary.

Do not modify existing payment, webhook, Customer, Order, Storage, or direct-access security rules except for the redirect URL change and read-only status service required here.

## Verification

Add focused red-first coverage for:

* Exact status response and no-store contract
* Missing, malformed, incorrect, expired, and cross-Intent cookie denial
* Correct mapping for all Intent states
* `completed` without Order never returning `confirmed`
* Safe confirmed monetary response
* Absence of IDs, PII, upload data, Stripe data, and internal metadata
* Status endpoint never calling Stripe or mutating data
* Query parameters and fake Session IDs providing no authority
* New Checkout Sessions using identifier-free success and cancel URLs
* Success-page loading, processing, confirmed, expired, timeout, and unavailable states
* Bounded polling, visibility retry, abort cleanup, and no overlapping requests
* Cancel-page retry using the existing controlled endpoint
* Accessibility, reduced motion, responsive layouts, and noindex behavior
* Existing checkout, webhook, anonymous REST/GraphQL denial, Storage denial, and postcard-scene regressions

Use uniquely named synthetic records and remove all created rows, objects, cookies, and fixtures.

Run the shared validation gates defined by `AGENTS.md`. Stop all task-created processes.

## Excluded Work

Do not implement:

* The main checkout amount/upload form
* Payment or Order creation from a page
* Stripe Session lookup from browser input
* Email
* Order-history or public order-lookup pages
* Admin UI changes
* Refunds, disputes, shipment tracking, or tax
* Background jobs
* Live-mode configuration
* Unit 2.10

Do not modify `AGENTS.md`. Do not commit or push.

## Completion Report

Report:

* `COMPLETE` or `BLOCKED`
* Starting and ending HEAD
* Final status, cookie, redirect, polling, and retry contracts
* Authorization and data-minimization evidence
* Responsive and accessibility evidence
* Final database and Storage counts
* Dependency and migration status
* Validation results
* Files changed and final Git status
* Confirmation that no payment mutation, webhook change, schema migration, dependency, secret, PII exposure, email, live charge, or persistent fixture was introduced
