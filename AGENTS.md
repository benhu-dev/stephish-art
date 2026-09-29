# Stephish Art — Repository Instructions

## 1. Product and Current Direction

Stephish Art is a guest-checkout website for commissioning custom illustrated postcards.

The product has three layers:

1. A public 2.5D storytelling scene and artistic checkout modal.
2. A secure commerce backend built with Payload CMS, PostgreSQL, private object storage, Stripe, and Resend.
3. An artist-only operational interface, initially based on Payload Admin.

The delivery order is intentional:

1. Finish backend behavior, data integrity, security, and operations.
2. Build or refine the artist admin workflow.
3. Perform final public-facing UI polish shortly before release.

Do not begin custom dashboard work or broad visual redesign unless the active `mission.md` explicitly requests it.

The public visual direction remains:

- A fixed illustrated Manhattan park scene.
- A handcrafted instant-camera/postcard-machine centerpiece.
- Scroll-driven coin insertion and postcard printing.
- Deterministic reversible stages.
- Day/night presentation based on **New York time**, not the visitor's local time.
- `?theme=day` and `?theme=night` overrides for deterministic testing.
- Responsive desktop, portrait-mobile, and landscape-mobile behavior.
- A complete reduced-motion path.
- A consistent 2.5D, hand-drawn, editorial-art style across text, buttons, modal, and result pages.

Do not replace approved artwork, restructure the scene, add WebGL, add 360-degree interaction, or redesign the visual system without an explicit mission.

---

## 2. Current Architecture

Use the existing repository and installed versions as the source of truth.

Approved architecture:

- Next.js, React, and TypeScript.
- Payload CMS inside the existing Next.js application.
- PostgreSQL hosted by Supabase.
- Supabase Storage through the S3-compatible adapter for private `order-uploads` objects.
- Stripe Hosted Checkout for one-time USD payments.
- Verified Stripe webhooks as the only payment authority.
- Resend for transactional email delivery.
- Vercel as the intended application host.
- Focused acceptance and integration tests plus deliberate live Sandbox checks.

The browser must use controlled same-origin endpoints. It must never receive database credentials, object-storage credentials, Stripe secrets, Resend secrets, privileged Payload access, or direct authority over payment/order state.

Do not introduce Supabase Auth, direct browser database access, a second application backend, a second payment provider, or a public Storage bucket without an explicit architectural decision.

---

## 3. Accepted Baseline

The following capabilities are already implemented and must be preserved unless the active mission changes them.

### 3.1 Payload and data

- Payload Admin authentication exists.
- PostgreSQL migrations are tracked and applied intentionally.
- Public application tables use reviewed access controls and RLS posture.
- Core collections include Checkout Settings, Checkout Intents, Order Uploads, Customers, Orders, Stripe Events, and Email Outbox.
- Public generic REST/GraphQL writes to protected records are denied.
- Customer accounts do not exist; checkout is guest-only.

### 3.2 Checkout Intent boundary

- The browser is authorized only by the versioned HttpOnly Checkout Intent cookie.
- Checkout Intents are temporary server-authoritative drafts, not Orders.
- Amounts use integer cents with a configurable minimum, initially USD $5.00.
- One to three JPEG, PNG, or WebP reference photos are supported.
- Current limits are 15 MiB per file and 30 MiB total.
- Artist notes are normalized, bounded, persisted, and snapshotted into paid Orders.
- Refresh/resume restores the draft, confirmed uploads, and protected previews.
- Explicit abandonment expires the draft and clears the cookie without deleting paid work.

### 3.3 Private uploads

- Uploads are stored in the private `order-uploads` bucket.
- Browser previews use a cookie-authorized same-origin streaming endpoint.
- Public bucket URLs and unsigned object access are forbidden.
- Confirmed uploads are associated with an Intent position and later with exactly one paid Order.
- Removing an upload through the application removes both its database row and Storage object.

### 3.4 Stripe

- Checkout Sessions are created only by the server.
- Stripe calls occur outside database transactions and use persisted idempotency.
- Checkout is USD, card-only, US shipping, with Link explicitly hidden.
- Browser-provided Stripe parameters are rejected.
- Success and cancellation URLs contain no internal identifiers.
- The webhook verifies the raw body and Stripe signature.
- Paid fulfillment is transactional, idempotent, replay-safe, and concurrency-safe.
- A paid Session creates or reuses one Customer, creates exactly one Order, associates uploads, completes the Intent, and records the Stripe Event.
- Repeat purchases by the same normalized email are allowed.
- The success page only reads webhook-written state; it never creates or marks an Order paid.

### 3.5 Recovery and cleanup

- Recovery probes treat missing or stale browser state as a normal empty result.
- Cancellation supports resume, non-destructive return home, and confirmed start-over.
- Expired or abandoned unpaid Intents, upload rows, and Storage objects are removed by a bounded cleanup engine.
- Paid, completed, Order-owned, active, uncertain, or provider-failing records are protected from cleanup.
- Cleanup has a dry-run CLI and a protected Vercel Cron route.

### 3.6 Email

- Paid fulfillment creates exactly two Email Outbox jobs: customer confirmation and artist notification.
- Resend delivery uses stable, distinct idempotency keys.
- Jobs use atomic claims, stale-lease recovery, bounded retries, and terminal failure handling.
- Immediate delivery happens after the payment transaction commits.
- Provider failure never rolls back a paid Order.
- A CLI and protected daily Vercel Cron route provide fallback delivery.
- Transactional emails contain no private photo URLs or attachments.

### 3.7 Result UX

- Checkout success polling is bounded, non-overlapping, abortable, and read-only.
- Processing presentation uses the NYC postmark animation and animated ellipsis.
- Confirmation interrupts processing immediately and shows the confirmed treatment.
- Reduced-motion behavior is static and accessible.

Do not reimplement these systems from scratch. Inspect and extend the existing modules.

---

## 4. Current Roadmap

The active mission selects exactly one Unit. The default order is:

### Phase 2 — Backend Completion and Hardening

1. **Unit 2.17.1 — New York Time Policy**
   - Keep database timestamps in UTC.
   - Display business-facing times in `America/New_York`.
   - Drive public day/night behavior from New York time.
   - Preserve theme query overrides and cover DST boundaries.

2. **Unit 2.18 — Anonymous Storefront Abuse Protection**
   - Distributed rate limits and bounded request costs.
   - Protect Intent creation, upload, note, Session creation, recovery, and abandonment as appropriate.
   - Do not rely only on in-memory counters in serverless production.

3. **Unit 2.19 — Upload Content Hardening**
   - Verify actual raster content, dimensions, decoding safety, and metadata policy.
   - Reject disguised, malformed, decompression-bomb, executable, and unsupported content.

4. **Unit 2.20 — Fulfillment and Tracking Backend**
   - Define the Order state machine.
   - Add constrained shipping/tracking data and committed status history.
   - Queue shipment notification exactly once.

5. **Unit 2.21 — Refund and Dispute Reconciliation**
   - Synchronize Stripe refunds and disputes into local Order/payment state.
   - Support full and partial refunds without duplicate effects.
   - Prevent refunded work from proceeding incorrectly.

6. **Unit 2.22 — Production Security and Operations**
   - Security headers, CSP, trusted origins, secure cookies, configuration validation, health checks, monitoring, backup/restore, deployment and migration procedures.

### Phase 3 — Artist Operations

- Make the standard Payload Order detail workflow safe and usable.
- Provide authenticated private photo preview/download.
- Add valid status actions, shipment/tracking entry, safe retry controls, and audit visibility.
- Add deep links from artist email only after the authenticated Order workflow exists.
- Build a custom dashboard only if the standard Payload interface is insufficient.

### Phase 4 — Public UI Polish and Release

- Refine copy, spacing, artwork, modal flow, animation timing, responsive behavior, accessibility, and performance.
- Complete staging and production end-to-end acceptance.
- Production launch requires explicit user approval.

Do not implement later roadmap items inside an earlier Unit.

---

## 5. Non-Negotiable Domain Invariants

- Currency is USD until explicitly changed.
- Financial values are integer minor units, never floating-point dollars.
- The server owns minimum amount, shipping fee, totals, upload limits, and Stripe parameters.
- At least one server-confirmed reference photo is required before Checkout.
- A Checkout Intent is not an Order.
- A browser redirect is not proof of payment.
- A formal Order is created only after a verified Stripe webhook confirms payment.
- One successful Stripe payment creates at most one Order.
- Replayed or concurrent events must not duplicate Orders, uploads, Customers, or email jobs.
- Stripe and email-provider calls never occur inside database transactions.
- Reference photos, notes, addresses, email addresses, and tracking data are sensitive.
- Payment-card data never enters or is stored by this application.
- Email failure never invalidates or rolls back a paid Order.
- Completed Order uploads must not be removed by abandoned-draft cleanup.
- Immutable payment facts cannot be casually edited through Payload Admin.
- Database timestamps remain UTC; business presentation uses `America/New_York`.

Stop and ask before implementing a request that conflicts with an invariant.

---

## 6. Unit Work Protocol

### 6.1 Start once, narrowly

Before editing:

1. Read this file and the complete active `mission.md`.
2. Run `git status --short` and record `git rev-parse HEAD` once.
3. Treat a modified `mission.md` and an intentionally updated `AGENTS.md` as expected.
4. Stop only when an unexpected user change overlaps files required by the Unit or creates a material safety risk.
5. Inspect the directly relevant modules, their imports/callers, applicable tests, `package.json`, and migration state when relevant.
6. State the narrow implementation scope.

Do not repeatedly reread the whole repository, rescan unchanged files, or rerun the same preflight checks without a concrete reason.

### 6.2 One Unit only

- Implement only the active Unit and its minimum supporting changes.
- Do not opportunistically begin later Units.
- Do not use subagents or parallel implementation unless the mission explicitly permits it.
- Ask before schema redesign, new external services, recurring cost, destructive migration, broad dependency change, privacy-policy change, or user-visible workflow change not already decided.

### 6.3 Preserve the repository

Do not:

- Reinitialize or replace the application.
- Run project scaffolding over the repository.
- Rewrite working domains to match a preferred architecture.
- Reorganize broad directory trees.
- Upgrade frameworks or unrelated dependencies.
- Remove tests or weaken assertions.
- Use destructive Git commands.
- Revert, overwrite, stage, commit, push, or modify remotes unless explicitly requested.
- Modify `.env.local`, `mission.md`, or `AGENTS.md` unless the active mission explicitly authorizes it.

Stop task-created servers, listeners, browsers, watchers, and temporary profiles before reporting completion. Preserve a pre-existing user-owned Stripe listener when the mission says it should remain.

### 6.4 Make consequential decisions explicit

Ask the user only when a missing decision materially changes architecture, cost, schema, access, retention, payment behavior, or public UX. Resolve ordinary implementation details using the simplest existing project pattern.

---

## 7. Scope-Proportional Validation

The active mission defines required acceptance evidence. Validation must be sufficient but not ritualistically broad.

### 7.1 Default sequence

1. Write or update focused acceptance coverage before implementation when it provides a meaningful red state.
2. Confirm the intended focused failure once.
3. Implement the smallest coherent solution.
4. Run the focused tests.
5. Run TypeScript when TypeScript changed.
6. Run ESLint on changed handwritten files unless the mission requires full lint.
7. Run integration/lifecycle checks only for boundaries that changed.
8. Run one production build only when runtime code, routing, configuration, schema, or bundling changed.
9. Run browser/viewport/scene checks only when affected UI or animation changed.
10. Run live Stripe, Storage, Resend, database, or deployment checks only when the mission requires and authorizes them.

Do not run every historical suite for every Unit. Do not rerun a successful expensive command unless the working state changed in a way that could invalidate it.

### 7.2 Always truthful

Report every required criterion as `PASS`, `FAIL`, `BLOCKED`, or `NOT RUN`.

Do not:

- Claim commands were run when they were not.
- Treat a broken test harness as a valid red test.
- Weaken requirements to obtain green tests.
- Mark a Unit complete with required `FAIL`, `BLOCKED`, or `NOT RUN` items.

Generated migration warnings may be reported without failing the Unit when there are no errors and the warnings are understood.

### 7.3 Test boundaries

Prefer observable behavior through public/service boundaries over private-helper tests. Important cases include authorization, exact request contracts, replay, concurrency, rollback, provider failure, privacy, and cleanup.

Synthetic fixtures must be uniquely identifiable and cleaned up without changing pre-existing user data. Record starting and final counts when a live database or Storage lifecycle is used.

---

## 8. Security and Privacy

### 8.1 Secrets

Never expose or print:

- `DATABASE_URL`
- `PAYLOAD_SECRET`
- Supabase Storage credentials
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `RESEND_API_KEY`
- `CRON_SECRET`
- Cookie tokens or credential hashes

Real values belong only in approved environment configuration. `.env.example` contains placeholders only. No secret may enter browser bundles, URLs, logs, snapshots, screenshots, completion reports, Stripe metadata, or email content.

### 8.2 PII

Treat names, email, shipping address, notes, photos, tracking data, Stripe/customer identifiers, and provider IDs as sensitive.

- Return minimal response contracts.
- Never log request bodies, webhook bodies/signatures, addresses, notes, email bodies, recipients, uploaded bytes, Storage keys, or signed URLs.
- Use generic public errors and bounded safe internal classifications.
- Do not put PII or internal identifiers in storefront URLs or query strings.

### 8.3 Public endpoint rules

- Authenticate Checkout state only through the existing HttpOnly cookie contract.
- Enforce same-origin behavior where required.
- Reject unexpected JSON fields, query authority, conflicting headers, malformed bodies, and oversized requests.
- Set `Cache-Control: no-store` on private or stateful storefront responses.
- Do not expose generic Payload CRUD authority to public visitors.
- Rate limiting must work across serverless instances; process memory alone is insufficient.

### 8.4 Upload rules

- Private bucket only.
- Raster JPEG/PNG/WebP only.
- Enforce file count, per-file bytes, total bytes, and actual-content validation.
- Use randomized object keys and safe content disposition.
- Do not trust filenames, extensions, client MIME, or dimensions.
- Prevent directory listing and unsigned public access.
- Keep deletion order recoverable: Storage first, then database association/row.
- Preserve paid Order uploads.

### 8.5 Stripe rules

- Use Test/Sandbox mode outside approved production.
- Verify webhook signatures from the raw bounded body.
- Retrieve authoritative Stripe state before paid fulfillment when required.
- Validate mode, status, payment status, currency, totals, shipping, metadata correlation, and environment.
- Persist and enforce idempotency/uniqueness.
- Never trust success URLs, browser parameters, or customer-provided Stripe configuration.

### 8.6 Email rules

- Outbox creation belongs to the committed business transaction.
- Provider delivery happens after commit.
- Stable job-level idempotency and database claims prevent duplicate intentional sends.
- No photo attachments or private Storage URLs in normal transactional email.
- Provider failure remains retryable and cannot alter payment truth.
- Customer replies use the configured Reply-To address.

---

## 9. Payload, Database, and Migration Rules

- Every Collection and Global requires explicit access review.
- Admin field visibility is not authorization; enforce rules server-side.
- Payload Local API overrides access by default. Use privileged access only inside small documented server-only modules.
- When acting for a user, pass request/user context and use `overrideAccess: false` where appropriate.
- Keep hooks thin, idempotent, recursion-safe, and free of slow provider calls.
- Keep domain workflows in focused service modules.
- Do not manually edit generated Payload types, import maps, or generated migration snapshots.
- Generate with supported commands and review the result.
- Never rewrite an applied migration; add a forward migration.
- Ask before destructive migrations or backfills.
- New application tables in Supabase's exposed `public` schema require RLS enabled in the same reviewed migration before storing data.
- Do not add `anon` or `authenticated` RLS policies without explicit mission authorization.
- Keep PostgreSQL timestamps as `timestamptz`/UTC. Convert only at display or business-scheduling boundaries.

---

## 10. Code Organization

Follow existing project domains rather than this document's hypothetical structure.

- Components render presentation and local interaction.
- Client modules own exact browser request/response contracts.
- Route handlers validate the HTTP boundary and delegate.
- Services implement workflows.
- Repositories own locking and persistence details.
- Provider adapters isolate Stripe, Storage, and Resend.
- Collection configs define schema, access wiring, and concise admin metadata.
- Hooks coordinate lifecycle events but do not hide large workflows.
- Pure utilities contain deterministic logic.

Avoid payment, storage, email, or database logic inside React components.

Prefer cohesive files. Review handwritten files approaching roughly 300 lines for a meaningful split, but do not create tiny abstraction files solely to meet a line target. Generated files, migrations, and artwork are exceptions.

Reuse generated Payload types and shared domain constants. Do not duplicate status values, cents rules, MIME limits, or payment mappings across client and server.

---

## 11. Environment and Provider Boundaries

Current server-side configuration includes, as applicable:

- `DATABASE_URL`
- `PAYLOAD_SECRET`
- `SUPABASE_STORAGE_BUCKET`
- `SUPABASE_STORAGE_ENDPOINT`
- `SUPABASE_STORAGE_REGION`
- `SUPABASE_STORAGE_ACCESS_KEY_ID`
- `SUPABASE_STORAGE_SECRET_ACCESS_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `APP_BASE_URL`
- `CRON_SECRET`
- `RESEND_API_KEY`
- `EMAIL_FROM`
- `EMAIL_REPLY_TO`
- `ARTIST_ORDER_EMAIL`
- `EMAIL_DELIVERY_ENABLED`

Use the actual configuration modules and `.env.example` as the current contract. Do not infer or print real values.

Local Stripe webhook testing requires an active Stripe CLI listener and a matching local webhook signing secret. Production uses a Stripe Dashboard webhook endpoint; it must not depend on a developer machine.

Vercel Hobby cron expressions must remain compatible with its scheduling limits unless deployment moves to another plan or scheduler.

---

## 12. Time Policy

- Persist absolute timestamps in UTC.
- Use IANA zone `America/New_York` for artist/business-facing display and business calendar decisions.
- Do not hard-code EST or a fixed UTC offset; New York observes daylight saving time.
- The public day/night scene must use New York time regardless of visitor location.
- Preserve explicit theme query overrides for testing.
- Tests involving time must inject/freeze time and cover at least one EST and one EDT case when relevant.
- Vercel Cron schedules are UTC; document the local-time implication for business-sensitive schedules.

---

## 13. Documentation

Update documentation only when the Unit changes setup, environment names, scripts, operational behavior, architecture, or manual acceptance.

Document commands and placeholders, never real secrets or customer data. Keep README changes scoped; do not restate the entire repository policy in every Unit.

---

## 14. Completion Report

Keep the report concise and include:

1. **Outcome** — complete, blocked, or failed; starting/ending HEAD.
2. **Changes** — important behavior and files.
3. **Acceptance evidence** — each required criterion and result.
4. **Validation** — commands actually run and results.
5. **Security/data review** — changed trust boundaries, access, PII, secrets, fixtures, migrations, dependencies.
6. **Manual acceptance** — only actions still useful for the user.
7. **Repository state** — final changed files, processes/listeners, migration state, and confirmation that no commit/push occurred.

Avoid repeating the mission, printing long unchanged matrices, or describing excluded systems in excessive detail. Mention material limitations and deferred risks.

---

## 15. Mission Contract

Each `mission.md` should normally contain:

- Exact Phase and Unit.
- One outcome.
- In scope and out of scope.
- Confirmed product decisions.
- Observable acceptance criteria.
- Required focused verification.
- Authorized live-provider actions, if any.
- Stop-and-ask conditions.

The mission owns Unit-specific validation. This file must not be used to inflate a small Unit into a full-system revalidation.

Do not rewrite the mission after implementation to match the result. If requirements must change materially, stop and obtain approval.

---

## 16. Official References

For version-sensitive behavior, use installed source/types and current official documentation:

- Payload: https://payloadcms.com/docs
- Payload access control: https://payloadcms.com/docs/access-control/overview
- Payload Local API: https://payloadcms.com/docs/local-api/overview
- Payload transactions: https://payloadcms.com/docs/database/transactions
- Payload uploads/storage: https://payloadcms.com/docs/upload/overview
- Stripe Checkout: https://docs.stripe.com/api/checkout/sessions/create
- Stripe webhooks: https://docs.stripe.com/webhooks
- Stripe refunds: https://docs.stripe.com/refunds
- Resend send API: https://resend.com/docs/api-reference/emails/send-email
- Vercel Cron: https://vercel.com/docs/cron-jobs
- PostgreSQL date/time: https://www.postgresql.org/docs/current/datatype-datetime.html

Use primary documentation for technical decisions. Do not browse broadly when installed code and existing tests already establish the relevant contract.
