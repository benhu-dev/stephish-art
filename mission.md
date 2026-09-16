# Phase 2 — Unit 2.6: Controlled Checkout Intent and Upload API

## Goal

Add the controlled storefront API for creating or resuming a Checkout Intent and managing its private reference-photo uploads.

This Unit makes the backend workflow callable by the future frontend. It does not add frontend UI, Stripe, Orders, Customers, email, or cleanup jobs.

## Baseline

* Phase 2 Unit 2.5 is committed at `f6dba58`.
* Checkout Intents, Order Uploads, Checkout Settings, private Supabase Storage, token helpers, expiry policy, and database constraints already exist.
* Direct anonymous Payload collection access remains denied.
* The working tree must be clean except for the authorized `mission.md` change.
* `.env.local` remains ignored and must never be printed or modified.

Record starting HEAD and Git status. Stop on unrelated changes.

## Storefront Endpoints

Implement these as Payload root-level custom endpoints under the existing `/api` prefix:

* `POST /api/storefront/checkout-intents`
* `GET /api/storefront/checkout-intents/current`
* `POST /api/storefront/checkout-intents/current/uploads`
* `DELETE /api/storefront/checkout-intents/current/uploads/:uploadId`

Do not modify or replace Payload’s normal collection REST routes.

All responses must use `Cache-Control: no-store`.

### Create or Resume Intent

`POST /api/storefront/checkout-intents` accepts JSON containing exactly:

* `amountCents`: finite positive integer

Read the current `minimumAmountCents` from Checkout Settings through trusted server-side Payload access. Do not hardcode 500 in the endpoint.

Reject missing, string, fractional, non-finite, unsafe, or below-minimum values without persisting anything.

If the request has a valid cookie for an unexpired `draft` Intent:

* Reuse the same Intent.
* Update only `amountCents`.
* Do not rotate the token.
* Do not extend `expiresAt` or `deleteAfter`.

Otherwise:

* Generate credentials using the existing Unit 2.5 helper.
* Create a `draft` Intent with the existing 24-hour expiry and 48-hour deletion policy.
* Store only the token hash.
* Set the raw token only inside the protected cookie.

Return `201` for a new Intent and `200` for a resumed Intent.

### Session Cookie

Use one cookie named:

`stephish_checkout_intent`

The cookie must:

* Be `HttpOnly`
* Use `SameSite=Strict`
* Use `Secure` in production
* Have no `Domain`
* Use path `/api/storefront/checkout-intents`
* Expire no later than the Intent
* Contain a versioned internal representation of the Intent identifier and raw token
* Never contain the token hash or other data

Never return the raw token in JSON, headers other than `Set-Cookie`, logs, errors, generated files, or client-visible code.

Missing, malformed, unknown, expired, or incorrect credentials must receive a generic unauthorized response without revealing whether an Intent ID exists. Clear malformed or expired cookies.

### Safe Response

Create/resume and current-state responses may return only:

* `status`
* `amountCents`
* `expiresAt`
* Upload entries containing `id`, `position`, `mimeType`, and `sizeBytes`
* Current safe limits:

  * `minimumAmountCents`
  * `maxFiles: 3`
  * `maxFileBytes: 15728640`
  * `maxTotalBytes: 31457280`
  * JPEG, PNG, and WebP MIME types

Do not return:

* Checkout Intent ID
* Raw token or token hash
* `deleteAfter`
* Storage keys, filenames, bucket names, credentials, permanent URLs, or signed URLs
* Internal Payload metadata

`GET /current` must require a valid cookie and must not mutate or extend the Intent.

## Controlled Upload

`POST /current/uploads` accepts multipart form data containing exactly:

* One file
* One integer `position` from 1 through 3

Use Payload’s supported multipart/file parsing and the existing 15 MiB server limit.

Validate on the server:

* The Intent credential is valid.
* The Intent is `draft` and unexpired.
* Position is 1, 2, or 3.
* The position is not already occupied.
* The Intent has fewer than three uploads.
* The file is non-empty and no larger than 15 MiB.
* Existing files plus the incoming file do not exceed 30 MiB.
* Declared MIME type and detected content are both JPEG, PNG, or WebP and agree.
* The file is a decodable image with valid dimensions.
* Decoded pixel count does not exceed 100 megapixels.

Use the existing image library if already installed. Do not add a dependency solely for validation.

Ignore the client filename. Generate a cryptographically unique server filename with the extension determined from verified content. Do not store or return the original filename.

Do not resize, recompress, alter, or remove metadata from accepted images in this Unit.

## Transaction and Concurrency

Aggregate limits must be transactionally enforced.

For upload and deletion mutations:

* Start a database transaction.
* Lock the owning Checkout Intent row before checking state, count, positions, or combined size.
* Revalidate credentials, status, and expiry inside the lock.
* Use parameterized queries only.
* Pass the transaction through trusted Payload operations.
* Commit only after the database and storage operation succeeds.
* On failure, roll back and compensate for any newly created storage object so no orphan remains.

The existing compound uniqueness constraint remains the final protection against duplicate positions.

Concurrent requests must never produce:

* More than three uploads
* Duplicate positions
* More than 30 MiB combined
* Orphaned database rows or bucket objects

If the installed adapter cannot safely support this flow, stop and report the exact limitation rather than weakening atomic enforcement.

## Delete Upload

`DELETE /current/uploads/:uploadId` must:

* Require the valid owning cookie.
* Allow deletion only while the Intent is `draft` and unexpired.
* Verify the upload belongs to that Intent.
* Delete both its Payload record and corresponding private bucket object.
* Return `204` on success.

Do not renumber remaining positions. A deleted position may be filled by a later upload.

A missing or non-owned upload must return a generic not-found response without disclosing ownership.

## Request Security

For every state-changing storefront endpoint:

* Require a same-origin `Origin`.
* Reject missing, malformed, or cross-origin origins.
* Do not add permissive CORS headers.
* Reject unexpected content types, fields, files, and bodies.
* Use bounded request parsing.
* Return stable error codes without stack traces or internal details.

Do not add a misleading in-memory rate limiter. Production edge rate limiting or bot protection remains required before public deployment and is outside this Unit.

## Schema and Dependencies

No collection, Global, database schema, environment, or dependency change is expected.

Do not generate or apply a migration. Stop if schema drift or a migration becomes necessary.

Do not weaken existing access rules. All trusted writes must explicitly use server-side access override only inside the controlled service.

## Verification

Add focused red-first tests covering:

* Exact endpoint and response contracts.
* Checkout Settings is the minimum source rather than a hardcoded value.
* New Intent creation and same-cookie resume.
* Cookie flags, expiry, and absence of raw credentials from responses and logs.
* Invalid amount and request rejection with no persistence.
* Valid current-state access and generic invalid-cookie rejection.
* Same-origin enforcement.
* One, two, and three valid uploads.
* Positions and the exact 15 MiB per-file and 30 MiB combined boundaries.
* Invalid, mismatched, corrupt, oversized, excessive-pixel, duplicate-position, and fourth-file rejection.
* Concurrent uploads cannot bypass count, position, or aggregate limits.
* Cross-Intent reads and deletions are denied.
* Successful deletion removes database and storage objects.
* Forced failures leave no database or bucket residue.
* Expired or non-draft Intents cannot upload or delete.
* Direct anonymous Payload and unsigned Storage access remain denied.

Use only uniquely named synthetic records and files. Remove all created rows, objects, cookies, and fixtures.

Final counts must return to:

* Checkout Intents: 0
* Order Uploads: 0
* `order-uploads` test objects: 0
* Customers: 0
* Orders: 0

Run the existing acceptance, migration-status, type generation, import-map, TypeScript, lint, production-build, route, GraphQL-denial, and postcard-scene regression checks. Stop temporary processes.

## Excluded Work

Do not implement:

* Frontend components or forms
* Public upload credentials or direct browser-to-S3 uploads
* Presigned client uploads or download/preview endpoints
* Stripe or Checkout Sessions
* Customers or Orders creation
* Checkout status transitions beyond existing draft behavior
* Email
* Cleanup or scheduled jobs
* CAPTCHA, WAF, or deployment rate limiting
* HEIC conversion
* Admin changes
* Unit 2.7

Do not modify `AGENTS.md`. Do not commit or push.

## Completion Report

Report:

* `COMPLETE` or `BLOCKED`
* Starting and ending HEAD
* Final endpoint, cookie, and safe-response contracts
* Transactional upload enforcement and concurrency evidence
* Origin, credential, and direct-access denial evidence
* Synthetic database and Storage lifecycle results
* Final row and bucket-object counts
* Dependency and migration status
* Validation results
* Files changed and final Git status
* Confirmation that no secrets, raw tokens, frontend, Stripe, Orders, Customers, email, cleanup job, schema migration, dependency change, or persistent test data was introduced
