# Phase 2 — Unit 2.13: Persist the Private Artist Note

## Goal

Persist the optional “Private note for the artist” across refresh and copy it into the fulfilled Order.

Keep this as one cohesive vertical slice. Do not activate the final Stripe Checkout button.

## Baseline and Scope

Unit 2.12.3 is committed and pushed. Record HEAD and `git status --short`. The only expected initial modification is `mission.md`.

Read `AGENTS.md`, then inspect only the existing implementations directly related to:

* Checkout Intents
* Orders
* Storefront Intent endpoints and services
* Checkout modal Photo and Review steps
* Webhook Order fulfillment
* Payload migrations and generated types

Do not broadly reread or retest the postcard scene, private preview implementation, Storage adapter, Stripe Checkout gateway, success/cancel pages, or unrelated collections unless a direct compile failure requires it.

Never print or modify `.env.local`. Do not commit or push.

## Data Contract

Add optional plain-text `artistNote` fields to Checkout Intents and Orders.

Rules:

* Maximum 1,000 characters.
* Normalize CRLF to LF.
* Trim outer whitespace.
* Store blank or whitespace-only input as `null`.
* Preserve internal line breaks.
* Treat it as untrusted private text.
* Never render it as HTML or Markdown.

The Order field is an immutable snapshot created only through trusted webhook fulfillment. Admins may read it but not edit it.

Create, review, and apply one focused migration. Regenerate Payload types.

## Controlled Endpoint

Add:

`PUT /api/storefront/checkout-intents/current/artist-note`

Contract:

* Existing HttpOnly Intent cookie authentication.
* Same-origin `Origin` required.
* `application/json` only.
* Accept exactly `{"artistNote":"..."}`.
* Reject missing, extra, malformed, non-string, or over-limit input.
* Permit only unexpired `draft` Intents.
* Use `Cache-Control: no-store`.
* Return only the normalized `artistNote`, using an empty string when stored as `null`.
* Preserve existing generic credential errors.

Include `artistNote` in authenticated create/resume and current safe responses so a saved value can be restored after refresh.

Do not expose it through unauthenticated routes, URLs, logs, cookies, browser storage, Stripe metadata, or errors.

## Frontend

Keep the current note field and artistic styling.

When Continue is selected from Photos:

1. Finish or reconcile the selected photo uploads.
2. Save the note.
3. Enter Review only after both operations succeed.

Requirements:

* One pending state; prevent duplicate submission.
* A failed note save stays on Photos, preserves the text, and is retryable.
* Do not repeat successful photo uploads when retrying the note.
* Restore the confirmed note after refresh and Intent resume.
* Going Back and editing it updates the saved value.
* Clearing it persists the cleared value.
* Review shows the server-confirmed note only when non-empty.
* HTML-like input renders as ordinary text.
* Final Checkout remains non-operative.

## Fulfillment

In the existing paid webhook transaction, copy the normalized Intent note into the Order.

Webhook replay or concurrency must continue producing one Order with the same immutable note snapshot.

Do not otherwise change Stripe, Customer, payment, upload, or fulfillment behavior. Do not make real Stripe requests for this Unit.

## Focused Verification Only

Add focused red-first coverage for:

* Normalization, clearing, Unicode, line breaks, 1,000-character boundary, and rejection over the limit.
* Exact endpoint contract, cookie authentication, same-origin enforcement, draft/expiry enforcement, and no mutation on invalid input.
* Frontend save, pending, failure retry, no duplicate photo upload, refresh restore, edit, clear, and Review rendering.
* Webhook fulfillment copies the note exactly once and replay retains the same snapshot.
* The note does not enter Stripe parameters, URLs, logs, cookies, or browser storage.

Run:

* Only the new or directly affected acceptance/integration tests
* One focused modal browser check for save → Review → refresh → restore
* Payload type generation
* Migration status
* TypeScript
* ESLint once at the end
* Production build once at the end
* `git diff --check`

Do not run:

* Full acceptance suite
* Real Stripe lifecycle
* Full webhook payment matrix
* Storage lifecycle
* Preview lifecycle
* Postcard scene regression
* Multiple viewport/theme/reduced-motion matrix
* GraphQL denial regression
* Unrelated route checks

Use uniquely identified synthetic fixtures and remove only those fixtures. Confirm affected Intent and Order counts return to their starting values. No full database or Storage audit is required.

Stop task-created processes.

## Excluded Work

Do not add or change:

* Final Checkout behavior
* Real Stripe Sessions or payments
* Intent cleanup jobs
* Email
* Customer fields
* Storage or preview behavior
* Dependencies or environment variables
* Narrative or unrelated UI
* Unit 2.14

## Completion Report

Provide a concise report containing:

* `COMPLETE` or `BLOCKED`
* Starting and ending HEAD
* Root files changed
* Endpoint, normalization, frontend restore, and Order snapshot results
* Migration and focused validation results
* Synthetic cleanup and final Git status
* Confirmation that excluded systems were not changed or tested

Do not commit or push.
