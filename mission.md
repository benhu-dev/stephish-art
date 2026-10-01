# Phase 2 — Unit 2.19: Stripe Refund and Dispute Reconciliation

## Outcome

Keep an existing paid Order synchronized with authoritative Stripe refund and dispute state.

This Unit observes Stripe activity only. Refunds and dispute responses remain initiated manually in Stripe. Do not add an Admin UI, storefront refund endpoint, automatic refund, shipment workflow, or new email.

## Required behavior

1. Extend the existing signed Stripe webhook handler to support only:

   - `refund.created`
   - `refund.updated`
   - `refund.failed`
   - `charge.refunded`
   - `charge.dispute.created`
   - `charge.dispute.updated`
   - `charge.dispute.closed`

2. Preserve the existing raw-body limit, signature verification, generic responses, event ledger, Test-mode restrictions, and ignored-event behavior.

3. Never trust the event snapshot alone. Retrieve the current Stripe Refund, Charge, PaymentIntent, or Dispute as required and verify that it belongs to the exact stored paid Order.

4. Perform all Stripe calls outside database transactions.

5. Add only the minimum Order reconciliation fields required to represent:

   - refunded amount in integer cents;
   - refund state: `none`, `partial`, or `full`;
   - current Stripe dispute status;
   - optional internal Stripe dispute identifier if required for reconciliation.

6. Monetary invariants:

   - refunded amount must be between zero and the Order total;
   - only successful refunds count toward the refunded amount;
   - multiple partial refunds must converge on the authoritative aggregate;
   - failed or pending refunds must never erase an earlier successful refund;
   - a full refund must not delete the Order, Customer, uploads, or private Storage objects.

7. Use a short locked transaction to update the Order and Stripe Event ledger atomically.

8. Replay, concurrency, duplicate delivery, and out-of-order delivery must converge on one correct Order state without creating another Order, Customer, upload association, or email job.

9. Unknown Orders, mismatched Stripe objects, live-mode objects, invalid monetary state, or unverifiable ownership must be rejected safely without Order mutation.

10. A dispute must update the stored dispute status but must not automatically refund, delete, email, or alter fulfillment data.

11. Existing paid-order cleanup protection must remain unchanged. Refunded or disputed Orders and their uploads remain protected.

12. Store and log no webhook body, customer PII, shipping address, email content, Storage key, signature, secret, or provider response.

## Acceptance

Cover at minimum:

- partial refund;
- multiple partial refunds;
- full refund;
- failed refund after a successful refund;
- duplicate and out-of-order events;
- concurrent delivery;
- dispute created, updated, won, and lost;
- unknown and mismatched payment objects;
- transaction rollback;
- event-ledger replay;
- unchanged Order/Customer/upload/email counts;
- anonymous REST and GraphQL access denial for new fields;
- one isolated Stripe Sandbox refund lifecycle;
- schema migration, generated Payload types, TypeScript, changed-file ESLint, production build, and diff check.

Use focused tests only. Do not run scene, viewport, full browser, Resend, cleanup, or unrelated storefront suites.

## Boundaries

Do not introduce:

- refund initiation APIs;
- Admin Dashboard work;
- customer refund emails;
- automatic shipment cancellation;
- dispute evidence submission;
- public payment identifiers;
- new dependencies;
- live-mode activity;
- unrelated frontend changes.

Do not commit or push. Preserve user-owned changes and report the starting and ending HEAD.