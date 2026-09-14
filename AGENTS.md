# Stephish Art — Repository Instructions

## 1. Purpose

Stephish Art is a custom postcard commission website for an artist.

The product has two major areas:

1. A highly customized public-facing 2.5D experience.
2. A secure commerce and operations system powered by Payload CMS, PostgreSQL, private file storage, Stripe, and a transactional email provider.

The public experience introduces the artist through a handcrafted postcard-machine scene. Customers will eventually submit commission details, upload one or more required reference photos, enter a custom payment amount of at least USD $5.00, and pay through Stripe.

A formal order must only be created after Stripe confirms successful payment through a verified webhook.

Payload CMS should provide the standard backend foundation, generated Admin Panel, authentication, access control, CRUD operations, file management, and database integration. Custom code should focus on business rules, secure workflows, frontend experience, and project-specific admin features.

---

## 2. Current Product Direction

Preserve the existing 2.5D proof of concept unless the active mission explicitly changes it.

The current visual concept includes:

* A fixed illustrated Manhattan park scene.
* Grass, trees, buildings, and atmospheric depth.
* Automatic day and night themes based on local time.
* A supported query override for deterministic testing, such as `?theme=day` and `?theme=night`.
* Moving clouds during the day.
* Stars, moonlight, and occasional shooting stars at night.
* A handcrafted instant-camera machine based on the supplied reference photographs.
* A scroll stage where a coin enters the payment slot and disappears.
* A later scroll stage where a postcard prints from the machine.
* Reversible scroll-driven animation.
* Responsive desktop, mobile, and landscape behavior.
* A reduced-motion experience.

The first production version does not need:

* Camera rotation.
* Dragging or orbit controls.
* A complete 360-degree model.
* Physics simulation.
* A fully modeled Manhattan environment.
* Detachable machine components.
* A WebGL implementation unless later requirements justify it.

Prefer lightweight SVG, CSS, layered artwork, and DOM animation where they can achieve the required visual result.

Do not replace placeholder postcard artwork or interpreted machine details unless approved artwork or new reference assets are provided.

---

## 3. Approved High-Level Architecture

The intended architecture is:

* Next.js and TypeScript for the application.
* React for public and admin UI.
* Tailwind CSS and/or scoped CSS for styling.
* Anime.js for appropriate scroll-driven and decorative animation.
* Payload CMS inside the existing Next.js application.
* Payload Admin Panel for standard data management.
* PostgreSQL as the primary database.
* Supabase may host PostgreSQL.
* Supabase Storage, S3, Cloudflare R2, or another approved object-storage provider may store uploaded reference photos.
* Stripe Hosted Checkout for one-time payments.
* A verified Stripe webhook as the authority for successful payments.
* Resend or another approved transactional email provider for notifications.
* Automated tests plus explicit manual acceptance checks.

Do not introduce a second application backend unless an approved requirement makes it necessary.

The public frontend should communicate with controlled server endpoints. It should not directly perform privileged database operations.

Supabase should initially be treated as infrastructure behind Payload, not as a competing application layer. Do not add Supabase Auth or direct browser database access without an explicit architectural decision.

---

## 4. Mandatory Work Protocol

### 4.1 Read the active mission

Before making changes:

1. Read this entire `AGENTS.md`.
2. Read the entire active `mission.md`.
3. Inspect the relevant existing source files.
4. Inspect `package.json`, the lockfile, and current Git status.
5. Confirm the requested Phase and Unit.
6. Identify pre-existing uncommitted changes, distinguish expected instruction-file updates from unrelated changes, and preserve all user-owned work.
7. Summarize the intended scope before implementation.

`mission.md` defines the active unit of work. This file defines repository-wide rules.

If they conflict, stop and ask the user which instruction should win. Do not silently choose one.

### 4.2 Work on one Unit only

Only one development Unit may be active at a time.

Do not begin a later Unit merely because it appears easy or closely related. Do not implement future-phase features “while already in the area.”

A Unit may include the minimum supporting changes required for its acceptance criteria, but scope expansion must be disclosed.

Do not use subagents or parallel implementation unless the active mission explicitly permits it.

### 4.3 Ask before making consequential assumptions

Stop and ask the user if an unanswered question could materially affect:

* Architecture.
* Database schema.
* Data ownership.
* Payment behavior.
* Privacy or retention rules.
* Access control.
* User-visible design.
* Package selection.
* Hosting cost.
* A destructive migration.
* Compatibility with existing work.

Small implementation details may be resolved using the simplest conventional approach, but record meaningful assumptions in the final report.

### 4.4 Do not commit or push

Do not create Git commits, push branches, modify remotes, or open pull requests unless explicitly requested.

The user performs the normal add, commit, and push workflow after acceptance.

Do not modify `mission.md` or `AGENTS.md` unless the active mission specifically requests it.

### 4.5 Stop background processes

Stop development servers, watchers, test browsers, and other background processes before finishing unless the user asks to keep a preview running.

### 4.6 Existing repository is the starting point

This is an existing repository with a working Next.js application and an already implemented 2.5D proof of concept.

All future work must extend the existing project in place.

Unless an active mission explicitly authorizes it, do not:

- Run `git init`.
- Run `create-next-app`.
- Run `create-payload-app` over the repository.
- Replace the existing application with a starter template.
- Delete or recreate `src`.
- Rebuild the existing 2.5D scene from scratch.
- Move or rename existing feature directories.
- Perform a broad repository reorganization.
- Upgrade existing framework dependencies.
- Rewrite working components solely to match a preferred architecture.
- Remove existing tests or reduce their coverage.

The current repository and its committed behavior are the source of truth.

Payload must be integrated incrementally into the existing Next.js application. If the official Payload structure requires route groups, configuration files, generated files, or dependency changes, introduce them in a dedicated Unit and preserve the existing public frontend behavior.

Before any modifying Unit:

1. Inspect `git status`.
2. Record the current commit and relevant verification results.
3. Identify the exact files expected to change.
4. Confirm that existing public routes and 2.5D behavior will be preserved.

If integrating Payload appears to require replacing or regenerating the existing project, stop and ask the user before making changes.

### 4.7 Working-tree change handling

A modified `mission.md` is expected because the user replaces it for each Unit. It is not a blocker.

A modified `AGENTS.md` is also not a blocker when the user confirms that the change was intentional.

The agent must read these instruction files but does not need to compare them against their committed versions unless the active mission concerns repository instructions.

At the beginning of each Unit:

1. Run `git status --short` once.
2. Note any pre-existing changes.
3. Preserve all user-owned work.
4. Stop only if an unexpected pre-existing change overlaps files required by the active Unit or creates a meaningful safety risk.

During implementation:

- Do not repeatedly run Git comparisons merely because code is changing.
- Changes created by the agent within the approved Unit are expected.
- Do not stop because of those expected changes.
- Use tests and acceptance criteria as the primary verification method.

Before completion:

1. Run `git status --short`.
2. Run `git diff --stat` to confirm the overall scope.
3. Inspect detailed diffs only for relevant files when needed to detect accidental or out-of-scope changes.
4. Do not compare `AGENTS.md` or `mission.md` against Git unless the active mission modified repository instructions.
5. Report the final changed-file list.

Do not revert, overwrite, stage, commit, or push user changes unless explicitly requested.

---

## 5. Acceptance-First Development

Acceptance criteria must be derived from the requirement before implementation.

Never finish a function and then create a test that simply reproduces its implementation.

### 5.1 Required sequence

For each Unit:

1. Restate the intended behavior.
2. Define the observable acceptance criteria.
3. Define negative and security cases.
4. Identify the verification method for every criterion.
5. Add or update acceptance tests before implementing the behavior when practical.
6. Confirm that a new test fails for the intended missing behavior.
7. Implement the smallest coherent solution.
8. Run targeted tests.
9. Run the applicable regression suite.
10. Perform any required manual acceptance checks.
11. Report results without beginning the next Unit.

### 5.2 Good acceptance tests

Tests should verify externally meaningful behavior, such as:

* A value below 500 cents is rejected.
* A submission without a reference photo is rejected.
* A public visitor cannot read another customer’s submission.
* A forged Stripe webhook signature is rejected.
* Replaying the same Stripe event does not create a second order.
* A success-page visit cannot create an order.
* A paid Checkout Session creates exactly one order.
* Reversing scroll direction reverses the coin or postcard animation.
* Reduced-motion mode avoids long continuous motion.

Do not test private helper functions when the same behavior can be tested through a public boundary.

Do not calculate expected values by calling the production implementation being tested.

Do not weaken a requirement or assertion simply to make a test pass.

### 5.3 Infrastructure and configuration Units

Some Units, such as installing Payload or configuring storage, may not support a useful red-first unit test.

For those Units, define the acceptance contract before changing code and verify it with applicable checks such as:

* A clean installation.
* Type generation.
* Migration generation and execution.
* Build completion.
* Admin login.
* Database connectivity.
* Access-control probes.
* Upload and retrieval checks.
* Environment validation.
* Browser smoke tests.

A broken environment is not evidence of a correctly failing acceptance test.

### 5.4 Result vocabulary

Each acceptance item must be reported as one of:

* `PASS`
* `FAIL`
* `BLOCKED`
* `NOT RUN`

Do not report a Unit as complete if any required acceptance item is `FAIL`, `BLOCKED`, or `NOT RUN`.

---

## 6. Planned Delivery Phases

The following sequence is the default plan. The active `mission.md` may select only one Unit at a time.

### Phase 0 — Baseline and Architecture

#### Unit 0.1 — Existing repository verification

This is a read-only inspection Unit. It does not authorize source-code, dependency, configuration, or directory changes.

- Confirm the repository is already initialized.
- Confirm the configured Git remote and current branch.
- Inspect the existing Next.js application and directory structure.
- Identify the current 2.5D scene entry points, components, hooks, utilities, and tests.
- Record the installed package versions and available scripts.
- Run the existing lint, build, and scene checks.
- Confirm generated directories such as `.next` are ignored by Git.
- Identify possible OneDrive or filesystem synchronization risks.
- Report any issue before attempting to fix it.

Do not initialize, scaffold, reinstall, restructure, repair, or modify anything during this Unit.

If the repository is clean and all existing checks pass, report that the current commit is the accepted pre-Payload baseline.

#### Unit 0.2 — Architecture decision record

* Confirm the role of Payload, PostgreSQL, object storage, Stripe, and email.
* Document system boundaries.
* Document sensitive data categories.
* Draft the authorization matrix.
* Draft the order and payment invariants.
* Confirm local, test, staging, and production environment boundaries.

No Payload installation should begin until compatibility and migration impact have been checked.

### Phase 1 — Payload Foundation

#### Unit 1.1 — Compatibility and installation

* Verify current Next.js, React, Node.js, TypeScript, and Payload compatibility using official documentation.
* Do not upgrade unrelated dependencies.
* Add Payload to the existing application without replacing the current frontend.
* Preserve Git history and existing source files.
* Add only required dependencies.
* Generate or update type-safe Payload configuration.

#### Unit 1.2 — Application routing

* Establish separate frontend and Payload route groups using the supported Payload structure.
* Keep the existing public experience accessible.
* Make the Payload Admin Panel accessible at the approved admin route.
* Avoid duplicating layouts or global styles between public and admin routes.
* Confirm public styling does not leak into the Admin Panel.

#### Unit 1.3 — Database and administrator authentication

* Configure PostgreSQL using environment variables.
* Verify migrations and database connectivity.
* Create the administrator auth collection.
* Ensure public registration cannot create an administrator.
* Verify unauthenticated users cannot access protected admin data.
* Add development setup instructions without storing credentials.

### Phase 2 — Domain Model and Admin CRUD

#### Unit 2.1 — Core schema

Design and implement the initial Payload collections:

* `admins`
* `checkout-submissions`
* `reference-images`
* `customers`
* `orders`
* `payments`
* `stripe-events`
* `order-status-history`

Add `email-outbox` only when the email phase begins, unless it is required earlier for a clean transactional boundary.

Generate and review migrations. Do not apply destructive production migrations automatically.

#### Unit 2.2 — Access-control matrix

Implement and test create, read, update, and delete rules for every collection.

The default should be deny-by-default.

At minimum:

* Public visitors cannot browse customers, orders, payments, uploads, or Stripe events.
* Public visitors cannot use generic collection APIs to create paid orders.
* Only approved server workflows may convert a checkout submission into an order.
* Administrators may access only the functions required by their role.
* Stripe event records cannot be edited through normal admin workflows.
* Payment identifiers and internal fields are hidden where appropriate.

#### Unit 2.3 — Standard Admin Panel workflow

* Configure useful labels, columns, search fields, filters, and descriptions.
* Make orders, customers, payments, and reference images understandable to the artist.
* Keep immutable payment fields read-only.
* Do not build a custom analytics dashboard yet.
* Verify that Payload’s standard Admin Panel is sufficient before adding custom UI.

### Phase 3 — Secure Submission and Photo Upload

#### Unit 3.1 — Private upload foundation

* Configure persistent object storage.
* Do not depend on ephemeral production filesystem storage.
* Restrict uploads to approved raster image formats.
* Do not accept customer-provided SVG, HTML, scripts, archives, or executables.
* Enforce per-file size, file-count, image-dimension, and total-request limits.
* Use safe randomized object keys.
* Do not expose permanent public URLs.
* Ensure only authorized administrators and controlled server workflows can retrieve original reference photos.

#### Unit 3.2 — Checkout-submission service

Create a controlled server boundary that:

* Validates required customer fields.
* Requires at least one successfully stored reference photo.
* Normalizes and validates email and text inputs.
* Rejects unexpected fields.
* Converts the customer-entered amount into integer cents.
* Rejects amounts below 500 cents.
* Rejects invalid, fractional-cent, non-finite, or unsupported currency values.
* Applies an approved maximum amount once defined.
* Creates a temporary checkout submission, not a formal order.
* Returns only the minimum information needed by the frontend.

#### Unit 3.3 — Public commission form

* Build an accessible form for commission details and required uploads.
* Provide useful progress, validation, retry, and failure states.
* Do not rely on client-side validation for security.
* Prevent accidental duplicate submissions.
* Do not expose internal record IDs unnecessarily.
* Preserve the existing 2.5D scene’s performance.
* Verify mobile keyboard, upload, and form behavior.

#### Unit 3.4 — Abandoned submission cleanup

* Define an approved expiration period.
* Mark expired submissions.
* Delete or quarantine abandoned reference images according to the retention policy.
* Make cleanup safe to retry.
* Record cleanup failures without exposing customer data.

### Phase 4 — Stripe Payment and Order Creation

#### Unit 4.1 — Checkout Session creation

Create the Stripe Checkout Session only on the server.

The service must:

* Load the authoritative checkout submission.
* Revalidate its status and required uploads.
* Use the server-validated integer amount.
* Use USD unless another currency is explicitly approved.
* Use Stripe Test Mode outside production.
* Attach only non-sensitive internal correlation IDs to Stripe metadata.
* Never put reference photos, private notes, addresses, or unnecessary PII in Stripe metadata.
* Prevent reuse of expired or already converted submissions.
* Return only the Checkout redirect information required by the frontend.

#### Unit 4.2 — Verified Stripe webhook

Implement the webhook using Stripe’s official SDK.

It must:

* Read the raw request body where required.
* Verify the Stripe signature with the webhook signing secret.
* Reject invalid signatures.
* Persist the Stripe event ID with a unique constraint.
* Treat webhook delivery as duplicated and unordered.
* Confirm the Checkout Session is actually paid.
* Verify amount, currency, environment, and internal correlation.
* Avoid trusting browser redirect parameters.
* Keep processing deterministic and safe to retry.
* Avoid sending email or performing slow network work inside the critical payment transaction.

#### Unit 4.3 — Atomic order conversion

After verified payment:

* Create or reconcile the customer.
* Create exactly one payment record.
* Create exactly one formal order.
* Link the approved private reference images.
* Mark the checkout submission as converted.
* Create the initial order-status history entry.
* Use one database transaction where supported.
* Pass the same Payload request context through related transactional operations.
* Enforce unique constraints for Stripe Checkout Session and Payment Intent identifiers.
* Roll back partial database changes on failure.

The formal order must not exist before verified successful payment.

#### Unit 4.4 — Payment result UX and reconciliation

* The success page may display or poll order status.
* The success page must never create or mark an order as paid.
* The cancel page must preserve a valid submission according to the approved retry policy.
* Support delayed webhook processing without claiming the order is lost.
* Add an administrator-visible reconciliation path for paid sessions that failed conversion.
* Test duplicate, delayed, malformed, and out-of-order Stripe events.

### Phase 5 — Email and Fulfillment Operations

#### Unit 5.1 — Email outbox

* Create durable email-outbox records after important state changes.
* Do not make payment success depend on the email provider.
* Make email delivery retryable and idempotent.
* Store provider message IDs and delivery status.
* Do not log complete email content containing sensitive information.

#### Unit 5.2 — Order notifications

Add approved transactional emails for:

* Customer payment and order confirmation.
* New-order notification to the artist.
* Order-status updates.
* Shipping and tracking information.
* Refund or cancellation notices when applicable.

Do not include private reference-photo URLs in normal email.

#### Unit 5.3 — Artist fulfillment workflow

* Configure clear order statuses.
* Restrict invalid status transitions.
* Record status history.
* Allow approved shipment and tracking fields.
* Trigger customer notifications only after committed state changes.
* Prevent accidental repeated notifications.

### Phase 6 — Dashboard and Operational Improvements

#### Unit 6.1 — Dashboard requirements

Before writing dashboard code, define:

* Metrics.
* Date boundaries and time zone.
* Payment and refund treatment.
* Access permissions.
* Expected data volume.
* Empty and partial-data states.

#### Unit 6.2 — Custom Payload dashboard

Only after the underlying data is reliable, consider:

* Pending-order count.
* Orders by status.
* Paid revenue by period.
* Average paid amount.
* Recent order activity.
* Failed payment or conversion alerts.

Dashboard results must come from server-side authorized queries. Never expose all payment or customer records to browser code merely to calculate totals.

#### Unit 6.3 — Audit and support tooling

* Record sensitive administrator actions where appropriate.
* Add safe retry controls for failed email or reconciliation work.
* Require confirmation for refunds, deletions, and destructive status changes.
* Avoid exposing secrets or raw webhook payloads in the Admin Panel.

### Phase 7 — Hardening and Release

#### Unit 7.1 — Security review

Review:

* Authentication.
* Authorization.
* Payload Local API access behavior.
* Secrets.
* Upload handling.
* PII exposure.
* Rate limiting.
* Anti-automation controls.
* CSRF and origin behavior.
* Security headers and content security policy.
* Dependency advisories.
* Error responses.
* Logging.
* Data retention.
* Backup and restore procedures.

#### Unit 7.2 — Accessibility and performance

Verify:

* Keyboard navigation.
* Form labels and error announcements.
* Color contrast.
* Reduced motion.
* Responsive behavior.
* Image optimization.
* JavaScript bundle impact.
* Animation performance.
* Graceful degradation.
* Admin usability.

#### Unit 7.3 — Staging deployment

* Use separate staging credentials and resources.
* Use Stripe Test Mode.
* Apply migrations intentionally.
* Verify private storage behavior.
* Verify webhook delivery from the deployed environment.
* Verify environment-variable validation.
* Confirm production secrets are absent from logs, builds, and browser bundles.

#### Unit 7.4 — Final end-to-end acceptance

Run the complete customer journey:

1. Open the public site.
2. Experience the 2.5D scroll scene.
3. Fill in the commission form.
4. Upload valid reference photos.
5. Enter a valid custom amount.
6. Complete a Stripe test payment.
7. Confirm exactly one order is created.
8. Confirm the artist can view it in Payload Admin.
9. Confirm required notifications are queued or sent.
10. Update fulfillment status.
11. Verify customer-visible status communication.
12. Repeat negative, duplicate, mobile, and reduced-motion cases.

Production launch requires explicit user approval.

---

## 7. Domain Invariants

The following rules are non-negotiable unless the user explicitly changes the product requirements:

* Currency is USD unless otherwise approved.
* The minimum payment is 500 integer cents.
* Client-provided amounts are never authoritative.
* At least one valid reference photo is required.
* A checkout submission is not an order.
* A browser redirect is not proof of payment.
* A formal order is created only after a verified Stripe webhook confirms payment.
* One Stripe payment can create at most one order.
* Replayed Stripe events must not duplicate effects.
* Reference photos are private customer data.
* Payment-card data must never enter or be stored by this application.
* Email failure must not invalidate a paid order.
* Administrators must not be able to casually edit immutable payment facts.
* Financial amounts must be stored as integer minor units, never floating-point dollars.

If a requested feature conflicts with one of these rules, stop and ask for approval.

---

## 8. Payload-Specific Safety Rules

### 8.1 Access control

Every new Collection and Global must have its access behavior reviewed explicitly.

Do not rely on the Admin Panel hiding a field as a security control. Enforce access on the server.

Public form submission should use a controlled endpoint or narrowly scoped operation. Do not expose unrestricted generic CRUD endpoints for customers, orders, payments, Stripe events, or private uploads.

### 8.2 Local API

Payload Local API operations default to overriding access control.

For operations performed on behalf of a user:

* Pass the request context.
* Set `overrideAccess: false`.
* Pass the authenticated user where required.

Use `overrideAccess: true` only for a trusted internal operation with a documented reason. Keep the privileged call inside a small server-only module.

### 8.3 Hooks

Keep Payload hooks thin.

Hooks may coordinate a committed domain event, but substantial business logic should live in testable service modules.

Hooks must be:

* Idempotent where retries are possible.
* Explicit about side effects.
* Safe against recursive updates.
* Careful with transaction context.
* Free from unnecessary slow external calls.

Do not hide critical order-creation logic across unrelated hooks.

### 8.4 Generated files and migrations

* Do not manually edit generated Payload types or generated import maps.
* Regenerate them using supported commands.
* Review database migrations before execution.
* Any new table created in Supabase's exposed public schema must have RLS enabled in the same reviewed migration before application data is stored. Do not add `anon` or `authenticated` policies without explicit mission authorization.
* Never rewrite an already-applied production migration.
* Create a forward migration for later changes.
* Ask before destructive schema operations or data backfills.

---

## 9. Security and Privacy Requirements

### 9.1 Secrets

Never expose these to client-side code:

* Payload secret.
* Database credentials.
* Supabase service-role credentials.
* Object-storage secret keys.
* Stripe secret key.
* Stripe webhook signing secret.
* Email-provider API key.

Only variables intentionally safe for browsers may use a public environment prefix.

Provide placeholder names in `.env.example`, never real values.

Never print secrets in commands, logs, test snapshots, screenshots, or completion reports.

### 9.2 Customer data

Treat the following as sensitive:

* Name.
* Email.
* Phone number.
* Shipping address.
* Billing-related identifiers.
* Reference photographs.
* Commission notes.
* Tracking information.

Minimize collection, storage, logs, API responses, and retention.

Do not place sensitive customer data in URLs or query strings.

Do not log full request bodies, uploaded files, email bodies, Stripe payloads, or addresses.

### 9.3 Upload security

At minimum:

* Restrict allowed MIME types.
* Validate actual file content where practical.
* Reject double-extension and executable files.
* Normalize or replace filenames.
* Enforce file size and request limits.
* Enforce upload count and total-size limits.
* Prevent public directory listing.
* Remove unnecessary image metadata such as EXIF location data when feasible.
* Consider quarantine and malware scanning before production.
* Provide safe failure cleanup.
* Verify unauthorized retrieval fails.

### 9.4 Abuse prevention

Public submission and Checkout Session endpoints should eventually include:

* Rate limiting.
* Request-size limits.
* Short-lived submission tokens or equivalent correlation protection.
* Duplicate-submission protection.
* Bot protection such as Turnstile when approved.
* Generic external error messages.
* More detailed private server logs without PII.

### 9.5 Dependencies

* Prefer official or actively maintained packages.
* Confirm package compatibility before installation.
* Do not install overlapping libraries without justification.
* Review install scripts and dependency advisories.
* Do not perform broad dependency upgrades inside an unrelated Unit.
* Do not blindly apply force-based audit fixes.

---

## 10. Code Organization

Use the supported Payload structure as the base, while preserving clear project domains.

A likely target structure is:

```text
src/
  app/
    (frontend)/
      ...
    (payload)/
      ...
  collections/
    Admins.ts
    CheckoutSubmissions.ts
    Customers.ts
    Orders.ts
    Payments.ts
    ReferenceImages.ts
    StripeEvents.ts
    OrderStatusHistory.ts
  access/
    ...
  features/
    postcard-machine/
      components/
      hooks/
      lib/
      scene.css
    checkout/
      components/
      hooks/
      lib/
  server/
    checkout/
    customers/
    email/
    orders/
    payments/
    storage/
    stripe/
  lib/
  types/
  payload.config.ts
tests/
  acceptance/
  integration/
  e2e/
scripts/
```

Treat this as guidance, not permission to reorganize the whole repository in one Unit. Adapt it to the currently supported Payload template and existing project structure.

### 10.1 Separation of concerns

* React components render UI and handle local presentation behavior.
* React hooks coordinate reusable client behavior.
* Route handlers and Payload endpoints validate request boundaries.
* Services contain business workflows.
* Collection files describe schema, admin configuration, and access wiring.
* Access functions contain authorization rules.
* Payload hooks coordinate lifecycle events but remain thin.
* Storage adapters handle file persistence.
* Provider adapters isolate Stripe and email SDK details.
* Pure utilities contain deterministic logic.
* Tests follow behavior and domain boundaries.

Do not put payment logic inside a React component.

Do not put large business workflows directly inside a Payload Collection config.

Do not let an upload hook silently create an order.

### 10.2 File size and maintainability

Prefer cohesive, focused files.

As guidance:

* Aim for most handwritten files to remain below approximately 200 lines.
* Review any handwritten file approaching 300 lines for a meaningful split.
* Generated files, migrations, SVG artwork, and necessary configuration are exceptions.
* Do not split code into tiny files solely to satisfy a line count.
* Extract code when it creates a clear domain, reusable behavior, or independently testable responsibility.

Use descriptive names. Avoid generic files such as `utils.ts`, `helpers.ts`, or `common.ts` when a domain-specific name is possible.

### 10.3 Shared contracts

Use Payload-generated types where appropriate.

Keep request validation and domain invariants close to server boundaries.

Avoid duplicating order-status values, amount rules, or payment-state mappings across frontend and backend.

Do not expose full database documents when a smaller response contract is sufficient.

---

## 11. Testing Strategy

Use the smallest relevant test first, followed by broader checks.

### 11.1 Test categories

* Unit tests for deterministic domain rules.
* Integration tests for Payload collections, access control, and database behavior.
* Endpoint tests for submission, upload, and Checkout creation.
* Stripe webhook tests using signed fixtures or official test tooling.
* End-to-end tests for critical customer and admin journeys.
* Existing scene checks for scroll behavior, themes, masking, responsive layouts, and reduced motion.
* Manual visual review for artwork and animation quality.

### 11.2 Required financial and security cases

Before payment functionality is considered complete, verify at least:

* `$4.99` is rejected.
* `$5.00` is accepted.
* Invalid numbers are rejected.
* Fractional cents are rejected or normalized according to the approved contract.
* The client cannot substitute a lower amount after validation.
* Missing photos are rejected.
* Unauthorized photo reads are rejected.
* Invalid Stripe signatures are rejected.
* Duplicate Stripe events do not duplicate records.
* Out-of-order events do not corrupt state.
* A successful browser redirect without a webhook does not create an order.
* A verified paid session creates one order.
* A database failure does not leave a partially created order.
* An email failure does not roll back a paid order.

### 11.3 Regression checks

Run the scripts that apply to the Unit. The normal final regression set is expected to include:

```text
npm run lint
npm run build
```

Also run available type checks, unit tests, integration tests, end-to-end tests, and scene checks.

Do not claim that a command passed if it was not run successfully in the current working state.

---

## 12. Environment and Repository Hygiene

* Preserve unrelated user changes.
* Inspect `git diff` before and after implementation.
* Do not use destructive Git commands.
* Do not delete user files.
* Keep `.next`, test output, local uploads, and `node_modules` out of Git.
* Treat `.next` as generated output.
* If stale generated output appears, stop relevant processes and regenerate only the exact disposable directory.
* Be cautious with OneDrive synchronization and duplicate conflict files.
* Ask before deleting or relocating directories.
* Use supported migration and generation commands instead of editing outputs manually.
* Keep local test data separate from real customer data.
* Never use production Stripe, database, storage, or email credentials for automated tests.

---

## 13. Documentation Requirements

Update documentation when a Unit changes setup, architecture, environment variables, scripts, or operational behavior.

Documentation should include:

* Prerequisites.
* Installation.
* Environment-variable names.
* Local database setup.
* Payload Admin setup.
* Migration commands.
* Test commands.
* Stripe Test Mode setup.
* Webhook forwarding instructions.
* Storage configuration.
* Known limitations.
* Manual acceptance steps.

Do not document real secrets or personal customer information.

---

## 14. Completion Report

At the end of every Unit, provide a concise report containing:

### Outcome

State whether the Unit is complete, blocked, or failed.

### Changes

List the important files and behavior changed.

### Acceptance evidence

For every prewritten acceptance criterion, report:

* Criterion.
* Verification method.
* `PASS`, `FAIL`, `BLOCKED`, or `NOT RUN`.

### Commands run

List relevant commands and their actual results.

### Security review

State:

* Which trust boundaries changed.
* Which access rules were tested.
* Whether secrets or PII handling changed.
* Any deferred security work.

### Manual acceptance

List the exact actions the user should perform manually, including routes, screen sizes, test data, and expected results.

### Known limitations

List placeholders, deferred work, assumptions, and risks.

### Repository state

Confirm:

* Whether background processes remain.
* Whether `mission.md` or `AGENTS.md` changed.
* Whether dependencies changed.
* That no commit or push was created unless requested.

Do not describe blocked validation as successful completion.

---

## 15. Suggested `mission.md` Contract

Each active mission should identify exactly one Unit and normally use this structure:

```markdown
# Mission

## Phase and Unit

Phase X — Name  
Unit X.Y — Name

## Goal

One clear outcome.

## In Scope

- Required item
- Required item

## Out of Scope

- Deferred item
- Deferred item

## Confirmed Decisions

- Relevant user decision
- Relevant user decision

## Acceptance Criteria

1. Observable behavior
2. Negative or security behavior
3. Regression requirement

## Required Verification

- Automated command or test
- Manual browser check

## Stop and Ask If

- Unresolved decision
- Conflict or unsafe condition
```

Do not rewrite the mission during implementation to match the resulting code. If the requirement must change, stop and ask the user to approve a revised mission.

---

## 16. Official References

When behavior depends on the installed version, verify it against current official documentation instead of relying on memory:

* Payload introduction: https://payloadcms.com/docs/getting-started/what-is-payload
* Payload installation: https://payloadcms.com/docs/getting-started/installation
* Payload access control: https://payloadcms.com/docs/access-control/overview
* Payload Local API: https://payloadcms.com/docs/local-api/overview
* Payload uploads: https://payloadcms.com/docs/upload/overview
* Payload storage adapters: https://payloadcms.com/docs/upload/storage-adapters
* Payload hooks: https://payloadcms.com/docs/hooks/overview
* Payload transactions: https://payloadcms.com/docs/database/transactions
* Payload Stripe plugin: https://payloadcms.com/docs/plugins/stripe
* Payload custom components: https://payloadcms.com/docs/custom-components/overview
* Payload jobs queue: https://payloadcms.com/docs/jobs-queue/overview
* Stripe Checkout Sessions: https://docs.stripe.com/api/checkout/sessions/create
* Stripe webhooks: https://docs.stripe.com/webhooks

Use official documentation for version-sensitive implementation decisions.
