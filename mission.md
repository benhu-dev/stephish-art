# Phase 2 — Unit 2.20.1: Customer Shipment Email

## Outcome

When an administrator successfully moves an Order into `shipped` for the first time, transactionally enqueue exactly one customer shipment email and attempt delivery only after the fulfillment transaction commits.

Preserve the existing reliable Email Outbox architecture and retry behavior.

## Required behavior

1. Add one Email Outbox kind:

   `customer_shipped`

2. Enqueue exactly one `customer_shipped` job inside the same locked transaction that performs:

   `ready_to_ship` → `shipped`

3. If outbox insertion fails, roll back both the fulfillment transition and job creation.

4. Attempt email processing only after the transaction commits.

5. A provider timeout or failure after commit must not undo the shipped Order. Leave the job retryable through the existing processor, CLI, and cron.

6. Same-state retries, duplicate requests, concurrent transitions, worker retries, and provider retries must never create or deliver more than one logical shipment email.

7. Do not backfill historical shipped Orders.

8. Send only to the immutable customer email snapshot associated with the Order. Do not use browser-supplied recipient data.

9. Subject:

   `Your postcard is on its way`

10. Provide escaped HTML and plain-text versions containing:

   - a friendly shipment confirmation;
   - the carrier when present;
   - the tracking number when present;
   - a safe tracking link for supported carriers;
   - the shipped date formatted using `America/New_York`;
   - existing reply-to behavior.

11. Generate tracking links server-side only:

   - use HTTPS;
   - allow only approved USPS, UPS, and FedEx hosts;
   - encode the normalized tracking number;
   - never accept or store a client-provided tracking URL;
   - `other` carrier receives no clickable tracking URL.

12. If carrier and tracking are absent, send a valid shipment email without an empty tracking section or broken link.

13. Tracking information used by the email must match the final values committed with the shipment transition.

14. Do not include:

   - internal Order, Customer, Intent, upload, Stripe, dispute, or outbox IDs;
   - payment identifiers;
   - private Storage links or attachments;
   - artist notes;
   - webhook data;
   - secrets or signatures.

15. Existing customer-confirmation and artist-new-order email behavior must remain unchanged.

16. No shipment email is created for `unfulfilled`, `in_progress`, `ready_to_ship`, or `delivered`.

## Acceptance

Cover at minimum:

- exactly one job on the first shipped transition;
- no job before shipped or on delivered;
- transaction rollback when enqueueing fails;
- post-commit delivery attempt;
- provider failure preserving the shipped Order and retryable job;
- duplicate, concurrent, same-state, worker, and webhook-style replay behavior;
- stable and distinct provider idempotency key;
- tracked USPS, UPS, and FedEx templates;
- `other` carrier without a link;
- shipment without tracking;
- HTML/text escaping;
- New York shipped-date formatting across DST;
- immutable recipient selection;
- no private identifiers, attachments, or Storage links;
- existing two email kinds unchanged;
- anonymous access denial;
- migration and unique-index behavior;
- isolated database lifecycle with exact baseline restoration;
- TypeScript, changed-file ESLint, one production build, and diff check.

A single real Resend acceptance email may be sent only to the configured user-owned test inbox if delivery is enabled. Do not resend it. If configuration is unavailable, use the provider mock and report that the real send was skipped.

Use focused tests only. Do not run Stripe, browser, scene, viewport, Storage, cleanup, or full regression suites.

## Boundaries

Do not add:

- custom Admin UI;
- artist shipment email;
- delivered email;
- refund email;
- public tracking endpoint;
- carrier API calls or delivery polling;
- label purchasing;
- attachments;
- new dependencies or environment variables;
- unrelated storefront changes.

Do not commit or push. Preserve user-owned changes and report the starting and ending HEAD.