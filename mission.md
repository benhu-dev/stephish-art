# Phase 2 — Unit 2.12.1: Fix Orphaned Upload Deletion

## Goal

Fix the confirmed defect where deleting an uploaded photo removes its `order_uploads` row and returns `204`, but leaves the corresponding object in the private `order-uploads` bucket.

Do not implement new functionality.

## Confirmed State

The current user-owned state is:

* One Checkout Intent
* One `order_uploads` row for Photo 2
* Two private Storage objects
* Photo 2 object: `ccc31af8-62e7-4aa0-9e20-1486486db15c.jpg`
* Suspected orphaned Photo 1 object: `5b8cc125-f590-4847-ae5a-43c7b247c5ca.png`

The app and database correctly retain only Photo 2. Do not delete or modify Photo 2, its row, or its owning Intent.

## Investigation

Reproduce and identify the exact root cause before changing code.

Inspect:

* The object key stored on the upload record
* The key passed to the S3/Supabase deletion operation
* Whether a URL, filename, encoded path, or incorrect prefix is being used
* Whether the storage delete operation reports success when the wrong or nonexistent key is supplied
* Whether the endpoint commits the database deletion without confirming object removal

Add a red-first regression that fails against the current implementation and exercises real private Storage behavior rather than only a mocked successful delete.

## Required Fix

A successful DELETE must guarantee:

1. The owning upload record is locked and validated.
2. The exact persisted Storage object key is used.
3. The intended private object is removed.
4. Object absence is verified.
5. The database row is deleted only as part of the existing safe transactional flow.
6. `204` is returned only when both the row and object are gone.

If object deletion fails or the object remains:

* Do not permanently delete the database row.
* Preserve or restore the consistent pre-request state.
* Return a safe error.
* Allow retry.

If database deletion fails after object removal, preserve the existing restoration guarantee.

Do not weaken ownership, cookie, origin, transaction, or private Storage controls.

## Existing Orphan Cleanup

After the root cause is proven and fixed, removal of this exact object is authorized only if all checks confirm it is unreferenced:

`5b8cc125-f590-4847-ae5a-43c7b247c5ca.png`

Before removing it, verify:

* No `order_uploads` row references its exact key or filename.
* No Order or other record references it.
* It is the confirmed Photo 1 object from this manual test.

Do not delete any other pre-existing object.

Expected retained user-owned state after cleanup:

* One Checkout Intent
* One upload row for Photo 2
* One Storage object: `ccc31af8-62e7-4aa0-9e20-1486486db15c.jpg`

## Verification

Run focused checks only:

* Upload two uniquely named synthetic images.
* Delete position 1 through the real endpoint.
* Confirm its row and exact Storage object are both gone.
* Confirm position 2 row and object remain unchanged.
* Confirm repeated Storage listing or HEAD checks cannot find the deleted object.
* Confirm failed or incorrect-key deletion cannot commit the row deletion.
* Confirm retry succeeds.
* Clean all synthetic fixtures.
* Confirm the retained user-owned Photo 2 row and object are unchanged.
* Run the existing Unit 2.12 deletion/client regression.
* Run TypeScript, ESLint, and production build.

Do not run Stripe, webhook, Customer, Order, scene, or unrelated suites.

## Restrictions

Do not change:

* Frontend UX except if required to handle the corrected error response
* Upload creation behavior
* Position behavior
* Private preview behavior
* Stripe
* Schemas or migrations
* Dependencies
* Environment files
* General cleanup jobs

Do not commit or push.

## Completion Report

Report:

* Confirmed root cause
* Exact fix
* Red-first regression evidence
* Real database and Storage deletion evidence
* Existing orphan cleanup evidence
* Final retained user-owned rows and objects
* Files changed
* Validation results
* Final Git status
