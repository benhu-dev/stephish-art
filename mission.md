# Phase 2 — Unit 2.14.2: Card-Only Checkout Without Link

## Goal

Remove Stripe Link and the Link-provided Bank and Klarna options from newly created Stripe-hosted Checkout Sessions.

Continue supporting:

- Standard credit and debit cards
- Apple Pay when supported
- Google Pay when supported

Do not redesign Checkout or change any monetary, shipping, fulfillment, or recovery behavior.

## Baseline

- Units 2.14 and 2.14.1 are committed at the current HEAD.
- The working tree must be clean except for the intentional `mission.md` modification.
- Stripe remains in Sandbox/Test mode.
- `.env.local` must not be printed or modified.

Record starting HEAD and concise Git status. Stop on unrelated changes.

Inspect only the Stripe Checkout gateway/session parameter builder and its directly related focused tests.

## Stripe Session Contract

For every newly created Checkout Session, preserve the existing explicit card configuration and add:

```ts
wallet_options: {
  link: {
    display: 'never',
  },
}
```

The final relevant contract must include:

```ts
payment_method_types: ['card']
```

and:

```ts
wallet_options: {
  link: {
    display: 'never',
  },
}
```

This must prevent newly created Sessions from displaying:

- Link
- Link Instant Bank Payment
- Link promotional bank cashback
- Klarna through Link
- Link payment-information saving

Do not disable standard card wallets. Apple Pay and Google Pay may still appear when Stripe determines the browser, device, domain, and customer are eligible.

Do not add Klarna, Affirm, Afterpay, Cash App, ACH, bank debit, bank transfer, or any other payment method.

## Preserve Existing Checkout Behavior

Do not change:

- USD
- Customer creation
- Amount or minimum validation
- Fixed shipping fee
- US-only shipping address collection
- Success or cancel URLs
- Identifier-free redirects
- Idempotency
- Checkout reservation/finalization
- Recovery and abandonment
- Webhook fulfillment
- Saved-payment settings
- Tax, invoice, promotion-code, or discount settings
- Session expiration
- Metadata
- Logging or safe responses

Existing Stripe Sessions are immutable and may continue showing Link. Only newly created Sessions must use the new configuration.

## Focused Verification

Add or update focused tests proving:

1. Exact `payment_method_types: ['card']`.
2. Exact `wallet_options.link.display: 'never'`.
3. No Link, Klarna, bank, BNPL, or alternative payment type is requested.
4. All existing amount, shipping, address, Customer, URL, idempotency, metadata, tax, invoice, discount, and saved-method parameters remain unchanged.
5. Reused Sessions are not recreated.
6. No payment configuration is accepted from the browser.
7. No secret, Session ID, URL, or customer data is logged or returned beyond the existing safe response.

Run one isolated Stripe Sandbox lifecycle:

- Create a unique synthetic Intent using the existing test harness.
- Create one new Checkout Session.
- Retrieve it from Stripe.
- Confirm Test mode, `payment_method_types` contains only `card`, and the Session was created with Link disabled.
- Confirm the existing subtotal, fixed shipping, total, Customer creation, and US shipping behavior are unchanged.
- Do not complete payment.
- Expire the synthetic Session.
- Remove only task-created database and Storage fixtures.
- Preserve all user-owned data.

## Validation

Run only:

- Focused Stripe Checkout gateway/session tests
- Directly affected checkout-session regression tests
- One isolated Stripe Sandbox create/retrieve/expire lifecycle
- TypeScript
- ESLint
- One production build
- `git diff --check`

Do not run:

- Real payment
- Stripe CLI webhook delivery
- Full acceptance suite
- Webhook concurrency/replay matrix
- Storage or preview lifecycle
- Scene or full viewport regression
- GraphQL/access matrix
- Migration generation
- Dependency audit

## Manual Acceptance

Report that manual verification requires a newly created order.

Resuming a Checkout Session created before this Unit may still show Link.

For a new Sandbox order, Stripe Checkout should show:

- Card entry
- Apple Pay when eligible
- Google Pay when eligible
- Existing shipping address and fixed shipping charge

It must not show:

- Link
- Bank cashback
- Klarna

## Excluded Work

Do not implement:

- Dashboard-wide payment-method changes
- Dynamic shipping
- Tracking
- Tax
- Email
- Intent cleanup
- Real payment
- Webhook changes
- Schema or migrations
- Dependencies
- Environment changes
- Frontend redesign
- Unit 2.15

Do not modify `AGENTS.md`. Do not commit or push.

## Completion Report

Report:

- `COMPLETE` or `BLOCKED`
- Starting and ending HEAD
- Final Stripe payment-method contract
- Focused test and Sandbox lifecycle evidence
- Confirmation that shipping and existing Checkout behavior were unchanged
- Starting/final database and Storage counts
- Files changed and final Git status
- Confirmation that no real payment, webhook, cleanup, shipping, tracking, tax, email, schema, migration, dependency, environment, Dashboard, or unrelated UI change was introduced