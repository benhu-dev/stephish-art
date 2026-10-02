# Phase 2 — Unit 2.20: Order Fulfillment and Tracking Foundation

## Outcome

Add a secure, administrator-only backend workflow for moving a paid Order through production and shipping states while recording optional carrier tracking information.

Do not build a custom Admin Dashboard or send shipment email in this Unit.

## Required behavior

1. Inspect the existing Order schema and reuse compatible fields. Do not create duplicate payment, shipping-address, refund, or dispute fields.

2. Add a fulfillment state independent from payment/refund state:

   - `unfulfilled`
   - `in_progress`
   - `ready_to_ship`
   - `shipped`
   - `delivered`

3. New paid Orders begin as `unfulfilled`.

4. Allow only these forward transitions:

   - `unfulfilled` → `in_progress`
   - `in_progress` → `ready_to_ship`
   - `ready_to_ship` → `shipped`
   - `shipped` → `delivered`

5. Same-state retries with identical data must be idempotent. Reverse transitions, skipped states, conflicting retries, and terminal-state changes must be rejected.

6. Add only the minimum shipping fields required:

   - carrier: `usps`, `ups`, `fedex`, or `other`;
   - normalized tracking number;
   - server-authored shipped timestamp;
   - server-authored delivered timestamp.

7. Carrier and tracking number are optional, but they must be supplied together. Do not accept or persist client-provided tracking URLs.

8. Tracking data may be added or corrected only before the first successful transition to `shipped`. After shipment it becomes immutable.

9. Add a controlled administrator endpoint:

   `PATCH /api/admin/orders/:orderId/fulfillment`

   It must require the existing authenticated Payload administrator session, same-origin requests, JSON content type, no query parameters, and an exact request shape containing expected current state, requested next state, and optional tracking data.

10. Use a short PostgreSQL transaction with a row lock. The expected current state must prevent stale or concurrent updates. Return a safe conflict response when another transition wins.

11. The server—not the browser—sets `shippedAt` and `deliveredAt` in UTC.

12. Before advancing fulfillment, require an existing paid Order. Block new forward transitions when:

   - the Order is fully refunded;
   - an active or lost Stripe dispute makes fulfillment unsafe;
   - payment/order state is inconsistent.

   A partial refund or a dispute resolved as won may continue.

13. Never modify payment snapshots, Customer data, address snapshots, amount fields, uploads, Stripe identifiers, refund totals, dispute history, or existing email jobs.

14. New fields must remain unavailable to anonymous REST and GraphQL writes. No public storefront endpoint may expose fulfillment or tracking data.

15. Logs and responses must not contain customer PII, shipping addresses, artist notes, upload metadata, payment identifiers, or complete request bodies.

## Acceptance

Cover at minimum:

- exact transition matrix;
- same-state idempotency;
- reverse, skipped, stale, and concurrent transitions;
- administrator authentication and same-origin enforcement;
- malformed ID, query, content type, and body rejection;
- tracking normalization and carrier/tracking pairing;
- tracking immutability after shipment;
- server-authored UTC timestamps;
- full-refund and dispute blocking;
- partial-refund and won-dispute continuation;
- immutable financial/customer/upload fields;
- transaction rollback;
- anonymous REST and GraphQL denial;
- no Stripe, Resend, Storage, or email-outbox side effects;
- isolated database lifecycle with exact baseline restoration;
- migration, generated Payload types, TypeScript, changed-file ESLint, one production build, and diff check.

Use focused tests only. Do not run Stripe Sandbox, Resend, browser, scene, viewport, Storage lifecycle, cleanup, or full regression suites.

## Boundaries

Do not add:

- custom Admin UI;
- customer-facing tracking endpoints;
- shipment email;
- carrier APIs or automatic delivery polling;
- label purchasing;
- shipment cancellation;
- automatic refunds;
- dependencies or environment variables;
- unrelated frontend changes.

Do not commit or push. Preserve user-owned changes and report the starting and ending HEAD.