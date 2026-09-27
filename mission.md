# Phase 2, Unit 2.14.3 — Optional Checkout Recovery Probe

## Goal

Stop the passive checkout recovery check from producing an expected `401 Unauthorized` when there is no resumable checkout.

“No checkout to recover” is a normal empty result. It must not appear as an application error, affect the Amount step, or produce a red 401 request in the browser console.

Keep this Unit small and focused.

## Required behavior

Add a dedicated optional recovery contract at:

`GET /api/storefront/checkout-intents/current/recovery`

Update the existing checkout recovery client to use this endpoint instead of using a strict protected endpoint as a passive probe.

### Response contract

- `200` — a resumable checkout exists.
  - Preserve the existing safe recovery response shape.
  - Do not expose Intent IDs, Stripe IDs, tokens, Storage data, PII, or internal state.

- `204 No Content` — no resumable checkout exists.
  - This includes:
    - no checkout cookie;
    - malformed, unknown, expired, or stale credentials;
    - missing Intent;
    - completed, expired, or abandoned Intent;
    - no reusable/open Checkout Session.
  - Return an empty body.
  - Apply `Cache-Control: no-store`.
  - Clear a stale checkout cookie when appropriate.

- `500` or `503` — an authenticated recovery candidate exists, but the database, Stripe lookup, or another required dependency genuinely fails.
  - Return only the existing generic safe error contract.

### Browser behavior

- Treat `204` as a successful empty result.
- Do not throw, log, render, or retain an error for `204`.
- Reset stale recovery state and leave the customer on a clean Amount step.
- The customer must be able to create a new Checkout Intent normally.
- Abort and unmount cancellation must not create console errors or late state updates.
- Genuine network or `5xx` failures may use the existing safe retry/error behavior.

## Preserve existing security contracts

- Do not weaken the strict authentication behavior of existing protected `/current`, upload, preview, status, checkout-session, abandon, or webhook endpoints.
- Do not accept identifiers or credentials from query parameters, request bodies, or custom headers.
- Do not create a Stripe Checkout Session during recovery.
- Do not create Customers or Orders.
- Preserve existing same-origin, no-store, HttpOnly-cookie, Stripe Test-mode, and safe-response rules.
- Preserve any existing safe reconciliation needed to determine whether a Session is resumable.

## Focused acceptance coverage

Add only focused tests proving:

1. No cookie returns `204`, an empty body, and no-store.
2. Invalid, unknown, expired, completed, and abandoned checkout credentials produce the same generic `204`.
3. A genuinely resumable checkout returns the unchanged safe `200` response.
4. A real dependency failure returns a generic `500` or `503`, not `204`.
5. The browser recovery client treats `204` as a normal empty result.
6. A fresh visit and a post-payment visit produce no recovery-related `401` in the browser console.
7. After an empty recovery result, the Amount step can create a new Intent.
8. Existing strict protected endpoints still return their current authentication errors.
9. No identifiers, secrets, PII, Stripe data, or Storage details enter the DOM, URL, logs, or browser storage.

## Validation

Run only:

- focused recovery endpoint/client tests;
- one focused mocked or production-browser recovery check;
- TypeScript;
- ESLint for changed files, or the existing lint command if required;
- one production build;
- `git diff --check`.

Do not run unrelated Storage, upload, webhook, scene, viewport, full Stripe lifecycle, or full acceptance suites unless a focused regression fails and requires investigation.

## Out of scope

Do not add:

- expired Intent cleanup;
- database or Storage deletion;
- scheduled jobs or cron;
- schemas or migrations;
- dependencies or environment variables;
- payment-method, shipping, tax, tracking, email, webhook, Order, Customer, upload, preview, narrative, or unrelated UI changes.

Cleanup will be handled in Unit 2.15.

## Repository rules

- Preserve user-owned changes.
- Do not modify `.env.local`.
- Do not commit or push.
- Stop all task-created servers and browser processes.
- Report starting and ending HEAD, changed files, focused validation results, and final repository status.