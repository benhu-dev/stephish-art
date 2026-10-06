# Stephish Art Project Status

Last reviewed: 2026-10-06

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
- Approve the exact image-to-subject identification interaction for individual and group photos.
- Set per-file, per-portrait, per-cart, and per-source upload limits within the five-portrait product cap.
- Decide image normalization, metadata removal, animated/multipage policy, and aggregate stored-byte limits.
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

Status: planned; scope is not yet approved for implementation.

Add the reviewed Payload schema, access rules, media handling, Admin workflow, safe public read contract, migration, and focused tests for postcard templates.

### Unit 3.3 - Multi-Portrait Cart Domain

Status: planned; scope is not yet approved for implementation.

Design and implement draft and paid snapshots for up to five portrait items, subjects, per-portrait notes, photo ownership/mapping, and server-owned pricing.

### Unit 3.4 - Upload and Draft Lifecycle Expansion

Status: planned; scope is not yet approved for implementation.

Extend private uploads, recovery, editing, removal, rate limits, aggregate limits, content hardening, abandonment, and cleanup for the new cart model.

### Unit 3.5 - New Photo Booth Purchase Modal

Status: planned; scope is not yet approved for implementation.

Implement template selection, subject entry, photo mapping, portrait review, additional portraits, cart summary, shipping region, policies, accessibility, responsive behavior, and recovery.

### Unit 3.6 - Stripe and International Flat Shipping

Status: planned; scope is not yet approved for implementation.

Create authoritative multi-item Checkout Sessions, collect approved destinations, apply one flat shipping charge, verify totals and country during webhooks, and create the immutable paid Order graph.

### Unit 3.7 - Artist Workbench Expansion

Status: planned; scope is not yet approved for implementation.

Present each paid portrait's template, subjects, photos, note, amounts, shipping class, and production deadline in the existing secure workbench and adapt fulfillment/email presentation.

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
