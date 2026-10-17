# Unit 3.6.2 - Connected Checkout and Minimum Artist Workbench

## Current checkout entry

On 2026-10-17 the user reported successful manual acceptance, approved replacing the homepage purchase flow, and then explicitly authorized removing the rollout switch and old purchase UI. The homepage now always opens the connected portrait modal. `PHOTO_BOOTH_PORTRAIT_CHECKOUT_ENABLED` has been removed from application code and `.env.example`; any stale local/deployed value is ignored. No `.env.local` or deployed configuration was changed. The development-only `/checkout/preview` uses the same connected checkout and remains 404 in production.

The source cleanup is authorized; deployment, live Stripe keys and final production readiness are not part of this change. The original gate was used during acceptance and is no longer available for rollback. Unit 3.6.1 migration batch 19 must already be applied. Existing payment/webhook/refund, cancellation, expiration, private data and artist workbench services remain intact.

## Connected behavior

Default-switch verification (2026-10-17): PASS for all nine focused rollout/recovery/workbench tests, `npx --no-install tsc --noEmit`, ESLint on the changed rollout module and test, `npm run build`, and `git diff --check`. The new default first failed the focused assertion before implementation, then passed with unset/true/false/invalid override coverage. No new UI composition, provider calls, migrations, dependencies or task-created servers were introduced by this switch.

- Cart shows each saved portrait, one shipping charge and total. Complete design/photo coverage and policy acceptance are required before requesting Checkout. Stripe confirms the server-owned payable total and address countries.
- New fixed-price draft creation uses exact empty JSON at `POST /api/storefront/checkout-intents/portrait-draft`, with the existing same-origin, HttpOnly cookie and distributed intent-creation rate limit. It creates the server's 2000-cent bootstrap, does not inherit the legacy donation minimum and refuses to overwrite any existing credential-owned Intent.
- `GET /api/storefront/checkout-intents/current/cart/recovery` is a narrow, no-store, cookie-authorized and rate-limited read. It returns only status, legacy/portrait kind, reserved region and total; no Stripe retrieval, mutation, private cart snapshot, names or photos.
- Draft portrait carts resume from confirmed server state. Active payment attempts cannot be edited; the modal shows their frozen total, a resume action, and explicitly confirmed start-over. Completed payments link to the bounded read-only success page.
- Network/5xx/malformed payment results require explicit state read-back before another action. Requests are never automatically retried. Closing/aborting the modal does not imply provider cancellation.
- Confirmed abandonment locks/rechecks draft state, marks only an unpaid draft expired and leaves photos for existing cleanup timing. Active Stripe attempts use the existing safe expiration flow; paid work stays protected. Start-over does not purge private objects immediately or change retention.
- The old modal, amount/photo/review/recovery steps and dedicated CSS have been removed. `/checkout/legacy` redirects home instead of providing another purchase flow. Old unreserved drafts require explicit confirmed start-over in the new modal; they are never silently overwritten. Reserved/created payments still resume through the existing frozen Session service and the cancelled page; completed payments still link to order status. Historical Orders and backend compatibility services are unchanged.
- Artist-authenticated Orders now show up to five immutable portraits and fifteen references, grouped by portrait with template preview/name, named person/pet subjects, photo-to-subject labels, independent notes and prices. A missing/mismatched paid graph fails closed instead of showing partial references. Legacy Orders retain their previous presentation.
- New paid-template preview endpoint checks artist authentication and paid Order/portrait ownership, reads media through Payload access checks, verifies the private prefix/type/byte bound and streams no-store bytes. Hidden/unavailable current catalog entries do not hide immutable paid artwork. Private photos and templates bypass public image optimization. Fulfillment/refund/dispute authority is unchanged.

## Local verification

- Cleanup follow-up (2026-10-17): PASS for 59 focused tests covering the only supported modal, homepage composition, private previews, safe redirects, recovery/cancellation, policy/coverage gates, artist notes and legacy Orders. PASS for TypeScript, ESLint on changed handwritten files, production build and whitespace checks. Tests for retired UI components were migrated to the supported portrait equivalents rather than keeping dead components for tests. No live fixtures, browser/viewport run or provider checks were repeated for this cleanup. A quick manual homepage/recovery smoke check is recommended; prior payment acceptance is not invalidated.

- PASS: 61 focused payment/client/recovery/workbench/legacy/private-stream tests; focused final recovery/rollout coverage rerun after final state changes.
- PASS: `npx --no-install tsc --noEmit`, changed-file ESLint and final `npm run build`.
- PASS: isolated browser proxy blocks all real `/api` traffic. Checked enabled homepage entry, two portrait subtotal, US/international once-per-order rates, policy gating, uncertain payment locking/read-back, reserved total, explicit abandonment, fresh template state, desktop/day and 390x844/night layouts, keyboard operation and no horizontal overflow.
- Reviewed the approved typography, paper/ink palettes, hierarchy, spacing and existing reduced-motion rules. No new motion effects were added. OS-level reduced-motion emulation was not run.
- Artist grouping/escaping and all fifteen references were verified through mocked service and static-render tests. A real paid Order browser acceptance remains outstanding.
- PASS (user-authorized on 2026-10-12): real PostgreSQL/private Storage lifecycle, concurrent payment reservation, signed synthetic paid webhook fulfillment/replay, rollback after portrait/upload/outbox/ledger writes, five immutable portraits/fifteen mapped references, authenticated Payload HTTP template/photo streams, anonymous/cross-order denial and paid abandonment/removal protection.
- PASS: actual Stripe Sandbox Session creation/resume, single/multiple line items, US/international address restrictions and fixed shipping rates, region-change rejection and expiration. Exactly two real test Sessions were created and expired. Their fixture-only unrelated metadata deliberately prevented configured external webhook endpoints from creating late application fixture residue. This verifies provider parameters/lifecycle, not actual app-correlated card payment.
- NOT RUN: a user-completed Hosted Checkout test-card payment and Stripe-originated paid webhook, real artist browser acceptance, Resend delivery and production rollout. No migration, dependency or permanent environment/provider configuration changes in this Unit.

## Live fixture execution record

`node --import=tsx tests/integration/portrait-checkout-lifecycle.mjs http://127.0.0.1:3000` passed actual Sandbox Session checks but initially failed its paid-Order assertion because raw PostgreSQL `numeric` is a JavaScript string. Fixtures were completely cleaned. The test assertion was corrected to normalize that value; no runtime fix or weaker assertion was needed.

`node --import=tsx tests/integration/portrait-checkout-lifecycle.mjs http://127.0.0.1:3000 --skip-sandbox` then passed the remaining real database/Storage/signed-synthetic-webhook and authenticated HTTP checks. The flag avoided repeating already-passed provider operations. Paid Session retrieval in signed synthetic webhook tests is injected; this is not evidence of an actual Hosted Checkout payment.

Both executions restored exact baseline/final counts: Users 1, Customers 7, Orders 8, Order Portraits 0, Checkout Intents 10, Checkout Portraits 2, Order Uploads 15, Email Outbox 17, Stripe Events 8, Template Media 3, Postcard Templates 3. All 18 pre-existing Storage object keys/ETags were restored unchanged and no fixture object remained. Synthetic jobs were verified as exactly two pending jobs inside the business transaction, then marked non-deliverable before commit; no independent cron could observe deliverable fixture jobs. No real email was attempted. Stripe retains its two expired Sandbox Session records; no Session was paid. No credentials or provider/object identifiers are logged by the fixture.

## Remaining authorized-acceptance steps

Automated synthetic live checks above are complete. The user subsequently reported manual acceptance and approved the source-code default switch on 2026-10-17. Individual Hosted Checkout, email and artist-review checks were not independently observed by the agent; the historical NOT RUN entries above refer to agent-executed verification. The following checklist remains the reference for regression or production acceptance, not a claim that the agent executed every step:

1. For any additional fixtures/manual test Orders, record baseline counts and clean only uniquely identified test data afterward. Preserve pre-existing data; record final counts. Keep test email jobs non-deliverable before commit or use an explicitly approved isolated delivery-disabled test environment; do not assume suppressing immediate delivery also blocks cron.
2. Verify US $10 and non-US $5 with one and multiple portraits. Test country/rate mismatch rejection, all-subject coverage, draft locking and uncertain creation retry against real persistence.
3. User completes a Stripe Sandbox card payment; verify the signed webhook creates one Order, all portraits, photo mappings and outbox jobs. Verify duplicate/replayed delivery does not duplicate the graph. Never use a real card or live-mode key.
4. Test cancellation, Return Home, reopen/resume, refresh and confirmed start-over; confirm paid references cannot be abandoned/deleted.
5. Artist reviews the resulting Order: every portrait's design, subjects, notes and all mapped references are present; private previews/downloads work and anonymous/cross-order access fails. Confirm legacy Orders still display and fulfillment restrictions remain enforced.
6. Check desktop/mobile, day/night, keyboard/Escape and OS reduced-motion with the connected flow. Approve final UI and data visibility before enabling homepage rollout.

Final production country list, policy wording, artist production timing and production launch remain separate approvals.
