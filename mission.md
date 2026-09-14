# Phase 2 — Unit 2.2: Private Orders Collection

## Goal

Add a private Orders collection for paid guest-checkout orders.

This Unit defines the order, payment, fulfillment, and shipping snapshot schema only. It does not integrate Stripe, accept public orders, upload photos, or send email.

## Current Baseline

- Phase 1 is complete.
- Phase 2 Unit 2.1 is committed.
- The private Customers collection exists with `fullName`, normalized unique `email`, and optional unique `stripeCustomerId`.
- Payload Admin and REST routes are operational.
- GraphQL and development schema push are disabled.
- Every existing Payload-owned table has non-forced RLS with no permissive policies.
- One Payload administrator exists.
- The public postcard experience is unchanged.
- The current `mission.md` modification is intentional and authorized.

Record the starting HEAD and Git status. Stop if Unit 2.1 was not committed or unrelated uncommitted changes exist other than `mission.md`.

## Orders Collection

Add an `orders` collection with these fields.

### Customer and payment snapshot

- `customer`
  - Required relationship to `customers`

- `contactEmail`
  - Required email
  - Trimmed and lowercased before persistence
  - Snapshot of the email used for this order

- `amountCents`
  - Required integer
  - Minimum 1
  - Represents the final amount successfully paid through Stripe
  - Must not enforce the storefront's configurable minimum payment amount

- `currency`
  - Required select field
  - Only supported value in this Unit: `usd`
  - Default: `usd`

- `stripeCheckoutSessionId`
  - Required text
  - Unique

- `stripePaymentIntentId`
  - Required text
  - Unique

- `paidAt`
  - Required date and time

### Status

- `orderStatus`
  - Required select
  - Default: `new`
  - Values:
    - `new`
    - `in_progress`
    - `ready_to_ship`
    - `shipped`
    - `completed`
    - `cancelled`

- `paymentStatus`
  - Required select
  - Default: `paid`
  - Values:
    - `paid`
    - `partially_refunded`
    - `refunded`
    - `disputed`

### Shipping snapshot

Add a `shippingAddress` group containing:

- `recipientName`: required text, maximum 150 characters
- `line1`: required text, maximum 200 characters
- `line2`: optional text, maximum 200 characters
- `city`: required text, maximum 100 characters
- `state`: optional text, maximum 100 characters
- `postalCode`: optional text, maximum 32 characters
- `country`: required two-letter uppercase country code

This is an order-time snapshot. Do not add an address to Customers.

### Fulfillment

- `trackingCarrier`: optional text, maximum 100 characters
- `trackingNumber`: optional text, maximum 200 characters
- `trackingUrl`: optional URL
- `shippedAt`: optional date and time
- `completedAt`: optional date and time

Do not add phone numbers, uploaded-photo fields, customer messages, internal notes, tax breakdowns, discounts, shipping fees, marketing attribution, or public order tokens in this Unit.

Configure useful Admin columns for customer, contact email, order status, payment status, amount, and creation time. Disable document duplication if supported by the installed Payload version.

## Access and Immutability

Orders must use these collection access rules:

- Read: authenticated Payload users only
- Update: authenticated Payload users only
- Create: denied through ordinary Admin and REST access
- Delete: denied through ordinary Admin and REST access

Future Stripe webhook code will create Orders through explicitly trusted server-side Payload Local API access in a later Unit.

Prevent ordinary authenticated updates to these immutable payment fields:

- `customer`
- `contactEmail`
- `amountCents`
- `currency`
- `stripeCheckoutSessionId`
- `stripePaymentIntentId`
- `paidAt`
- `paymentStatus`

Order status, corrected shipping information, tracking fields, `shippedAt`, and `completedAt` may be updated by an authenticated administrator.

Confirm from the installed Payload 3.88.0 implementation or types that future trusted Local API operations using `overrideAccess` can bypass the declared access rules. Do not implement that future operation now.

Also change Customers deletion access from authenticated-only to denied. Customer records referenced by financial orders must not be manually deleted. Do not change other Customers fields or access behavior.

## Migration and RLS

Register Orders and generate one reviewed Payload migration.

The migration may contain only:

- New structures required by Orders
- Declared enums, fields, indexes, unique constraints, and customer relationship
- Expected Payload lock or metadata relationships
- RLS enablement for every newly created table
- Migration bookkeeping

Every new public-schema table must receive non-forced RLS in the same migration, with no permissive policy.

Inspect the migration before applying it. Stop if it deletes or rewrites data, disables existing RLS, changes unrelated tables, introduces cascade deletion of Orders, modifies Supabase-managed schemas, or contains unexplained operations.

Apply the migration only after inspection passes. Never run the down migration.

## Verification

Add focused acceptance coverage and verify:

- The exact Orders field and status contract.
- Orders do not use authentication.
- Anonymous and authenticated ordinary access cannot create or delete Orders.
- Anonymous callers cannot read or update Orders.
- Authenticated Payload context can read and update permitted fulfillment fields.
- Immutable payment fields reject ordinary authenticated updates.
- Customers can no longer be deleted through ordinary access.
- Anonymous REST list, read, create, update, and delete requests return 403.
- Denied requests create or change no rows.
- Orders contains zero persistent rows.
- Every new table has RLS enabled, FORCE disabled, and zero policies.
- Supabase `anon` and `authenticated` roles cannot read or write Order data.
- Rolled-back probes use only synthetic `.invalid` values and display no real records.
- Existing Customers remains empty and protected.
- The administrator remains untouched.
- `/admin` remains operational.
- Anonymous `/api/customers` and `/api/users` remain denied.
- GraphQL and its playground remain unavailable.
- `/` and the postcard scene remain unchanged.

Run the existing dependency, migration-status, import-map, Payload type-generation, lint, TypeScript, production-build, route, and scene checks. Stop all temporary processes afterward.

Expected changes include the Orders collection, Customers access tightening, Payload config and types, one migration, and focused acceptance tests. Do not change dependencies, environment files, certificates, frontend code, styles, or assets.

## Excluded Work

Do not implement Stripe SDK or webhooks, public checkout, Checkout Intents, Media or uploads, photo relationships, email, analytics, frontend forms, real orders, real PII, refund execution, or Unit 2.3.

Do not modify `AGENTS.md` unless a blocking conflict is reported first.

## Completion Report

Report:

- Outcome: COMPLETE or BLOCKED
- Starting and ending HEAD
- Final Orders schema and access behavior
- Customers deletion change
- Migration and database objects changed
- RLS and API-role denial evidence
- Order and Customer row counts
- Validation results
- Files changed and final Git status
- Confirmation that no persistent test data, Stripe integration, uploads, email, frontend work, or Unit 2.3 work was introduced