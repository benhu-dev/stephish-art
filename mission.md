# Phase 3 - Unit 3.2: Artist-Managed Template Catalog

## Outcome

Create the secure catalog foundation for artist-managed Photo Booth postcard templates. An authenticated Payload user can manage template records and preview media, while the public storefront can read only available templates through narrow same-origin endpoints.

This Unit establishes the catalog and media boundaries only. It does not add template selection to the purchase modal or change checkout, pricing, uploads, Stripe, Orders, email, or fulfillment behavior.

## Product decisions

1. Templates are managed through Payload Admin by authenticated `users` only.
2. A template has a customer-facing name, optional short description, preview media, explicit sort order, and availability state.
3. Preview media has required customer-facing alternative text and accepts only validated JPEG, PNG, or WebP raster images.
4. Template media uses the existing approved private Supabase bucket under an isolated `template-media/` object prefix. Do not create a public bucket or anonymous Storage policy.
5. The public storefront receives only available templates and minimum presentation metadata through controlled endpoints. Generic anonymous Payload CRUD remains denied.
6. The initial five concepts are not seeded because final names, media, and alternative text remain unapproved production content.
7. Future paid Orders will capture immutable template snapshots; this Unit does not change the current Order schema.

## Required behavior

1. Add a `template-media` upload collection with authenticated CRUD, required alternative text, safe Admin presentation, private S3 storage, bounded files, and actual raster validation.
2. Add a `postcard-templates` collection with authenticated CRUD and fields for name, description, preview media, sort order, and availability.
3. Keep template ordering deterministic by sort order and a stable tie-breaker without requiring fragile unique positions.
4. Prevent deletion of template media while a template still references it.
5. Add a public read-only template-list endpoint that:
   - returns available templates only;
   - returns a fixed minimal contract rather than Payload documents;
   - includes same-origin preview URLs and approved image metadata;
   - ignores client-supplied query authority;
   - returns generic errors without internal details.
6. Add a public preview endpoint that streams only media referenced by an available template, verifies stored metadata against the private object, and uses safe response headers.
7. Register both collections, their storefront endpoints, and the S3 collection prefix in the existing Payload configuration.
8. Create a forward Payload migration with RLS enabled on every new application table and no public `anon` or `authenticated` policy.
9. Regenerate Payload types and the Admin import map only through Payload tooling when required; do not hand-edit generated output.

## Scope

In scope:

- template and template-media Payload collections;
- authenticated Admin CRUD and field presentation;
- private object-storage prefix configuration;
- safe public catalog and preview contracts;
- forward migration and reviewed RLS;
- focused collection, endpoint, storage, migration, and configuration tests;
- required generated Payload types/import-map changes.

Out of scope:

- uploading or seeding final template assets;
- live Supabase Storage or database mutation;
- template selection UI or checkout-modal redesign;
- multi-portrait cart, subjects, photo mapping, pricing, or per-portrait notes;
- Checkout Intent, Stripe Session, webhook, Order, email, cleanup, or workbench changes;
- public Payload collection access, public Storage, or new authentication providers;
- Live Drawing, Portfolio, About, or global navigation;
- new dependencies.

## Acceptance

- Anonymous Payload CRUD is denied for both new collections; authenticated artists can manage them.
- Template preview files are private, prefixed, bounded, raster-validated, and limited to JPEG, PNG, or WebP.
- Referenced template media cannot be deleted before the referencing template is changed or removed.
- The storefront catalog contains only available templates, sorted deterministically, and exposes no internal upload keys, signed URLs, timestamps, or Admin-only fields.
- The preview endpoint cannot stream unreferenced or unavailable media and returns safe content headers for valid public previews.
- The migration creates only the required catalog/media schema and lock relationships, enables RLS, and creates no public policies.
- Existing checkout, Orders, private customer uploads, homepage, and 2.5D behavior remain unchanged.
- No live database, Storage, Stripe, Resend, or deployment state is mutated during acceptance.

## Focused validation

1. Add focused acceptance tests for collection fields, access, validation hooks, configuration, storefront contracts, media authorization, and migration RLS.
2. Confirm the focused tests fail for the missing catalog before implementation when practical.
3. Run the focused acceptance tests after implementation.
4. Run TypeScript.
5. Run ESLint on changed handwritten files.
6. Generate the migration/types/import map with Payload tooling, but do not apply the migration.
7. Run one production build after the final schema and generated state.
8. Run `git diff --check`.

Do not run live database, Storage, Stripe, Resend, migration-apply, webhook, checkout, email, or browser suites for this backend/catalog foundation Unit.

## Authorized provider actions

No live provider mutation is authorized. Creating local migration files and generated Payload artifacts is authorized; applying migrations and uploading media are not.

## Stop conditions

- Stop and ask before creating a new bucket, making Storage public, or adding anonymous/authenticated database policies.
- Stop and ask if template pricing or availability must become customer- or region-specific in this Unit.
- Stop and ask if safe media delivery requires exposing signed object URLs or generic Payload read access.
- Stop and ask before applying migrations or uploading production assets.
- Do not commit or push.
