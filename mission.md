# Phase 3 - Unit 3.6.2: Checkout Rollout and Minimum Artist Workbench

## Outcome

Connect the accepted portrait modal to payment, add safe cancellation/recovery and complete authenticated per-portrait artist visibility. Prepare the homepage switch behind a default-off server rollout gate; enable it only after explicitly authorized live lifecycle and user acceptance.

## Confirmed decisions

- Preserve Unit 3.6.1 prices, once-per-order US/international shipping, frozen payment snapshots, cookie authority, card-only Sandbox payments and verified webhooks.
- Recover drafts without querying Stripe on modal open. An active payment attempt may be resumed, not edited; start-over must expire it safely.
- Legacy drafts/payments remain recoverable during transition. Never overwrite a legacy or portrait draft without explicit confirmation.
- Uncertain payment requests require state read-back before another action; no automatic payment mutation retries.
- Every paid portrait must show its immutable design, subjects, mapped private references, note and price in the artist workbench.
- Preserve fulfillment, tracking, refund/dispute restrictions and legacy Order visibility. Do not invent production deadlines.
- Homepage rollout is gated by server-only PHOTO_BOOTH_PORTRAIT_CHECKOUT_ENABLED, default false. Never edit .env.local or enable production deployment here.
- Development preview remains available only in development; it can exercise the connected flow when the same rollout gate is explicitly enabled.

## Scope

Narrow read-only cookie-authorized recovery contract; browser payment/recovery states and clear totals/policy; default-off homepage switch; authenticated paid-template preview and grouped artist reference presentation; focused tests, local mocked browser checks, TypeScript, changed-file ESLint, production build and acceptance documentation.

## Out of scope

New schemas/migrations, provider/deployment changes, live payment/Storage/Resend fixtures without separate approval, production launch, broad email redesign, final destination/policy approvals, deadlines, navigation/brand expansion and unrelated visual changes.

## Acceptance

1. Default gate preserves legacy homepage checkout; enabled gate opens the portrait flow at every existing purchase trigger.
2. Complete carts with accepted policy can request server-priced Checkout; incomplete carts cannot. Shipping is shown once and Stripe confirms the authoritative total.
3. Refresh/reopen differentiates fresh, portrait/legacy draft, pending/created payment, completed and expired states; active attempts are never editable.
4. Retry after uncertain payment first reads current state. Resume uses frozen payment facts; abandon confirmation uses existing safe expiration and preserves paid work.
5. Artist sees up to five paid portraits and fifteen references grouped by portrait, including group-photo subject names, independent notes, immutable template preview and price.
6. Private template/reference bytes require artist authentication and ownership checks, bypass public image optimization and remain no-store.
7. Legacy orders, old payment recovery and fulfillment restrictions remain intact.
8. Desktop/mobile/day/night/keyboard/reduced-motion review has no material defects.
9. Actual PostgreSQL/Storage/Stripe Sandbox lifecycle plus user acceptance must pass before enabling homepage rollout; report NOT RUN until separately authorized.

## Verification and provider authorization

Local edits, focused mocked tests, TypeScript, lint, build and isolated local browser fixtures are authorized. Do not mutate live database/Storage/Stripe/Resend, send payment/email, change environment values, deploy or perform Git writes. Read-only provider checks only when necessary; live acceptance needs explicit separate approval. Preserve user-owned processes and stop task-created servers/tabs.

## Stop conditions

Ask before schema/dependency/retention/payment-policy changes or live-provider fixtures. Do not enable rollout while required real lifecycle/user acceptance is outstanding. Report the gate and remaining acceptance clearly.
