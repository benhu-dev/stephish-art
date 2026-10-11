# Phase 3 - Unit 3.4: Upload and Draft Lifecycle Expansion

## Outcome

Extend the private reference-photo lifecycle to the multi-portrait cart without changing the current public purchase modal or payment path. Each draft portrait can own one to three normalized private reference photos, each photo explicitly maps to one or more of that portrait's stable subject UUIDs, and safe cart reads restore the photo state needed by the future modal.

The legacy single-portrait upload endpoints remain operational until Unit 3.5 switches the public UI to the new portrait workflow.

## Product and security decisions

1. Each portrait accepts one to three photos and never more photos than its subject count.
2. Each photo maps to one or more known subjects in that same portrait. One group photo may cover multiple subjects.
3. Before later checkout, every subject must be covered by at least one confirmed photo. This Unit exposes and validates readiness but does not alter Stripe checkout yet.
4. Accepted source formats remain JPEG, PNG, and WebP. Animated and multipage images are rejected.
5. Each source file is limited to 15 MiB and 50 megapixels.
6. Each portrait is limited to 30 MiB of stored reference photos. The full five-portrait cart is limited to 15 photos and 100 MiB.
7. Accepted images are auto-oriented and re-encoded in their detected format. Metadata, including EXIF and GPS data, is not copied to the stored object.
8. JPEG and WebP normalization uses high-quality output suitable for portrait reference; PNG normalization remains lossless.
9. Draft timing remains unchanged: a Checkout Intent is active for 24 hours and becomes cleanup-eligible after 48 hours. Paid or Order-owned uploads remain protected.
10. Upload request and byte limits complement the existing PostgreSQL-backed rate limits; they do not create public Storage or browser-direct uploads.

## Required behavior

1. Add a server-only portrait upload policy for per-file, pixel, per-portrait, cart-count, and cart-byte limits.
2. Add strict multipart parsing for portrait ID, photo position, and subject UUID mappings. Reject extra fields, malformed lengths, unexpected transfer encoding, and client-supplied authority.
3. Add narrow cookie-authorized, same-origin endpoints to upload a portrait photo, update its position/mappings, delete it, and stream its protected preview.
4. Lock and authorize the Checkout Intent for mutations, require `draft`, resolve the portrait by its public UUID within that Intent, and reject cross-intent or cross-portrait access.
5. Validate mappings only against that portrait's current subjects and enforce unique contiguous positions, one to three photos, no more photos than subjects, 30 MiB per portrait, 15 photos and 100 MiB per cart.
6. Normalize images before persistence: verify actual raster content, reject animated/multipage images and more than 50 megapixels, auto-orient, re-encode without source metadata, and persist the resulting MIME type, dimensions, and byte size.
7. Compensate Storage and database mutations on failure without exposing object keys or private metadata.
8. Extend the safe cart response with each portrait's photos, mappings, protected preview URL, byte totals, upload limits, and an explicit readiness result. Do not expose filenames, object keys, timestamps, or signed URLs.
9. Prevent subject replacement/removal from leaving stale upload mappings. Names and kinds may change while retaining stable subject UUIDs; removing a mapped subject must first update or remove affected photos.
10. Preserve cleanup ordering: delete eligible unpaid objects, then upload rows, then the Intent and its draft portraits. Never delete paid, Order-owned, active, or uncertain work.
11. Keep legacy storefront upload behavior and contracts unchanged until Unit 3.5.

## Scope

In scope:

- portrait-owned upload/create/update/delete/preview services and endpoints;
- photo-to-subject mapping and recovery contracts;
- image normalization, metadata removal, animation/multipage rejection, and pixel limits;
- per-portrait and per-cart count/byte enforcement;
- subject-edit consistency and draft cleanup compatibility;
- focused acceptance tests and one authorized synthetic live database/Storage lifecycle when useful.

Out of scope:

- public purchase-modal implementation or visual work;
- changing the legacy upload UI/API before Unit 3.5;
- Stripe Session creation, shipping, webhook fulfillment, paid Order portrait creation, refunds, disputes, email, or artist workbench presentation;
- changing 24-hour expiry or 48-hour cleanup eligibility;
- public Storage, signed URLs in public contracts, browser-direct uploads, or new authentication providers;
- production content, Live Drawing, Portfolio, About, or global navigation;
- new dependencies;
- applying a migration unless implementation proves that a forward migration is required and the user separately authorizes it.

## Acceptance

- An authorized draft portrait accepts 1–3 normalized photos, capped by subject count, with valid mappings to that portrait's subject UUIDs.
- A group photo can cover multiple subjects and readiness is true only when all subjects are covered.
- Cross-intent, cross-portrait, unknown-subject, duplicate-subject, invalid-position, oversized, over-count, over-budget, malformed, animated, multipage, spoofed, and over-50MP uploads fail safely.
- Stored JPEG/PNG/WebP content is decodable, correctly oriented, and contains no copied source EXIF/GPS metadata.
- Safe cart recovery exposes only photo ID, position, MIME type, dimensions, stored byte size, subject mappings, and a controlled preview URL.
- Mapping/position edits remain transactional and cannot create stale subject references or non-contiguous positions.
- Deletion removes the private object before its database row and restores the object if database persistence fails.
- Cleanup removes eligible unpaid portrait uploads and draft portraits while preserving every paid, Order-owned, active, and uncertain record.
- Existing homepage, current purchase modal, legacy upload lifecycle, Stripe, webhook, Order, email, and workbench behavior remain unchanged.

## Focused validation

1. Add focused acceptance tests for upload policy, multipart/JSON contracts, image normalization, endpoints, ownership, limits, mapping edits, safe response/recovery, subject-edit consistency, compensation, and cleanup compatibility.
2. Confirm a focused red failure before implementation when practical.
3. Run the new Unit 3.4 acceptance tests and existing affected cart, upload, cleanup, request-security, rate-limit, and collection tests.
4. Run TypeScript.
5. Run ESLint on changed handwritten and test files.
6. Run one production build after final runtime state.
7. Run one synthetic live database/Storage lifecycle only with explicit authorization, recording baseline/final counts and removing every fixture.
8. Run `git diff --check`.

## Authorized provider actions

No provider mutation is authorized by this mission alone. Local code/tests/build are authorized. A synthetic database/Storage lifecycle or migration apply requires separate explicit user authorization.

## Stop conditions

- Stop and ask before changing payment, shipping, webhook authority, paid-upload retention, or the current customer-facing checkout flow.
- Stop and ask before making Storage public, exposing object keys/signed URLs, adding database policies, introducing browser-direct uploads, or adding a dependency.
- Stop and ask if safe implementation requires a destructive migration, rewriting an applied migration, or changing the approved file/count/byte/retention limits.
- Do not commit or push.
