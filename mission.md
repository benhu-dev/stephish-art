# Phase 2 — Unit 2.14.1: Checkout Cancellation and Recovery

## Goal

Fix the post-Stripe cancellation dead end without weakening the existing payment lock.

A customer whose Intent is `checkout_pending` or `checkout_created` must no longer be sent into the editable Amount step and trapped by repeated `409 Conflict` responses.

Provide two explicit choices:

- Resume Secure Checkout
- Start a New Order

Returning home alone must not cancel, delete, or mutate the existing checkout.

## Baseline

- Unit 2.14 changes are intentionally present and uncommitted.
- Preserve all current Unit 2.14 files and the intentional `mission.md` modification.
- The existing Checkout Session endpoint, cookie authentication, webhook fulfillment, status endpoint, cancelled page, and artistic modal remain authoritative.
- `.env.local` must not be printed or modified.
- Record starting HEAD and concise Git status. Stop on unrelated changes.

Inspect only the directly relevant checkout-session service, Intent endpoint/state handling, cancelled-page actions, modal hydration, checkout clients, and focused tests.

## Recovery State

When the authenticated current Intent is `checkout_pending` or `checkout_created`, the modal must not show the editable Amount step.

Show a small artistic recovery view consistent with the existing 2.5D hand-drawn modal:

- Heading: `Your checkout is ready`
- Concise explanation that the customer can continue or start over
- Primary action: `Resume Secure Checkout`
- Secondary action: `Start a New Order`
- Normal modal close behavior

Do not expose IDs, Stripe state, URLs, credentials, timestamps, or internal error details.

If the Amount request returns `409`, reconcile through the existing authenticated current/status contract and enter the recovery view when appropriate. Do not blindly treat every `409` as recoverable checkout state.

Preserve the cancelled-page heading `Payment not completed`.

The cancelled page should provide:

- Resume Secure Checkout
- Start a New Order
- Return Home

Returning Home performs navigation only. It must not abandon or delete anything.

## Resume Checkout

Reuse the Unit 2.14 checkout-session client and existing endpoint.

Resume must:

- Remain single-flight
- Reuse the existing server-side Checkout Session/idempotency behavior
- Validate the Stripe URL exactly as Unit 2.14 already does
- Redirect with `window.location.assign`
- Preserve safe pending, abort, error, and retry behavior

If the Session is already completed, use the existing safe status flow and send the customer to `/checkout/success`.

If the Session is expired or cannot be resumed, keep the customer in recovery and offer Start a New Order. Do not loop requests.

## Explicit Abandon Endpoint

Add:

```text
POST /api/storefront/checkout-intents/current/abandon
```

Request contract:

```json
{}
```

Requirements:

- Existing HttpOnly Checkout Intent cookie only
- Same-origin enforcement
- `Content-Type: application/json`
- Exact empty JSON object
- No query authorization
- No files or extra fields
- `Cache-Control: no-store`
- Generic safe errors
- `204 No Content` on successful abandonment

The endpoint applies only to an authenticated non-completed checkout with an existing Checkout Session recovery state.

## Safe Stripe Abandonment

Do not hard-delete the Intent.

For an explicit Start a New Order request:

1. Authenticate the cookie and identify the current Intent through existing trusted helpers.
2. Retrieve the latest Stripe Test-mode Checkout Session outside any database transaction.
3. If it is `complete` or paid, do not abandon it. Preserve fulfillment authority and direct the client through the existing success/status flow.
4. If it is `open`, expire it through Stripe.
5. If it is already `expired`, treat that as safe to finalize locally.
6. Only after Stripe confirms the Session cannot accept payment, use a short database transaction with an owning-row lock.
7. Revalidate that webhook fulfillment has not completed the Intent.
8. Mark the Intent `expired` using the existing schema and preserve its existing deletion policy.
9. Leave its upload rows and private Storage objects attached for the future cleanup job.
10. Clear `stephish_checkout_intent` using the exact original cookie path and security attributes.
11. Return `204`.

Never hold a database transaction open during a Stripe network call.

If Stripe retrieval or expiration fails or is ambiguous:

- Do not clear the cookie
- Do not mark the Intent expired
- Do not create a new Intent
- Return a safe retryable failure

If Stripe expiration succeeds but local finalization initially fails, a deliberate retry must reconcile the already-expired Session and finish safely.

Webhook-completed state always wins over abandonment.

## Start-Over Client Behavior

Require an inline artistic confirmation before abandoning:

`Starting over will close this payment session. Your current uploads and note will no longer be available.`

Do not use a native browser confirmation dialog.

After successful `204`:

- Clear the modal’s local amount, upload, preview, note, Review, checkout, and error state
- Abort obsolete requests
- Revoke blob URLs
- Return to the Amount step
- Do not create a new Intent yet
- Create the new Intent only when the customer submits a new valid amount

On the cancelled page, successful abandonment should return to `/` without identifiers. The next amount submission creates the new Intent.

On failure, retain the current recovery state and allow a deliberate retry.

## Expired and Unauthorized Recovery

Fix the current dead end for `410` followed by `401`.

When the server authoritatively reports an expired or invalid checkout:

- Remove stale client checkout state
- Show clear non-technical guidance
- Allow the customer to return to a fresh Amount step when the protected cookie has been cleared
- Do not repeatedly retry an unauthorized request
- Do not claim that merely closing the modal starts over

Preserve the rule that a valid `checkout_created` Intent cannot be edited.

## Focused Coverage

Add focused red-first tests for:

1. `checkout_created` hydration opens recovery instead of Amount.
2. Amount `409` reconciles into recovery.
3. Resume reuses the exact existing checkout-session request and navigates once.
4. Return Home makes no mutation request.
5. Start New Order requires inline confirmation.
6. Exact abandon request contract.
7. Open Stripe Session is expired before local state and cookie clearing.
8. Already-expired Session reconciles successfully.
9. Paid/complete Session cannot be abandoned.
10. Stripe failure preserves Intent and cookie.
11. Local finalization retry reconciles an already-expired Stripe Session.
12. Webhook completion wins the race.
13. Success resets all modal client state and allows a new Intent.
14. Expired/unauthorized state does not enter a request loop.
15. No Intent, upload, Storage object, Stripe identifier, URL, credential, or PII leaks to UI or logs.

Use unique synthetic fixtures only. Do not access, alter, expire, or delete the user’s existing Intent or Stripe Session.

## Focused Validation Only

Run:

- New recovery/abandon tests
- Directly affected Unit 2.14 client and cancelled-page tests
- One focused mocked browser recovery check
- One focused Stripe Sandbox lifecycle: create an isolated Session, abandon it, confirm it is expired, then clean synthetic database and Storage fixtures
- TypeScript
- ESLint
- One production build
- `git diff --check`

Do not run the full acceptance suite, real payment, Stripe CLI webhook matrix, scene regression, full viewport matrix, GraphQL matrix, dependency audit, migration generation, or unrelated Storage/preview lifecycles.

## Excluded Work

Do not implement:

- Hard deletion of abandoned Intents
- The scheduled cleanup job
- Link/payment-method changes
- Shipping or tracking changes
- Email
- Refunds or disputes
- Live-mode payments
- Schema or migration changes
- Dependency or environment changes
- Visual redesign
- Unit 2.15

Do not modify `AGENTS.md`. Do not commit or push.

## Completion Report

Report:

- `COMPLETE` or `BLOCKED`
- Starting and ending HEAD
- Recovery, resume, abandon, cookie-clearing, and race behavior
- Stripe Sandbox expiration evidence
- Focused validation results
- Starting/final synthetic database and Storage counts
- Files changed and final Git status
- Confirmation that the user’s existing Intent and Stripe Session were untouched
- Confirmation that no hard deletion, cleanup job, payment-method, shipping, tracking, email, schema, migration, dependency, environment, real payment, or unrelated UI change was introduced