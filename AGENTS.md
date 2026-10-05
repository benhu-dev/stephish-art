# Stephish Art — Repository Instructions

## 1. Product Direction

Stephish Art currently sells commissioned illustrated postcards through guest checkout. It contains:

1. A public 2.5D storytelling scene and artistic checkout flow.
2. A secure commerce backend using Payload CMS, PostgreSQL, private object storage, Stripe, and Resend.
3. An artist-only order workflow based on Payload Admin.

Current delivery order:

1. Finish backend behavior, security, data integrity, and production operations.
2. Finish the artist's order-management workflow.
3. Review the artist's broader brand requirements, including portfolio and live-drawing services.
4. Polish public UI, copy, artwork, accessibility, and performance before release.

The broader artist-brand website is not yet fully designed. Do not add portfolio, live-drawing inquiry, content-management, or broad navigation features until the artist-provided requirements are reviewed and the user approves a product plan.

Preserve the approved public direction: illustrated Manhattan park, handcrafted instant-camera/postcard machine, reversible scroll stages, New York-based day/night theme, `?theme=day|night` test overrides, responsive layouts, reduced motion, and a consistent 2.5D hand-drawn editorial style.

Do not replace approved artwork, restructure the scene, add WebGL/360-degree interaction, or broadly redesign the visual system without explicit approval.

### Approved brand expansion direction

The site is expanding from a single commissioned-postcard experience into Stephish's broader artist-brand website. The intended top-level areas are Photo Booth, Live Drawing, Portfolio, and About. Detailed requirements for Live Drawing and Portfolio remain unapproved; do not implement them until their artist-provided requirements and product plan are reviewed.

Photo Booth is the provisional brand homepage and may later move to a dedicated route. Keep Photo Booth presentation, state, and checkout code isolated enough that this routing change does not require rebuilding the feature. About will eventually have a separate detailed page; the Photo Booth homepage may include only a concise artist introduction.

The approved Photo Booth product baseline is:

- Preserve the existing Manhattan park 2.5D scene and integrate it after a video-led introduction, concise artist copy, and an event-photo gallery.
- Use `Drop Your Coins` as the Photo Booth purchase call to action.
- Let authenticated artists manage postcard templates, preview media, ordering, and availability through Payload Admin.
- Price each portrait in server-owned USD cents: $20 for one person or pet, plus $5 for each additional person or pet, with a maximum of three subjects per portrait. People and pets have the same price.
- Allow one to five portraits per self-service checkout. Larger orders may use a future artist-contact path rather than an unbounded anonymous cart.
- Give each portrait its own template, one to three named subjects, one to three private reference photos capped by its subject count, and its own artist note. A group photo may represent multiple subjects, but the customer must identify who is who.
- Charge shipping once per Order. The initial approved flat rates are $10 for tracked United States shipping and $5 for untracked international shipping. The server owns the shipping classification, rate, total, and allowed-country rules.
- Keep the first implementation Stripe card-only. PayPal, Venmo, Zelle, carrier-calculated shipping, and additional payment providers are deferred architectural decisions.
- Treat custom portraits as final sale for change-of-mind returns, exchanges, and voluntary cancellations after payment. Clearly disclose the policy before payment while preserving remedies and refund capability for non-fulfillment, missed shipment commitments, damage, incorrect or materially misdescribed work, duplicate or incorrect charges, disputes, and applicable legal requirements.

The artist has indicated an expected ten-business-day production window before mailing, but the exact promise is not yet approved. Do not hard-code it into customer promises, deadlines, or automated actions until confirmed.

---

## 2. Collaboration and Authorization

The user prefers substantial discussion and explicit agreement before implementation.

### Communication language

- Communicate with the user in Traditional Chinese.
- Use Traditional Chinese for discussion, progress updates, questions, blockers, manual acceptance instructions, and completion reports.
- Keep source code, identifiers, filenames, commands, API contracts, database fields, test names, and repository documentation in English unless the existing project uses another convention.
- Preserve logs and error messages in their original language, then explain them in Traditional Chinese.
- Understand Chinese approval phrases such as “開始”, “開始吧”, “好，開始工作”, and “開始執行” as implementation authorization for the most recently agreed scope.

### Discussion is read-only

Questions, explanations, diagnosis, code review, planning, recommendations, UI/UX discussion, requests for the next Unit, and mission/kickoff drafting are read-only unless the user explicitly says otherwise.

Read-only repository inspection is allowed when useful. During discussion, do not:

- Edit, create, rename, or delete project files.
- Run migrations or mutate database, Storage, Stripe, Resend, or deployment state.
- Begin implementation merely because a possible solution was discussed.
- Run broad or expensive validation suites unless asked.

### What authorizes implementation

Begin only after unambiguous approval such as “開始”, “開始吧”, “好，開始工作”, “開始執行”, “Implement this Unit”, or equivalent language. Approval covers only the most recently agreed scope. A general acknowledgment such as “了解” is not implementation approval.

If the user supplies an explicit implementation kickoff, start without requesting redundant confirmation. Stop and ask only when a missing decision materially changes architecture, cost, schema, retention, access, payment behavior, privacy, or public UX.

### The user controls Git

Unless explicitly requested, never stage, commit, amend, push, modify remotes, create/switch/delete branches or worktrees, rebase, merge, tag, or reset. Leave completed changes unstaged and let the user review and commit them.

---

## 3. Sources of Truth and Session Startup

Use these sources in order:

1. Current user instructions and explicit decisions in the active chat.
2. Active `mission.md`, when present.
3. `PROJECT_STATUS.md`, when present, for durable progress and known follow-up work.
4. This file for durable working rules.
5. Current code, tests, migrations, installed versions, and Git history.

Do not assume a new chat contains older chat transcripts. Do not rely on chat memory when the repository can establish critical state.

At the start of implementation:

1. Read this file once, then `PROJECT_STATUS.md` and the complete `mission.md` once when present.
2. Run `git status --short` and `git rev-parse HEAD` once.
3. Inspect only relevant modules, callers, tests, configuration, and migration state.
4. State the narrow scope before editing.

Do not repeatedly reread the repository, repeat unchanged preflight checks, or reconstruct project history from scratch. A modified `mission.md` or intentionally updated `AGENTS.md` is expected. Stop only if an unexpected user change overlaps required files or creates material risk.

---

## 4. Architecture and Accepted Baseline

Use the repository and installed versions as the source of truth.

Approved architecture:

- Next.js, React, and TypeScript.
- Payload CMS in the existing Next.js application.
- PostgreSQL hosted by Supabase.
- Supabase Storage through its S3-compatible adapter; private `order-uploads` bucket.
- Stripe Hosted Checkout for one-time USD payments.
- Verified Stripe webhooks as the only payment authority.
- Resend transactional email.
- Vercel as the intended host.

The browser uses controlled same-origin endpoints and never receives database/Storage/provider credentials, privileged Payload access, or authority over payment/order state. Do not introduce Supabase Auth, direct browser database access, another backend/payment provider, or public Storage without an explicit architectural decision.

The following behavior is implemented and must be preserved unless an approved task changes it:

- Guest checkout uses server-authoritative Checkout Intents and an HttpOnly cookie.
- Amounts use integer cents and server-owned limits.
- One to three private JPEG/PNG/WebP references and an artist note are supported.
- Refresh/resume restores confirmed uploads and protected previews.
- Application removal deletes the upload row and private object; abandonment never deletes paid work.
- Stripe Sessions are server-created, USD/card-only, US-shipping, idempotent, and hide Link.
- Verified paid webhooks transactionally create exactly one Order, associate uploads, complete the Intent, and record the event.
- Repeat purchases by normalized email are allowed.
- Success polling is bounded and read-only; cancellation supports resume, return home, and start-over.
- Refunds/disputes reconcile with replay, concurrency, and rollback safety.
- Bounded cleanup removes eligible abandoned/expired unpaid data while protecting paid, active, uncertain, and Order-owned records.
- PostgreSQL-backed rate limits protect storefront boundaries across serverless instances.
- Email Outbox supports customer confirmation, artist notification, and customer shipment messages with idempotent delivery and retries.
- Orders have constrained fulfillment/tracking transitions.
- Payload Admin provides an Orders workbench and authenticated private image preview/download.
- Database timestamps remain UTC; business display and public day/night behavior use `America/New_York` with DST support.
- Checkout-result UI includes bounded polling, NYC postmark processing treatment, and reduced motion.

Do not reimplement these systems. Extend existing modules. Anything not explicitly listed must not be assumed complete; inspect current code before planning production security, upload-content hardening, monitoring/backups, deployment, or broader artist-site work.

---

## 5. Domain Invariants

- Currency is USD until explicitly changed.
- Financial values use integer minor units, never floating-point dollars.
- The server owns minimums, fees, totals, upload limits, and Stripe parameters.
- At least one server-confirmed image is required before Checkout.
- A Checkout Intent is not an Order; a redirect/success page is not proof of payment.
- Only a verified Stripe webhook can establish paid Order state.
- One successful payment creates at most one Order.
- Replay/concurrency must not duplicate Orders, uploads, Customers, ledgers, or email jobs.
- External provider calls do not belong inside database transactions.
- Photos, notes, names, addresses, email, tracking data, and provider identifiers are sensitive.
- Payment-card data never enters or is stored by this application.
- Email failure never invalidates a paid Order.
- Paid Order uploads cannot be removed by abandoned-draft cleanup.
- Immutable payment facts cannot be casually edited through Admin.
- Persist timestamps in UTC; present business time in `America/New_York`.

Stop and ask before violating an invariant.

---

## 6. Work Protocol

### One focused outcome

- Implement only the approved outcome and minimum supporting changes.
- Do not begin later Units opportunistically.
- Do not use subagents/parallel implementation unless the user explicitly requests it.
- Follow existing project patterns before adding dependencies or abstractions.
- Do not perform broad refactors during a defect fix.
- If work spans independent domains or likely needs a long exploratory run, recommend splitting it before implementation.

### Preserve the repository

Do not reinitialize/scaffold over the app, reorganize broad directories, upgrade unrelated dependencies, remove tests, weaken assertions, or revert/overwrite user-owned changes. Do not modify `.env.local`, `mission.md`, or `AGENTS.md` unless explicitly requested.

Stop task-created servers, listeners, browsers, watchers, and temporary profiles before reporting. Preserve pre-existing user-owned processes unless authorized to stop them.

### Handle blockers efficiently

- Diagnose only failures relevant to the approved task.
- Do not indefinitely repair unrelated environment problems.
- After two focused failed approaches, or when additional authority is required, report the blocker and ask for direction.
- A test harness failure before exercising behavior is not a valid red test or acceptance result.

---

## 7. Scope-Proportional Validation

Validation must be sufficient, not ritualistically broad:

1. Add/update focused coverage when it provides meaningful evidence.
2. Confirm the intended focused failure once when red-first testing is useful.
3. Implement the smallest coherent change.
4. Run focused tests.
5. Run TypeScript when TypeScript changed.
6. Run ESLint on changed handwritten files unless broader lint is required.
7. Run integration/lifecycle checks only for changed trust boundaries.
8. Run one production build after the final runtime/config/schema state when relevant.
9. Run browser/viewport checks only for affected UI/animation.
10. Run live Stripe, Storage, Resend, database, or deployment checks only when explicitly authorized and useful.

Do not run every historical suite for every task or rerun a successful expensive command unless later changes invalidate it. Do not perform visual checks for backend-only changes.

Report required criteria truthfully as `PASS`, `FAIL`, `BLOCKED`, or `NOT RUN`. Never claim an unexecuted command or lifecycle. Use uniquely identifiable synthetic fixtures and clean them without changing pre-existing data; record baseline/final counts for live database or Storage lifecycles.

---

## 8. Security and Privacy

Never expose, print, commit, render, or log `DATABASE_URL`, `PAYLOAD_SECRET`, Storage credentials, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `CRON_SECRET`, cookies, tokens, or credential hashes. Real values belong only in approved environment configuration; `.env.example` contains placeholders.

Treat all customer and provider data as sensitive:

- Return minimal contracts and generic public errors.
- Never log request/webhook bodies, signatures, addresses, notes, recipients, email bodies, uploaded bytes, object keys, or signed URLs.
- Do not put PII/internal identifiers in storefront URLs or query strings.
- Enforce same-origin rules where required.
- Reject unexpected fields, query authority, malformed/oversized bodies, and conflicting headers.
- Use `Cache-Control: no-store` for private/stateful responses.
- Do not expose generic Payload CRUD authority publicly.

Uploads must stay private and use randomized keys, safe disposition, bounded counts/bytes, and actual raster validation implemented by the repository. Never trust filenames, extensions, client MIME, or dimensions. Preserve paid uploads. Prefer recoverable deletion order: object first, then database association/row.

Stripe must remain in Sandbox outside approved production. Verify signatures from the raw bounded body and validate authoritative mode, status, payment status, currency, totals, shipping, and correlation. Never trust browser payment configuration or success URLs.

Create email jobs inside committed business transactions, but deliver only after commit. Preserve stable job idempotency/claims. Do not include private photo attachments or Storage URLs in normal transactional email. Use configured Reply-To.

---

## 9. Payload, Database, and Code Organization

- Review access for every Collection/Global; Admin visibility is not authorization.
- Payload Local API overrides access by default. Keep privileged calls in small server-only modules.
- When acting for a user, pass request/user context and use `overrideAccess: false` where appropriate.
- Keep hooks thin, idempotent, recursion-safe, and free of slow provider calls.
- Components own presentation; clients own browser contracts; routes validate HTTP; services own workflows; repositories own locking/persistence; adapters isolate providers.
- Keep payment, Storage, email, and database logic out of React components.
- Reuse generated types/shared constants.
- Do not hand-edit generated Payload types, import maps, or migration snapshots.
- Never rewrite an applied migration; create a forward migration.
- Ask before destructive migrations/backfills.
- New application tables in Supabase `public` require reviewed RLS in the same migration.
- Do not add public `anon`/`authenticated` RLS policies without authorization.
- Use `timestamptz`/UTC for stored absolute time.

Prefer cohesive existing domain boundaries. Split handwritten files when it materially improves reasoning, not merely to meet a line target.

---

## 10. Environment and Provider Boundaries

Relevant server-only variables include, as applicable:

`DATABASE_URL`, `PAYLOAD_SECRET`, `SUPABASE_STORAGE_BUCKET`, `SUPABASE_STORAGE_ENDPOINT`, `SUPABASE_STORAGE_REGION`, `SUPABASE_STORAGE_ACCESS_KEY_ID`, `SUPABASE_STORAGE_SECRET_ACCESS_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `APP_BASE_URL`, `CRON_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `ARTIST_ORDER_EMAIL`, and `EMAIL_DELIVERY_ENABLED`.

Use current configuration modules and `.env.example` as the contract. Never infer or print real values.

Local Stripe webhook testing requires an active Stripe CLI listener and matching local signing secret. Production must use a configured webhook endpoint and never depend on a developer computer. Keep Cron schedules compatible with the deployed Vercel plan unless the design is explicitly changed.

---

## 11. Chat, mission.md, and Kickoff Prompts

Use `mission.md` for schema/migrations; authentication/authorization/privacy; Stripe/refunds/disputes/webhooks; private uploads/deletion/retention; email/providers; cleanup/cron/deployment; broad multi-state UI; or work likely to span multiple focused conversations.

For a small, low-risk, well-defined change, the approved plan in the current Desktop chat may be the task contract; a new mission file is optional.

When used, `mission.md` should contain one outcome, scope/out-of-scope, confirmed decisions, observable acceptance criteria, focused verification, authorized live-provider actions, and stop conditions. Do not rewrite it after implementation to match the result.

A separate kickoff prompt is useful when starting a fresh CLI/Desktop chat. It is unnecessary when the mission was discussed and approved in the same chat: the user's clear “開始工作” instruction is enough.

---

## 12. Documentation and Completion

Update documentation only when setup, environment names, scripts, operations, architecture, or manual acceptance changes. Never document real secrets/customer data.

Keep completion reports concise:

1. Outcome and starting/ending HEAD.
2. Important behavior/files changed.
3. Required acceptance evidence.
4. Commands actually run and results.
5. Security/data review, fixtures, migrations, and dependencies.
6. Only useful remaining manual acceptance.
7. Final repository/process state and confirmation that no commit/push occurred.

Avoid repeating the mission or listing every untouched subsystem.

For version-sensitive decisions, prefer installed source/types and current primary documentation: Payload, Stripe, Resend, Vercel, and PostgreSQL official docs.
