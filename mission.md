# Phase 2 — Unit 2.16.1: Repeat-Customer Fulfillment Recovery

## Goal

Allow the same guest customer to place unlimited paid orders, even when Stripe creates a different Customer ID for each Checkout Session. Recover the already-paid rejected order for Checkout Intent 332 without manual database edits or duplicate records.

## Observed production-like Sandbox case

- Event: evt_1UKSAU3vSPVBZHiNjYbsbRNC
- Checkout Intent: 332
- Event type: checkout.session.completed
- Stripe status: complete
- Payment status: paid
- The normalized email matches the customer created by the first successful order.
- Stripe created a different Customer ID for the second Checkout Session.
- The webhook returned 200 but recorded the event as rejected.
- No Order or Email Outbox jobs were created for Intent 332.

Confirm the exact rejection branch in the existing fulfillment code before changing it.

## Required behavior

1. A normalized email identifies and reuses the existing local Customer.
2. The same local Customer may own unlimited Orders.
3. A different Stripe Customer ID must not reject an otherwise valid paid Checkout Session.
4. `stripeCustomerId` remains optional:
   - Set it when creating a new local Customer.
   - Populate it when the existing Customer has no value.
   - If the existing value differs, preserve the existing value and continue fulfillment.
   - Never use it as customer authentication or as a prerequisite for Order creation.
5. Continue retrieving the authoritative Stripe Session before fulfillment.
6. Preserve every existing validation for:
   - Test mode
   - Event and Session type
   - Intent and checkout-attempt ownership
   - Currency and exact amounts
   - Paid/complete status
   - Shipping details
   - Required customer name and normalized email
7. A previously rejected event may be re-evaluated when Stripe resends it:
   - Lock the existing event/Intent records.
   - Re-run all authoritative validations.
   - If now valid, atomically complete fulfillment and transition the existing ledger record to the successful state.
   - If still invalid, keep it rejected.
8. Replays and concurrent deliveries must remain idempotent:
   - Exactly one Order per Checkout Intent.
   - Exactly two Email Outbox jobs per Order.
   - No duplicate Customer, Order, upload association, or outbox job.
9. Do not manually delete or recreate the existing Stripe Event, Customer, Intent, upload, or Storage object.
10. Do not send email. Only create the two existing pending outbox jobs.

## Live recovery acceptance

After implementation, with the local Stripe listener using the current Sandbox context, resend:

stripe events resend evt_1UKSAU3vSPVBZHiNjYbsbRNC

Verify:

- Intent 332 becomes completed.
- The existing rejected Stripe Event becomes successfully processed.
- Exactly one new Order exists for Intent 332.
- The existing local Customer is reused.
- The Customer’s existing Stripe Customer ID is not overwritten.
- Exactly two pending Email Outbox jobs exist for the recovered Order.
- Existing uploads are associated with the recovered Order.
- Replaying the same event again creates nothing additional.
- The first successful Order remains unchanged.

## Tests

Add focused regression coverage for:

- Same normalized email with a different Stripe Customer ID.
- Existing Customer with a null Stripe Customer ID.
- Existing Customer ID preservation.
- Rejected-event recovery.
- Invalid rejected event remaining rejected.
- Duplicate and concurrent replay idempotency.
- Transaction rollback.

Run only:

- Focused fulfillment/webhook/outbox tests
- Focused database lifecycle
- TypeScript
- Changed-file ESLint
- One production build
- git diff --check

Do not run scene, viewport, Storage cleanup, full browser, or unrelated acceptance suites.

## Constraints

- No schema or migration unless inspection proves it unavoidable.
- No dependency or environment changes.
- No frontend changes.
- No Checkout Session parameter changes.
- No email provider or worker.
- No manual database repair.
- No live-mode Stripe activity.
- Do not print secrets, webhook payloads, addresses, or customer PII.
- Preserve mission.md and unrelated user changes.
- No commit or push.