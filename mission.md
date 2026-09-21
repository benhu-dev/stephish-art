# Phase 2 — Unit 2.11: Connect the Amount Step

## Goal

Connect the artistic checkout modal’s amount step to the existing controlled Checkout Intent API.

This Unit ends after a Checkout Intent is successfully created or resumed. Do not upload photos or start Stripe Checkout yet.

## Preflight

* Record the starting HEAD and Git status.
* Confirm Unit 2.10 and its transition refinements are committed.
* Stop on unrelated changes other than the intentional `mission.md`.
* Do not read, print, or modify environment values.

## Amount Submission

When the user submits the first modal step:

* Validate the dollar input locally.
* Convert it to integer cents without floating-point rounding.
* Send exactly:

`POST /api/storefront/checkout-intents`

with JSON:

`{"amountCents": <positive integer>}`

Use same-origin credentials, `Content-Type: application/json`, and `cache: no-store`.

Do not send any extra fields.

Examples:

* `$5` → `500`
* `$8.25` → `825`
* `$12.50` → `1250`

Reject empty, malformed, negative, zero, scientific notation, commas, and values with more than two decimal places before making a request.

The server remains authoritative for the current minimum. Keep the existing `$5` initial UI guidance, but accept and display safe server validation if the configured minimum differs. Do not add a settings endpoint or hardcode backend policy into a new location.

## Success Behavior

Treat both responses as success:

* `201` — new Intent
* `200` — existing draft Intent resumed

Strictly validate the existing safe response contract.

After success:

* Use the server-returned `amountCents`.
* Update the displayed minimum and limits from the safe response when provided.
* Advance to the photo step.
* Preserve the existing artistic transition and modal styling.
* Keep all credentials inside the existing HttpOnly cookie.
* Do not read or expose the cookie, Intent ID, token, hash, Storage information, or internal metadata.

If the user goes back and changes the amount, submit it again before advancing. The existing backend must resume the same eligible draft Intent.

## Loading and Errors

* Prevent double submission and overlapping requests.
* Disable the forward action while the request is pending.
* Show a restrained in-style loading state such as `Saving your amount…`.
* Keep the user on the amount step after validation, network, unauthorized, or server errors.
* Show safe, understandable inline messages without stack traces or internal error details.
* Allow retry.
* Do not discard the entered amount after a failed request.
* Restore normal controls after completion or failure.

Do not display a fake success state when the request fails.

## Remaining Modal Steps

Keep the existing photo and review interfaces client-only for this Unit.

* Do not upload or delete files.
* Do not create a Checkout Session.
* The final Stripe action must remain visibly unavailable or non-operative.
* Do not create Customers or Orders.
* Do not change the existing local preview lifecycle.

## Focused Verification

Add focused tests for:

* Exact dollar-to-cent conversion.
* Invalid values make zero requests.
* Exact request method, URL, headers, credentials, and JSON body.
* `201` creates the ready state and advances once.
* `200` resumes and advances once.
* Server-returned amount and limits become authoritative.
* Double-clicking makes one request.
* Loading state and disabled controls.
* Validation, network, `401`, `400`, and `5xx` failures remain on the amount step and can retry.
* No credential or internal identifier appears in the DOM, state, URL, logs, or error copy.
* Going back and changing the amount submits the updated cents.
* Photo selection remains local-only.
* The final action makes no Stripe or upload request.
* Modal accessibility, focus behavior, themes, responsive layouts, and narrative scene remain unchanged.

Run only:

* Focused Unit 2.11 tests
* Existing Unit 2.10 modal and scene regressions
* TypeScript
* ESLint
* Production build

Do not run database, Storage, webhook, Stripe lifecycle, or unrelated backend suites.

## Excluded Work

Do not change:

* Backend endpoint behavior
* Photo upload integration
* Upload deletion
* Stripe Checkout Session integration
* Success or cancellation pages
* Customer or Order creation
* Schemas or migrations
* Dependencies
* Environment files
* Narrative copy, animation timing, or scene artwork

Do not commit or push.

## Completion Report

Report:

* Starting and ending HEAD
* Request and amount-conversion contract
* Loading, retry, and error behavior
* New-versus-resumed Intent behavior
* Focused validation results
* Files changed and final Git status
* Confirmation that no upload, Stripe, backend, schema, migration, dependency, or environment change was introduced
