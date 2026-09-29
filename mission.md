# Phase 2 — Unit 2.17: Email Outbox Delivery

## Goal

Deliver the two Email Outbox jobs created during paid Stripe fulfillment:

1. Customer order confirmation
2. Artist new-order notification

Use Resend with reliable retries and duplicate protection. Normal paid orders should attempt delivery immediately after fulfillment. A protected Vercel Cron route provides fallback processing.

Complete Unit 2.17 only. Do not implement shipping updates, tracking emails, refunds, marketing email, Resend webhooks, bounce handling, or deployment.

## Starting contract

Unit 2.16 already atomically creates exactly two Email Outbox jobs for each newly fulfilled Order. Replays do not create duplicates.

Existing environment is configured locally:

- RESEND_API_KEY
- EMAIL_FROM
- EMAIL_REPLY_TO
- ARTIST_ORDER_EMAIL
- EMAIL_DELIVERY_ENABLED
- CRON_SECRET

Do not print, rewrite, expose, or commit `.env.local` or secret values.

## Required behavior

### 1. Environment and provider

- Keep all Resend credentials server-only.
- Parse `EMAIL_DELIVERY_ENABLED` strictly.
- When delivery is disabled, do not contact Resend or mutate jobs as sent.
- Missing or invalid required delivery configuration must fail safely with no secret exposure.
- Use Resend’s HTTPS API directly unless the official SDK is clearly necessary.
- Do not add a general email framework or unrelated dependency.
- Set one stable Resend idempotency key per Email Outbox job.
- Never reuse one idempotency key across the two job kinds.

### 2. Email content

Create both plain-text and responsive HTML versions.

Customer confirmation:

- Recipient comes only from the immutable paid Order snapshot.
- Subject: `Your postcard order is confirmed`
- Include customer name, subtotal, shipping, total, shipping destination, reference-photo count, and artist note when present.
- Explain that the artwork will be prepared and another update can be sent after shipment.
- Reply-To uses `EMAIL_REPLY_TO`.

Artist notification:

- Recipient comes only from `ARTIST_ORDER_EMAIL`.
- Subject: `New paid postcard order`
- Include customer name/email, shipping destination, subtotal, shipping, total, reference-photo count, and artist note when present.
- Do not attach photos or expose Storage URLs.
- Mention that full private order details and uploads are available in the authenticated Payload admin.

For both:

- Escape all user-controlled values.
- Do not include Stripe IDs, Checkout Intent IDs, cookies, access tokens, Storage keys, signed URLs, webhook data, or secrets.
- Do not use remote tracking images.
- Keep styling aligned with the existing warm postcard/art direction, but keep email markup simple and broadly compatible.

### 3. Reliable outbox processor

Implement a bounded processor that:

- Loads authoritative Order data only after claiming an eligible job.
- Uses row locking or an equivalent atomic claim so concurrent runs cannot intentionally send the same job.
- Never calls Resend inside a database transaction.
- Marks a job sent only after Resend accepts it.
- Stores only necessary provider/reconciliation metadata.
- Increments attempts and records a safe failure classification without storing raw provider bodies or PII.
- Returns retryable jobs to an eligible state with bounded backoff.
- Stops retrying after a reasonable maximum and marks the job terminally failed.
- Recovers stale processing leases.
- Processes a small bounded batch per invocation.
- Treats already-sent jobs as terminal.
- Uses the existing schema where sufficient. If lease/retry fields are missing, add only the minimum required fields and one reviewed migration.

Resend idempotency is an additional safeguard, not a replacement for database concurrency control. Resend idempotency keys expire after 24 hours, so database state remains authoritative.

### 4. Immediate delivery

After a newly paid fulfillment transaction commits:

- Attempt delivery only for that Order’s two Outbox jobs.
- Perform email delivery outside the fulfillment transaction.
- Email failure must not roll back or invalidate a successfully paid Order.
- Preserve the existing safe Stripe webhook acknowledgement behavior.
- Webhook replay must not create or resend completed jobs.
- Do not delay the checkout success status on email delivery.

### 5. Fallback entrypoints

Add:

- A one-shot CLI command for local/manual processing.
- A protected internal Vercel Cron route using the existing exact Bearer `CRON_SECRET` contract and timing-safe comparison.
- Safe aggregate JSON output only: scanned, sent, retried, failed, skipped.
- No recipient, subject, body, provider ID, Order ID, or error body in route responses or logs.

Add one daily fallback schedule compatible with Vercel Hobby. Immediate post-webhook delivery remains the primary path; the daily job only recovers failures/stale jobs.

Ensure CLI and route processes terminate naturally and do not leak Payload/PostgreSQL handles.

### 6. Access and privacy

- Email Outbox remains administrator-read-only through Payload.
- No public endpoint may trigger arbitrary email or choose a recipient.
- Cron requests with missing/invalid authorization perform no work.
- Reject query-string overrides.
- Never log recipients, addresses, notes, email bodies, Resend responses, secrets, or PII.
- Do not expose delivery state through storefront APIs.

### 7. Tests

Add focused tests for:

- Exact customer and artist recipients
- HTML/text template escaping
- Exact monetary and shipping rendering
- Artist note present/absent
- Stable distinct idempotency keys
- Successful state transition
- Transient retry and terminal failure
- Disabled/missing configuration
- Concurrent claims
- Stale lease recovery
- Already-sent replay
- Immediate post-fulfillment attempt outside the transaction
- Provider failure preserving the paid Order
- Cron authorization and safe output
- CLI natural exit

Run one isolated real Resend test using synthetic data:

- Send exactly one customer confirmation and one artist notification to the configured test addresses.
- Use clearly marked test subjects if necessary.
- Do not perform a real or Stripe Sandbox payment solely for this test.
- Remove only uniquely identified synthetic database fixtures afterward.
- Email messages already accepted by Resend cannot be deleted; report their final provider status without printing provider IDs.

## Validation

Keep validation focused:

1. Red-first focused tests
2. Focused Email Outbox/provider tests
3. Isolated database lifecycle
4. One authorized real Resend two-email test
5. TypeScript
6. Changed-file ESLint
7. One production build
8. `git diff --check`

Do not run full scene, upload, Storage, Stripe Sandbox, viewport, or broad acceptance suites unless a changed dependency requires them.

## Excluded

Do not add:

- Shipment or tracking email
- Refund/dispute email
- Marketing/unsubscribe systems
- Resend inbound email or webhooks
- Bounce/complaint processing
- Attachments or public upload links
- Admin dashboard redesign
- Customer accounts
- Deployment
- Live Stripe payment
- Unrelated refactors

## Repository rules

- Inspect starting HEAD and working tree first.
- Preserve `mission.md` and all user-owned changes.
- Do not modify `.env.local`.
- Update `.env.example` with safe placeholders only.
- No commit or push.
- Stop task-created servers and browser processes.
- Report starting/ending HEAD, changed files, validation, real-email count/status, database cleanup, security review, and remaining limitations.