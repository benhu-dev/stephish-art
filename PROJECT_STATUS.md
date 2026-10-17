# Stephish Art Project Status

Last reviewed: 2026-10-17

## Current repository state

- Branch: `main`
- Baseline HEAD at the start of Unit 3.0: `19b39cdc3a634431781a22d5df7e6850f4972637`
- The existing `AGENTS.md` rewrite was an expected user-owned working-tree change before Unit 3.0.
- Unit 3.0 is documentation-only. It does not change runtime code, schemas, migrations, dependencies, environments, provider state, or customer data.

## Product direction

Stephish Art is expanding from a single commissioned-postcard website into an artist-brand website with these intended areas:

1. Photo Booth
2. Live Drawing
3. Portfolio
4. About

Photo Booth is the provisional homepage. It may move to a dedicated route later, so its presentation and checkout domains must remain portable. About will have a separate detailed page, while Photo Booth may include a concise artist introduction. Live Drawing and Portfolio requirements are not yet approved for implementation.

## Accepted technical baseline

The repository already contains and must preserve:

- Next.js, React, TypeScript, and Payload CMS in one application.
- PostgreSQL through Payload's Postgres adapter and reviewed forward migrations.
- Private Supabase S3-compatible Storage for order uploads.
- Server-authoritative guest Checkout Intents protected by an HttpOnly cookie.
- Private upload, preview, removal, recovery, and paid-upload protection.
- Stripe Hosted Checkout with verified webhooks as the payment authority.
- Idempotent paid Order creation, repeat-customer support, and event ledgers.
- Refund and dispute reconciliation.
- Bounded abandoned-checkout cleanup and PostgreSQL-backed storefront rate limits.
- Resend delivery through an idempotent Email Outbox.
- Fulfillment and tracking transitions plus customer shipment email.
- A secure Payload Orders workbench with authenticated private image preview/download.
- UTC persistence and `America/New_York` business presentation.
- The approved Manhattan park 2.5D scene, reversible scroll behavior, responsive layouts, reduced motion, and day/night test overrides.

## Confirmed Photo Booth decisions

### Homepage experience

- Photo Booth is the provisional `/` brand homepage.
- The page will introduce Photo Booth with video-led presentation, concise artist copy, and an event-photo gallery.
- A gradient transition will lead into the existing Manhattan park 2.5D sticky scene.
- `Drop Your Coins` will open the purchase experience.
- User-provided temporary assets may be used during development when explicitly identified as samples and kept easy to replace.

### Templates

- The artist should manage template records and preview media in Payload Admin.
- The initial concepts are Central Park, Rene Magritte, Tarot: The Lover, Tarot: The World, and Tarot: The Star, subject to final artist assets and naming.
- Paid Orders must keep immutable template snapshots so later template edits do not alter historical purchases.

### Portrait items and pricing

- One self-service cart may contain one to five portraits.
- Each portrait selects one template.
- Each portrait contains one to three named subjects.
- A subject may be a person or pet; both use the same price.
- One subject costs $20; each additional subject costs $5. Therefore a portrait costs $20, $25, or $30.
- The server owns subject counts, unit prices, subtotals, shipping, and final totals in integer USD cents.
- Each portrait has its own artist note.
- Each portrait accepts at least one and at most three private reference photos, and never more photos than subjects.
- A group photo may represent multiple subjects. The customer must clearly identify who appears in each image through names, image-to-subject mapping, or an equally explicit approved interaction.
- Reference photos accept JPEG, PNG, and WebP up to 15 MiB and 50 megapixels each. A portrait is capped at three photos and 30 MiB; a cart is capped at fifteen photos and 100 MiB. Accepted images are auto-oriented and re-encoded without source metadata, while animated and multipage images are rejected.
- Larger orders are deferred to a future artist-contact path rather than an unbounded anonymous cart.

### Shipping

- Shipping is charged once per Order, regardless of portrait count.
- Initial United States flat shipping is $10 and includes tracking.
- Initial international flat shipping is $5 and does not include tracking.
- Carrier-calculated USPS rates are deferred until the product catalog requires meaningful weight, dimension, mail-class, or destination-based pricing.
- Stripe may collect the full shipping address, but the application server must own the selected region, allowed countries, shipping rate, and total and must verify them again during webhook fulfillment.

### Payments and policies

- The initial implementation remains Stripe card-only.
- PayPal, Venmo, Zelle, and additional providers are deferred.
- Custom portraits are final sale for change-of-mind returns, exchanges, and voluntary cancellations after payment.
- The customer-facing policy must remain clear before payment and preserve remedies/refunds for non-fulfillment, missed shipment promises, damage, incorrect or materially misdescribed work, duplicate or incorrect charges, disputes, and applicable law.
- The international untracked-mail copy may describe the artist's proposed 50% replacement discount, but final wording and legal review remain pending.

## Open decisions

- Confirm whether the production promise is "ships within 10 business days" and define when that clock starts.
- Confirm the international country allowlist and whether the $5 rate is sustainable for the chosen USPS service.
- Approve final production video, event photos, template previews, artist copy, and alt text. Current reference materials are not automatically production assets.
- Approve the final customer-facing presentation and wording for the implemented explicit image-to-subject mapping model.
- Approve final shipping, production, cancellation, final-sale, damage, incorrect-order, and untracked-mail policy text before launch.
- Decide the eventual global navigation and the requirements for the detailed About page.

## Planned work units

### Unit 3.0 - Product Architecture and Project Handoff

Status: complete on 2026-10-05.

Documentation only: update durable repository guidance, create this status source, and define the next focused mission. No runtime implementation.

### Unit 3.1 - Photo Booth Homepage Structure and Visual Foundation

Status: complete on 2026-10-05.

The homepage now includes the Photo Booth hero, local sample background video with a matching first-frame poster, motion-safe fallback, graduated milk-white readability overlay, concise artist introduction, accessible event-media placeholders, gradient transition, existing 2.5D scene integration, and shared `Drop Your Coins` entry points without changing checkout or backend behavior. Approved production video and event photos still need to replace the isolated sample and placeholders. Artist-managed homepage media remains a future schema, Storage, access, and Admin workflow Unit.

### Unit 3.1.2 - Night Art Direction and Editorial Motion

Status: complete on 2026-10-06.

The Photo Booth introduction now gives night mode a distinct moonlit, low-saturation palette across the video overlay, artist introduction, and event gallery while preserving the approved transition into the existing night park scene. Restrained scroll-linked depth, one-time editorial reveals, and gallery-card microinteractions improve the page rhythm without scroll-jacking; mobile motion is reduced and `prefers-reduced-motion` removes the effects. The approved day palette and composition, checkout behavior, backend behavior, and the 2.5D scene remain intact. Durable repository guidance now defines the Awwwards/Webby/FWA benchmark as a quality review standard without authorizing imitation, feature expansion, or accessibility/performance regressions.

### Unit 3.2 - Artist-Managed Template Catalog

Status: complete and migrated on 2026-10-06.

Payload Admin now has authenticated-only `Postcard Templates` and `Template Media` collections. Templates have customer-facing names, descriptions, preview relationships, deterministic sort order, and availability; preview images require alt text and validated JPEG/PNG/WebP raster content. Media remains in the existing private Supabase bucket under the enforced `template-media/` prefix. Narrow public endpoints expose only available catalog presentation data and stream only media referenced by an available template, without exposing generic Payload CRUD, object keys, or signed URLs. Forward migration `20261006_105253_add_postcard_template_catalog` enables RLS on both new tables, adds no public policies, and was applied as database migration batch 16. Post-migration verification found zero Template Media and zero Postcard Template records; no production content was seeded.

### Unit 3.3 - Multi-Portrait Cart Domain

Status: implementation and database migration complete on 2026-10-07.

The server now defines a private cart domain for one to five portrait items. Each portrait has one available template, one to three stable named person/pet subjects, its own artist note, deterministic position, and server-calculated 2000/2500/3000-cent price. Cookie-authorized, rate-limited endpoints provide narrow draft-cart list/add/replace/reorder/remove operations without changing the current purchase modal. Order Portraits define immutable paid template, subject, note, position, and amount snapshots for later webhook fulfillment. Order Uploads have optional forward-compatible portrait ownership and explicit subject-UUID mappings; the actual upload lifecycle remains Unit 3.4. Migration `20261007_101730_add_multi_portrait_cart_domain` adds the normalized private tables and mapping columns, enables RLS with no public policies, and keeps draft portraits lifecycle-owned by their Checkout Intent. It was applied as database migration batch 17 on 2026-10-07.

### Unit 3.4 - Upload and Draft Lifecycle Expansion

Status: implementation and database migration complete on 2026-10-10.

Portrait-owned private upload endpoints now support normalized photo creation, mapping/position edits, protected previews, removal, and safe cart recovery without changing the current public modal. The server enforces portrait ownership, stable subject UUID mappings, group-photo coverage, contiguous ordering, 15 MiB/50MP per-file limits, 30 MiB per portrait, and 15 files/100 MiB per cart. JPEG/PNG/WebP references are auto-oriented, re-encoded without source metadata, and rejected when animated, multipage, spoofed, malformed, or over limit. Storage writes occur outside database transactions with compensation on persistence failure; deletion revalidates after object removal and restores the object on database failure. Existing 24-hour expiry, 48-hour cleanup eligibility, paid-upload protection, legacy upload endpoints, Stripe, and the public UI remain unchanged. Forward migration `20261011_023404_support_portrait_upload_positions` changes position uniqueness from the whole Checkout Intent to each portrait while retaining a partial legacy-position constraint; it was applied as database migration batch 18 on 2026-10-10.

### Unit 3.5 - New Photo Booth Purchase Modal

Status: implementation, focused validation and user visual/manual acceptance complete on 2026-10-11.

The development-only `/checkout/preview` route now opens a template-first multi-portrait modal connected to the existing narrow catalog, cookie-authorized cart and private upload APIs. It supports stable named person/pet subjects, explicit group-photo mappings, coverage checks, private blob previews, per-portrait notes, additional portraits, cart editing/removal, confirmed-state refresh/reopen recovery and uncertain-write reload protection. It presents US/international shipping estimates and the approved final-sale policy while keeping payment disabled until Unit 3.6. The production build emits a 404 for this route and the homepage purchase entry remains unchanged. Legacy amount updates share the Intent transaction lock and reject portrait carts; legacy payment reservations also reject them before provider work. No schema, migration, dependency or provider configuration changed.

Focused client/domain/isolation tests, TypeScript, changed-file ESLint and the final production build passed. Isolated mocked browser checks covered two portraits, independent notes/designs, group-photo mapping edits, pending-assignment blocking, refresh recovery, portrait removal, US/international estimates, day/night presentation, desktop/mobile layouts and keyboard focus containment/restoration. Real database/Storage lifecycle fixtures and OS-level reduced-motion emulation were not run. Manual acceptance steps are in `docs/unit-3-5-acceptance.md`.

### Unit 3.6 - Stripe and International Flat Shipping

Status: approved on 2026-10-12 and split into two focused deliveries. International development destinations are provisionally all concretely enumerated Stripe-supported countries except unknown placeholders; final production destinations remain pending.

#### Unit 3.6.1 - Multi-Portrait Payment Core

Status: implementation, local validation and database migration complete on 2026-10-12; live payment lifecycle acceptance pending.

A narrow cookie-authorized, same-origin, rate-limited portrait payment endpoint now reserves immutable cart, photo mapping, template and policy snapshots before provider work. Stripe receives one server-priced line per portrait and one flat shipping rate; region-restricted countries prevent US addresses from selecting the 500-cent international rate. US tracked shipping is 1000 cents. Portrait payments remain Sandbox/card-only with Link, Adaptive Pricing and promotion codes disabled. Retries use the original frozen parameters and random attempt, including uncertain provider creation/finalization. Reserved preview media is protected from replacement/deletion with transaction-aware row locking.

Verified paid fulfillment validates frozen countries, exact amounts and upload ownership/mappings, transactionally creates all immutable Order Portraits and associates every upload with its paid portrait. Existing paid authority, private photos, refund/dispute reconciliation and outbox behavior are preserved. The homepage and development preview payment availability are unchanged.

Forward migration `20261012_103336_add_portrait_payment_snapshots` adds nullable payment snapshots, reserved preview references and paid portrait upload relationships; it was applied with user approval as database migration batch 19 on 2026-10-12. Post-apply read-only checks confirmed all four columns, both foreign keys and both indexes; all four affected tables retain RLS with zero policies. Baseline/final business-row counts were unchanged. No data backfill, new public policies or dependency/environment changes were made. Focused mocked tests, TypeScript, changed-file ESLint and production build passed. Database locking/lifecycle and Sandbox Session creation/expiration were subsequently verified in the authorized Unit 3.6.2 fixtures; an actual Hosted Checkout payment and Stripe-originated paid webhook remain pending. See `docs/unit-3-6-1-acceptance.md` and the Unit 3.6.2 live execution record below.

#### Unit 3.6.2 - Public Checkout Rollout and Minimum Artist Workbench

Status: implementation, local validation and authorized automated live lifecycle complete on 2026-10-12. User reported successful manual acceptance and explicitly approved replacing the homepage checkout on 2026-10-17; the new checkout is now the source-code default. Deployment remains separate.

Connect the accepted multi-portrait UI to payment and complete cancellation/resume/recovery. Move the minimum artist visibility from Unit 3.7 forward so every portrait's template, subjects, notes and up to fifteen Order photos are accessible before switching homepage purchase entry points. Do not release a multi-portrait storefront with the legacy three-photo workbench limit. Complete actual lifecycle and customer/artist acceptance before rollout.

The modal now requests portrait Checkout only after complete references and policy acceptance, displays shipping once and total, reads draft/payment state through a narrow no-provider recovery endpoint, and handles frozen payment resume, completion, expiration and uncertain requests without automatic retries. A dedicated fixed-price draft bootstrap avoids the legacy donation minimum and refuses existing Intent overwrite. Confirmed unpaid draft abandonment locks/rechecks status and preserves existing cleanup timing; active/paid payment protections remain intact. Legacy draft continuation remains available at `/checkout/legacy`.

Artist Orders now group up to five paid portraits and fifteen private references with immutable template previews, subjects/photo labels, notes and prices. The new authenticated template stream checks paid Order ownership and bypasses public optimization; legacy Orders and fulfillment restrictions remain unchanged.

The accepted multi-portrait modal is now the only homepage purchase UI and the development preview is connected to payment. The user subsequently authorized removing the rollout switch and old purchase components; see the cleanup record below. No `.env.local`, deployed/provider configuration, dependencies, schema/migration or real customer data changed. This changes source code, not deployed configuration, Stripe mode or production launch authorization.

With user authorization, real PostgreSQL/private Storage lifecycle checks passed on 2026-10-12: concurrent reservation, signed synthetic paid fulfillment/replay, full portrait/upload/outbox/ledger rollback, immutable catalog snapshots, five-portrait/fifteen-reference artist grouping and authenticated Payload HTTP private streams/anonymous denial. Actual Stripe Sandbox Session creation/resume, US/international countries/rates and expiration passed; two real test Sessions remain expired, not paid. Provider Session metadata was isolated from configured external application webhooks. Paid retrieval in signed synthetic webhook tests was injected, so actual Hosted Checkout payment and Stripe-originated paid webhook remain NOT RUN. Every business-row count and all 18 pre-existing Storage objects/ETags were restored; synthetic email jobs were made non-deliverable within their creation transaction, preventing cron delivery. No test email was sent. User/artist browser acceptance and rollout remain pending; see `docs/unit-3-6-2-acceptance.md` and `tests/integration/portrait-checkout-lifecycle.mjs`.

Acceptance update (2026-10-17): the user subsequently reported successful manual acceptance and approved replacing the homepage checkout. This supersedes the pending manual-acceptance/rollout wording in the 2026-10-12 execution record above. Individual manual Hosted Checkout, email and artist-review checks were not independently observed by the agent; no additional provider verification is claimed. The repository default is enabled, while deployment remains separate.

#### Accepted Checkout Cleanup - 2026-10-17

User-authorized scope: remove the rollout switch and old purchasing UI, retaining historical Orders and necessary payment processing. The homepage unconditionally uses `PortraitCheckoutModal`; its preview-only payment-disabled mode is removed, while coverage and policy gating remain required. The removed flag is no longer read, so stale environment entries have no effect. Removed the old modal, amount/photo/review/recovery step components and dedicated stylesheet. `/checkout/legacy` now redirects home. An old unreserved draft offers explicitly confirmed start-over rather than the retired UI; existing pending/created/completed payments retain resume/abandon/status handling. Shared backend compatibility, webhook/payment authority, legacy Order rendering and data are unchanged. No migration, provider action, environment edit or deployment is part of cleanup.

### Unit 3.7 - Artist Workbench Expansion

Status: planned; scope is not yet approved for implementation.

Polish the expanded secure workbench and adapt fulfillment/email presentation after the minimum visibility needed for Unit 3.6.2. Production deadlines remain blocked on the artist's explicit timing promise.

### Unit 3.8 - Policy and Production Readiness

Status: planned; scope is not yet approved for implementation.

Finish customer policy surfaces, delayed-shipment handling, upload/security hardening, monitoring, backup/restore, deployment procedures, and staging/production acceptance.

## Deferred work

- PayPal, Venmo, Zelle, and any second payment authority.
- USPS or third-party live carrier rating and label purchasing.
- Live Drawing implementation.
- Portfolio implementation.
- Broad global navigation and final About-page implementation until their product requirements are approved.
- Production launch without explicit user authorization.

## Documentation follow-up

The current README contains historical statements that no longer match implemented checkout, webhook, result-page, and order-workflow behavior. Correct it only in a focused documentation or production-readiness unit; do not expand Unit 3.0 into a broad README rewrite.
