# Mission: Phase 2 — Unit 2.5: Checkout Intent Data Model

## Goal

Add a private Checkout Intents data model that securely associates a guest’s selected amount with up to three temporary reference-photo uploads before payment.

This Unit establishes the internal schema and security policy only. Do not add public checkout/upload endpoints, cookies, Stripe integration, scheduled cleanup, email, or frontend changes.

## Baseline and decisions

Confirm Unit 2.4 is committed before changing code.

The approved behavior is:

- A Checkout Intent expires 24 hours after creation.
- It becomes eligible for deletion 48 hours after creation.
- Future same-browser recovery will use a Secure, HttpOnly, SameSite=Lax cookie.
- The raw recovery token must never be stored in the database, URLs, logs, analytics, or browser storage.
- The database stores only a SHA-256 hash of a cryptographically random 256-bit token.
- A Checkout Intent stores no customer PII: no name, email, phone, address, IP address, or user-agent fingerprint.
- One to three photos are required before checkout can begin.
- Position 1 is the primary photo; positions 2 and 3 are supplemental.
- Each file remains limited to 15 MiB.
- Combined files are limited to 30 MiB.
- The current Checkout Settings minimum is enforced later by the public checkout service. The schema minimum remains one cent so configuration changes do not invalidate existing Intents.

Preserve the existing private Supabase Storage configuration and all completed collection behavior.

## Required implementation

### 1. Checkout policy and token utilities

Add a server-only checkout-intent policy module containing one authoritative definition for:

- 24-hour active lifetime
- 48-hour deletion eligibility from creation
- maximum three uploads
- 15 MiB per file, reusing the existing upload limit where practical
- 30 MiB combined upload limit

Add small server-only utilities that:

- generate 32 random bytes using Node cryptography
- encode the raw token safely for a future cookie
- hash it with SHA-256 for database lookup
- calculate `expiresAt` and `deleteAfter` from the same creation time

The raw token may only be returned to the immediate trusted caller. Never log or persist it.

Do not add a cookie or public route in this Unit.

### 2. Checkout Intents collection

Add and register a collection with slug `checkout-intents`, grouped under Orders in Admin.

It must be read-only for authenticated Payload administrators through ordinary Payload access:

- read: authenticated Payload users only
- create: denied
- update: denied
- delete: denied
- duplication and bulk mutation disabled

Future trusted server services will use the Local API with an explicit access override.

Add only these stored business fields:

- `status`
  - required select
  - default `draft`
  - exact values: `draft`, `checkout_created`, `completed`, `expired`
- `amountCents`
  - required integer
  - minimum 1
- `accessTokenHash`
  - required and unique
  - exactly 64 lowercase hexadecimal characters
  - hidden from Admin
  - omitted from ordinary API responses through field access control
  - immutable through ordinary access
- `expiresAt`
  - required date
  - indexed
- `deleteAfter`
  - required date
  - indexed
  - must be later than `expiresAt`

Keep Payload timestamps enabled.

Add a virtual `uploads` Join field backed by `order-uploads.checkoutIntent`, sorted by `position`, limited to three, and unable to create uploads from the Join UI.

Do not add Stripe IDs, Order relationships, customer fields, shipping fields, marketing data, analytics data, or plaintext tokens.

### 3. Order Upload ownership

Extend `order-uploads` with:

- `checkoutIntent`
  - required relationship to `checkout-intents`
  - indexed
- `position`
  - required integer
  - allowed values 1 through 3
  - position 1 represents the primary photo

Add a compound unique index for `checkoutIntent` plus `position`.

The combination of the position range and unique index must prevent an Intent from owning more than three correctly positioned uploads. Do not store the relationship a second time.

Do not introduce database cascading deletion from Checkout Intents to upload rows. Future cleanup must delete each upload through Payload first so the storage adapter also deletes its Supabase object.

Preserve the existing Order Upload MIME, file-size, private access, signed-download, S3, and local-storage settings.

The 30 MiB aggregate check cannot be guaranteed by this schema alone. Keep its policy constant and explicitly defer transactional aggregate enforcement to the future public upload service.

### 4. Migration and RLS

Generate one migration only after reviewing the proposed schema changes.

The migration may add only:

- the Checkout Intents table and expected indexes
- the required Order Upload ownership fields, foreign key, validation/index structures
- expected Payload lock-relation metadata
- the migration-ledger entry

Enable ordinary, non-FORCED RLS on every new table in the same migration. Create no permissive policies.

Do not use schema push, disable existing RLS, rewrite existing records, modify unrelated tables, or add cascading deletion.

The `order_uploads` table is expected to be empty. Stop if it contains unexpected rows or the bucket contains unexpected objects.

## Acceptance criteria

Add focused red-first acceptance coverage proving:

- the exact Checkout Intents schema and access rules
- no PII fields exist
- token generation produces high-entropy, non-repeating raw tokens
- hashes are deterministic 64-character lowercase hexadecimal values
- raw tokens are never included in persisted create data
- deadlines are exactly 24 and 48 hours from the same creation time
- amount values are integers of at least one cent
- upload positions outside 1–3 are rejected
- duplicate positions for one Intent are rejected
- the same position may be used by different Intents
- the token hash is absent from ordinary administrator and anonymous API output
- anonymous Checkout Intent CRUD is denied
- authenticated administrators can list/read but cannot ordinarily create/update/delete
- Supabase `anon` and `authenticated` database roles cannot read or mutate Checkout Intent or upload ownership data
- all Payload tables retain non-FORCED RLS
- GraphQL remains unavailable

Run one controlled synthetic Local API lifecycle:

1. Generate a synthetic credential.
2. Create one Checkout Intent through an explicit trusted Local API override.
3. Upload one tiny synthetic PNG linked at position 1.
4. Confirm the Join returns that upload and does not expose the token hash through ordinary access.
5. Delete the upload through Payload so its Supabase object is removed.
6. Delete the synthetic Intent through an explicit trusted override.
7. Confirm final Checkout Intent, Order Upload, and bucket counts return to zero.

Delete only records and objects created by this test.

Run dependency validation, migration status, Payload type and import-map generation, focused acceptance tests, lint, TypeScript, production build, route checks, GraphQL checks, and the existing postcard scene regression. Stop all temporary processes.

## Exclusions

Do not add:

- public Checkout Intent or upload endpoints
- cookies or browser token storage
- direct/client-presigned uploads
- automatic cleanup jobs
- Stripe Checkout or webhooks
- Customer or Order creation
- email
- frontend forms
- HEIC conversion
- analytics
- Phase 2 Unit 2.6 work

Do not change dependencies, environment files, Supabase bucket settings, AGENTS.md, frontend code, artwork, or assets unless an actual blocker requires approval.

## Stop conditions

Stop and report BLOCKED if:

- the repository contains unexpected pre-existing changes beyond the authorized `mission.md`
- Unit 2.4 is not committed
- existing upload rows or unexpected bucket objects are present
- the migration includes destructive or unrelated operations
- the ownership constraints cannot be represented safely
- any test would require deleting non-synthetic data or objects
- credentials would need to be printed, exposed, or committed
- completing the Unit requires a public endpoint, cookie, Stripe, or cleanup job

## Completion report

Report COMPLETE or BLOCKED and include:

- starting and ending HEAD
- changed files
- exact collection fields and access behavior
- token/deadline test evidence
- migration and RLS inspection
- ownership/index evidence
- synthetic lifecycle and cleanup results
- final database and bucket counts
- regression results
- final Git status
- confirmation that no PII, raw token, secret, public endpoint, cookie, Stripe integration, or persistent test data was introduced

Do not commit or push.