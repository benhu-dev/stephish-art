# Phase 3 - Unit 3.6.1: Multi-Portrait Payment Core

## Outcome

Create server-authoritative multi-portrait Stripe Checkout Sessions and fulfill their immutable paid Order graph. Preserve the homepage checkout and disabled development preview until Unit 3.6.2 adds the minimum artist workbench and switches public entry points.

## Confirmed decisions

- One to five portraits with server-calculated USD prices and complete private photo coverage of one to three named people/pets per portrait.
- Shipping once per Order: US tracked 1000 cents; international untracked 500 cents.
- The selected shipping region restricts Stripe address countries. US addresses cannot use international pricing.
- Provisionally allow explicitly enumerated Stripe-supported international destinations, excluding unknown placeholder codes. Final destinations remain a release decision, not a postal deliverability guarantee.
- Preserve card-only Sandbox payments, cookie authority, idempotency, verified webhooks and refund/dispute behavior.
- Freeze template/subject/note/photo and shipping/policy facts before provider work. Uncertain retries use stored snapshots, not mutable catalog data.
- Require and record policy acceptance with a server timestamp and version. Do not promise a production deadline.

## Scope

- Narrow same-origin, cookie-authorized, rate-limited portrait payment endpoint.
- Transactional reservation, frozen snapshot validation and provider work only after commit.
- Multiple Stripe line items, one fixed shipping option and region-restricted address collection.
- Webhook country/amount/ownership/coverage checks; transactional paid portrait creation, upload association and replay/rollback protection.
- Additive forward migration, generated schema/types and preservation of reserved template previews.
- Focused mocked tests, TypeScript, changed-file lint and production build; operational documentation and project status.

## Out of scope

Public checkout replacement, preview payment button, artist workbench/email presentation expansion, new payment providers, postage rating, production launch, final destination/policy approvals and production assets.

## Acceptance

1. Legacy checkout remains operational and cannot begin a new payment for a portrait cart.
2. Reject incomplete/malformed/mixed carts, unavailable templates and missing policy acceptance before provider work.
3. Server-owned prices, countries and shipping remain fixed across uncertain retries with the original attempt.
4. Reservation blocks draft mutation and changed shipping-region retries.
5. Fulfillment verifies frozen country/region and amounts, creating every portrait and associating its uploads with one Order.
6. Replay/concurrency and rollback do not duplicate or partially persist the paid graph, ledger or email jobs.
7. Catalog edits do not change reserved/paid snapshot text or replace/delete reserved preview media.
8. No credentials, private image URLs, subject names or notes enter Stripe metadata or public CRUD.

## Verification and provider authorization

Local edits, generated schema/type artifacts, focused mocked tests, TypeScript, ESLint and a production build are authorized. Migration apply and synthetic live database/Storage/Stripe/Resend fixtures need separate approval. No real payment/email, deployment or Git mutation. Preserve user-owned processes.

## Stop conditions

Ask before destructive schema/backfills, new dependencies, retention changes or expanding into the public rollout. A pending migration means new payment behavior is not operational yet; report that explicitly. Stop task-created processes and do not stage, commit or push.
