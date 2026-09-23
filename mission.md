# Phase 2 — Unit 2.12.3: Restore Private Photo Previews After Refresh

## Goal

Fix the frontend so server-confirmed private photos automatically load and display after a full page refresh and Checkout Intent resume.

This is a focused correction to the current uncommitted Unit 2.12.2 work.

## Confirmed Failure

Manual reproduction already established:

1. A valid photo was uploaded successfully.

2. The page was fully refreshed.

3. The checkout modal was reopened.

4. Saving the amount resumed the existing Checkout Intent.

5. The response correctly included the confirmed upload metadata:

   * `status: draft`
   * upload `id: 263`
   * `position: 1`
   * `mimeType: image/jpeg`
   * `sizeBytes: 2140967`

6. The photo step displayed the “Uploaded JPEG” placeholder.

7. DevTools Network showed no request containing `preview`.

The browser never called:

`GET /api/storefront/checkout-intents/current/uploads/263/preview`

Therefore the known primary defect is in the frontend preview trigger or asynchronous state hydration. Intent-cookie authentication, Intent resume, and upload metadata restoration are already working.

The observed upload ID is diagnostic evidence only. Do not assume it still exists or modify it.

## Baseline

* Preserve all current uncommitted Unit 2.12.2 changes.
* `mission.md` is intentionally modified.
* Preserve all existing user records and Storage objects.
* Do not require a clean working tree.
* Record starting HEAD and Git status.
* Do not commit or push.

## Required Fix

When confirmed uploads arrive asynchronously after the photo UI has mounted:

* Automatically request each confirmed upload through its existing protected preview endpoint.
* Use the upload ID returned by the authenticated Intent response.
* Issue exactly one active preview request per current confirmed upload.
* Use same-origin credentials and `cache: no-store`.
* Show the artistic placeholder while loading.
* Replace it with the actual image after a successful response.
* Confirm the rendered image has non-zero natural dimensions.
* On failure, retain the placeholder and display the existing retry action.
* Retry must issue a new request and render the image on success.
* Do not require another refresh, navigation, Replace action, or re-upload.
* Do not fetch server previews for new local files that already have object URLs.
* Abort obsolete requests when uploads are removed, replaced, or the modal unmounts.
* Revoke all replaced or discarded blob URLs.
* Preserve Photo and Review previews, Replace, Remove, fixed positions, and current styling.
* Keep the final Checkout action non-operative.

Inspect effect dependencies, upload identity tracking, request-deduplication state, stale closures, and any logic that marks a restored upload as already requested.

Do not change the protected endpoint contract unless, after the frontend begins calling it, direct evidence reveals a separate endpoint defect. If a secondary defect appears, make only the smallest necessary correction and report it.

## Red-First Regression

Add a focused regression reproducing the real ordering:

1. Photo UI mounts with no confirmed uploads.
2. Intent resume completes asynchronously.
3. Confirmed upload metadata is added to client state.
4. Exactly one protected preview request starts automatically.
5. A successful image response creates a blob URL.
6. The actual image renders.

Also cover:

* No duplicate request after unrelated rerenders.
* Local previews cause no server preview request.
* Failed request exposes Retry.
* Retry makes one new request and succeeds.
* Remove, Replace, and unmount abort obsolete requests and clean blob URLs.
* Review uses the restored preview correctly.

Do not satisfy this test by mounting the component with uploads already populated.

## Real Browser Verification

Use an isolated browser context and uniquely identifiable synthetic image:

1. Run the production build and production server.
2. Open the storefront.
3. Save a valid amount through the real endpoint.
4. Upload one image through the real photo UI.
5. Confirm its database row and private Storage object exist.
6. Perform a full page reload.
7. Reopen the modal and resume the same Intent.
8. Advance to Photos.
9. Confirm the browser automatically requests the protected preview.
10. Confirm:

    * the request returns `200`,
    * the MIME type matches,
    * required private/no-store/nosniff headers remain,
    * the image renders with non-zero natural dimensions,
    * the placeholder is replaced,
    * no console errors occur,
    * and no cookie, token, hash, Storage key, bucket name, filename, signed URL, or credential is exposed.

A mocked browser check is not sufficient for completion.

## Scope Limits

Do not implement or change:

* Expired Intent cleanup or scheduled jobs
* Stripe or Checkout Session behavior
* Final Checkout button behavior
* Customer or Order creation
* Database schemas or migrations
* Dependencies, lockfiles, or environment variables
* Cookie format or authentication rules
* Storage privacy or access policies
* Public or signed image URLs
* Narrative animations or unrelated styling

Never print or log environment values, cookies, raw tokens, image contents, signatures, or private Storage identifiers.

## Validation

Run only:

* Focused preview/photo client tests
* Production-browser upload → refresh → resume regression
* Focused private Storage lifecycle
* TypeScript
* ESLint
* Production build
* `git diff --check`

Use only uniquely named synthetic records and files. Remove every fixture, Storage object, cookie, and browser profile created by this task. Preserve baseline data and report database and Storage counts before and after.

Stop all task-created servers and browsers.

## Completion Report

Report:

* `COMPLETE` or `BLOCKED`
* Starting and ending HEAD
* Proven code-level root cause
* Exact files changed
* Red-first regression result
* Real preview request URL pattern, HTTP status, and rendered-image evidence
* Test, TypeScript, lint, build, browser, and lifecycle results
* Before/after database and Storage counts
* Synthetic cleanup result
* Final Git status
* Confirmation that no Intent cleanup, Stripe, schema, migration, dependency, environment, public Storage, or unrelated UI change was introduced

Do not report `COMPLETE` unless the real production-browser upload → full refresh → Intent resume flow automatically displays the private image.
