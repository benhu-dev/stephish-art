# Phase 3 - Unit 3.3: Multi-Portrait Cart Domain

## Outcome

Create the server-authoritative domain foundation for a Photo Booth cart containing one to five portrait items. Each draft portrait owns its template choice, one to three named subjects, per-portrait note, deterministic position, and server-calculated USD price. Define immutable paid portrait snapshot storage and explicit photo-to-subject mapping fields without yet changing the public purchase modal, upload lifecycle, Stripe checkout, webhook fulfillment, email, or artist workbench.

The current public checkout remains operational until later Units switch the UI and payment path to this new cart domain.

## Product decisions

1. A self-service cart contains one to five portraits.
2. Each portrait references one currently available postcard template while it is editable.
3. Each portrait contains one to three subjects. Every subject has a stable UUID, a required customer-facing name, an explicit `person` or `pet` kind, and a deterministic position.
4. People and pets use the same server-owned pricing: 2000 cents for one subject plus 500 cents for each additional subject, yielding 2000, 2500, or 3000 cents per portrait.
5. Each portrait has its own optional artist note. The existing checkout-level note remains temporarily for backward compatibility and is not used as the new cart authority.
6. Each future portrait upload belongs to exactly one draft portrait and stores one or more subject UUIDs. One group photo may map to multiple subjects. Before future checkout, every subject must be covered by at least one confirmed photo, and portrait photo count must be between one and its subject count.
7. Paid portrait snapshots preserve template name, description, preview-media reference and alternative text, subjects, per-portrait note, unit amount, and position so later template edits cannot change historical purchases.
8. Only verified Stripe webhook fulfillment may create paid Order portrait snapshots. This Unit defines their schema and validation boundary but does not connect or alter webhook fulfillment.

## Required behavior

1. Add an authenticated-only Payload collection for draft checkout portraits related to one Checkout Intent, with template, position, subjects, artist note, and server-owned amount fields.
2. Add an authenticated read-only Payload collection for immutable paid Order portraits related to one Order, with template and subject snapshot fields, position, note, and paid unit amount.
3. Add reusable server-only cart policy and validation functions for portrait counts, subject counts, names, kinds, UUIDs, positions, notes, prices, and photo-to-subject mappings.
4. Add narrow same-origin, HttpOnly-cookie-authorized draft cart endpoints that can list, add, replace, reorder, and remove portrait items only while the Checkout Intent is in `draft` state.
5. The server must load the selected template, require it to be available, calculate every portrait amount from its validated subjects, enforce unique contiguous portrait positions, and recompute the Checkout Intent subtotal transactionally after each mutation.
6. Public responses must use a fixed minimal contract and return template presentation data, subjects, per-portrait note, unit amount, subtotal, and cart limits without internal storage keys, credentials, database metadata, or privileged Payload documents.
7. Extend Order Upload schema with optional draft-portrait ownership and explicit mapped subject UUIDs, while leaving existing upload endpoints and lifecycle behavior unchanged until Unit 3.4.
8. Prevent deleting template media referenced by a paid portrait snapshot. Template availability changes or edits must not mutate existing paid snapshot fields.
9. Create one forward Payload migration for the new tables, relationships, constraints, and upload mapping columns. Enable RLS on every new application table and add no public `anon` or `authenticated` policy.
10. Regenerate Payload types and the Admin import map only through Payload tooling when required; do not hand-edit generated output.

## Scope

In scope:

- draft checkout portrait schema and authenticated Admin visibility;
- immutable paid Order portrait snapshot schema;
- subject identity and photo mapping representation;
- server-owned portrait pricing and cart subtotal calculations;
- cookie-authorized draft cart CRUD/reorder endpoints;
- forward migration, RLS review, focused tests, generated types/import map;
- compatibility with the current single-amount checkout until later Units switch consumers.

Out of scope:

- redesigning or connecting the public purchase modal;
- changing actual upload, preview, removal, cleanup, recovery, or object-storage behavior;
- requiring portrait ownership on existing uploads before Unit 3.4;
- changing Stripe Session creation, shipping, webhook fulfillment, Orders, refunds, disputes, email, fulfillment, or workbench presentation;
- applying the migration or mutating live database, Storage, Stripe, Resend, or deployment state;
- production content, Live Drawing, Portfolio, About, or global navigation;
- new dependencies.

## Acceptance

- One authorized draft Checkout Intent can own at most five portraits with unique contiguous positions.
- Every portrait has one available template, one to three valid named subjects, an optional bounded note, and an amount calculated only by server policy.
- A cart mutation transactionally persists the portrait change and recomputes the Checkout Intent subtotal; client-supplied prices are rejected or ignored and never authoritative.
- Cart endpoints reject cross-origin requests, malformed or unexpected bodies, invalid credentials, expired or non-draft intents, unavailable templates, invalid subjects, duplicate positions, and the sixth portrait.
- Safe cart responses contain no access-token hashes, Storage keys, signed URLs, upload filenames, timestamps, or Admin-only fields.
- Upload mapping validation supports one photo mapped to multiple known subjects, rejects unknown or duplicate subject UUIDs, and can verify that all subjects are covered with no more photos than subjects.
- Paid portrait snapshot fields are immutable through Payload Admin/public access and remain independent from later template edits.
- The forward migration creates only the required domain schema and relationships, enables RLS on new application tables, and creates no public policies.
- Existing homepage, current checkout UI, existing upload lifecycle, Stripe, webhook, Order, email, cleanup, and workbench behavior remain unchanged.

## Focused validation

1. Add focused acceptance tests for cart policy, collection access/configuration, endpoint request contracts, authorization, transactional mutations, pricing, snapshot immutability, upload mapping representation, configuration, and migration RLS.
2. Confirm the focused tests fail for the missing cart domain before implementation when practical.
3. Run focused Unit 3.3 acceptance tests.
4. Run existing focused checkout-intent, template-catalog, order-upload, and Orders collection acceptance tests affected by schema/configuration changes.
5. Run TypeScript.
6. Run ESLint on changed handwritten files.
7. Generate the migration/types/import map with Payload tooling, but do not apply the migration.
8. Run one production build after final schema and generated state.
9. Run `git diff --check`.

Do not run live database, Storage, Stripe, Resend, migration-apply, webhook, email, cleanup, or browser lifecycle suites for this domain-foundation Unit.

## Authorized provider actions

No live provider mutation is authorized. Creating local migration files and generated Payload artifacts is authorized; applying migrations, uploading media, and creating provider resources are not.

## Stop conditions

- Stop and ask before changing payment, shipping, webhook authority, upload retention/deletion, or the current customer-facing checkout flow.
- Stop and ask before adding public Payload CRUD, public Storage, database policies, or exposing signed object URLs.
- Stop and ask if safe transactional cart mutations require destructive migration or rewriting an applied migration.
- Stop and ask before applying migrations or mutating provider state.
- Do not commit or push.
