# Phase 2 — Unit 2.4: Private Order Upload Storage

## Goal

Connect Payload to the existing private Supabase Storage bucket through its S3-compatible endpoint and add a private upload collection for future customer reference photos.

This Unit verifies storage, file privacy, supported formats, and the 15 MB per-file limit. It does not expose customer uploads publicly or associate files with Orders yet.

## Current Baseline

- Phase 2 Unit 2.3 is committed.
- Customers, Orders, and Checkout Settings exist and remain private.
- `order-uploads` exists as a private Supabase Storage bucket.
- The bucket allows only JPEG, PNG, and WebP files with a 15 MB per-file limit.
- Required Supabase S3 values are present in the ignored `.env.local`.
- Payload 3.88.0 is installed.
- All existing Payload-owned public-schema tables have non-forced RLS and no permissive policies.
- The current `mission.md` modification and ignored `.env.local` values are intentional and authorized.

Record the starting HEAD and Git status. Never print, copy, rewrite, or expose environment values.

Stop if Unit 2.3 was not committed or unrelated uncommitted files exist other than `mission.md`.

## Storage Preflight

Before changing code:

- Confirm `.env.local` remains ignored and is not tracked.
- Confirm all five required variables exist and are non-empty without printing their values:
  - `SUPABASE_STORAGE_BUCKET`
  - `SUPABASE_STORAGE_ENDPOINT`
  - `SUPABASE_STORAGE_REGION`
  - `SUPABASE_STORAGE_ACCESS_KEY_ID`
  - `SUPABASE_STORAGE_SECRET_ACCESS_KEY`
- Confirm the configured bucket is exactly `order-uploads`.
- Confirm the endpoint uses HTTPS.
- Validate access only against the configured bucket. Do not enumerate or modify other buckets.
- Confirm through read-only Supabase metadata inspection that the bucket:
  - Exists
  - Is private
  - Has a 15 MB file-size limit
  - Allows only `image/jpeg`, `image/png`, and `image/webp`
- Confirm the bucket contains no unexpected existing objects. If it is not empty, stop before modifying or deleting anything.

Do not create Storage RLS policies. Supabase S3 credentials are server-only and bypass Storage RLS.

## Dependency

Install exactly:

`@payloadcms/storage-s3@3.88.0`

First verify that this exact version exists and is compatible with the installed Payload 3.88.0 packages. Stop on peer conflicts or if additional direct dependencies are required.

Expected dependency changes are limited to `package.json`, `package-lock.json`, and transitive dependencies required by the official adapter.

## Upload Collection

Add one upload-enabled collection:

- Slug: `order-uploads`
- Admin group: `Orders`
- Files required when creating a document
- Accepted MIME types:
  - `image/jpeg`
  - `image/png`
  - `image/webp`
- Remote URL or pasted-URL uploads disabled
- Local filesystem storage disabled
- No image sizes, public derivatives, custom thumbnails, alt text, customer data, order relationship, checkout relationship, or other business fields
- Useful Admin columns: filename, MIME type, file size, and creation time

Collection access:

- Read: authenticated Payload users only
- Create: authenticated Payload users only
- Update: authenticated Payload users only
- Delete: authenticated Payload users only

Future public uploads will use a controlled server-side flow in a later Unit. Do not make this collection anonymously writable.

Configure the official S3 adapter using only the five server-side environment variables.

Requirements:

- Use the configured private `order-uploads` bucket.
- Use the configured Supabase S3 endpoint and region.
- Use path-style S3 addressing if required by Supabase.
- Keep Payload access control enabled.
- Never use `disablePayloadAccessControl: true`.
- Use signed downloads for all stored order uploads.
- Do not generate a permanent public file URL.
- Do not enable client uploads in this Unit.
- Do not fall back to local storage when configuration is missing or incomplete.
- Fail safely without including secret values in errors or logs.

If an existing `.env.example` is present, add variable names with blank placeholder values only. Do not create or modify any real environment value.

Configure Payload's server upload limit to reject files larger than 15 MB if the installed Payload API supports this without affecting unrelated functionality.

## Migration and RLS

Register the collection and generate one reviewed Payload migration.

Allow only:

- The upload collection table and standard Payload upload metadata
- Required indexes and lock metadata
- RLS enablement for every new public-schema table
- Migration bookkeeping

Every new table must receive non-forced RLS in the same migration and have zero permissive policies.

Stop before applying if the migration changes existing application data, changes Customers, Orders, Checkout Settings, Users, disables RLS, modifies Supabase-managed schemas, or contains unexplained operations.

Apply only after inspection passes. Never run the down migration.

## Verification

Add focused acceptance coverage and verify:

- Exact collection, MIME, access, and storage-adapter configuration.
- Anonymous collection list, read, create, update, delete, and file download are denied.
- Authenticated Payload access permits intended Admin operations.
- Bucket remains private and has the expected bucket restrictions.
- New database tables have RLS enabled, FORCE disabled, and zero policies.
- Supabase `anon` and `authenticated` database roles cannot access upload metadata.
- Adapter never exposes S3 credentials to client bundles, generated files, logs, reports, or Git.
- No local upload directory or uploaded file is created in the repository.

Run a controlled end-to-end storage lifecycle test using a uniquely named tiny synthetic JPEG, PNG, or WebP fixture:

1. Upload through trusted Payload Local API access.
2. Confirm one database record and one object appear in the configured bucket.
3. Confirm ordinary anonymous metadata and file access are denied.
4. Confirm an authorized signed download succeeds.
5. Delete only the synthetic record through trusted Payload access.
6. Confirm the adapter deletes its corresponding bucket object.
7. Confirm the final database and bucket test-prefix counts return to zero.

Also verify:

- A disallowed non-image upload is rejected and persists nothing.
- A file larger than 15 MB is rejected and persists nothing.
- Test fixtures and temporary files are removed.
- Customers and Orders remain empty.
- Checkout Settings is unchanged.
- The administrator remains untouched.
- `/admin` and `/` work.
- Existing protected APIs remain denied anonymously.
- GraphQL routes remain unavailable.
- The postcard scene remains unchanged.

Run dependency, migration-status, import-map, Payload type-generation, lint, TypeScript, production-build, route, scene, and focused acceptance tests. Stop all temporary processes.

## Deferred Upload Rules

The intended customer workflow is one to three reference photos per checkout, with a 30 MB combined limit and the first photo treated as primary.

Do not implement those rules in this Unit because no Checkout Intent exists yet. This Unit enforces only the per-file format and 15 MB limit.

HEIC conversion will be handled by future frontend work. Do not accept HEIC directly.

## Excluded Work

Do not implement public or presigned customer-upload endpoints, client uploads, Checkout Intents, photo-to-Order relationships, Stripe, email, cleanup jobs, retention rules, frontend UI, HEIC conversion, real customer files, or Unit 2.5.

Do not modify `AGENTS.md` unless a blocking conflict is reported first.

## Completion Report

Report:

- Outcome: COMPLETE or BLOCKED
- Starting and ending HEAD
- Storage preflight without secret values
- Installed dependency result
- Collection and adapter configuration
- Migration and RLS evidence
- Anonymous-access and signed-download evidence
- Synthetic upload/delete lifecycle result
- Final database and bucket object counts
- Validation results
- Files changed and final Git status
- Confirmation that no secrets, real uploads, public endpoint, local fallback, Checkout Intent, Stripe, frontend work, or Unit 2.5 was introduced