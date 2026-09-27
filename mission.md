# Phase 2, Unit 2.15 — Automatic Checkout Cleanup

## Goal

Implement safe cleanup for unpaid Checkout Intents whose retention period has ended, including the reusable cleanup service, a dry-run CLI, a protected Vercel Cron endpoint, and a daily production schedule.

Eligible private Storage objects, Order Upload rows, and Checkout Intents must be deleted without risking paid orders, active Stripe Sessions, or user-owned data.

## Eligibility

An Intent is eligible only when:

- `deleteAfter` is at or before the current time;
- it is not completed;
- it has no Order;
- none of its uploads belong to an Order;
- it is not in a transient reservation or finalization state;
- any Stripe Checkout Session is authoritatively confirmed unpaid and no longer payable.

Use the existing `deleteAfter` field as the only retention source of truth.

## Stripe safety

For a candidate with a persisted Checkout Session:

- Retrieve its latest Stripe Test-mode state outside database transactions.
- Skip paid, complete, uncertain, or potentially fulfillable Sessions.
- Expire an open unpaid Session before deleting anything.
- If Stripe is unavailable or expiration cannot be confirmed, skip the candidate for a later retry.
- Never create a Session, Customer, Order, payment, or refund.

Draft Intents without a Stripe Session require no Stripe call.

## Deletion order

Process no more than 25 candidates per run.

For each candidate:

1. Resolve Stripe state when required.
2. Lock and revalidate the Intent, retention deadline, status, Order absence, and upload ownership.
3. Delete its private Storage objects through the existing server-side abstraction.
4. Treat an already-missing object as successful.
5. If Storage deletion fails, retain the database rows for retry.
6. Lock and revalidate again.
7. Delete the related Order Upload rows.
8. Delete the Checkout Intent last.

The process must be idempotent and safe under duplicate or overlapping Vercel invocations.

Never delete completed Intents, Orders, Customers, Stripe events, Order-owned uploads, or paid-order images.

## Manual CLI

Add:

- `npm run checkout:cleanup`
  - dry run;
  - zero Stripe expiration, Storage deletion, or database mutation.

- `npm run checkout:cleanup -- --execute`
  - runs one real bounded cleanup batch.

The output may contain aggregate counts but must not print PII, notes, cookies, tokens, Stripe URLs, signatures, Storage keys, credentials, filenames, or file contents.

## Vercel Cron endpoint

Add:

`GET /api/internal/cron/checkout-cleanup`

Requirements:

- Require exact `Authorization: Bearer <CRON_SECRET>`.
- Compare credentials safely and fail closed.
- Missing or invalid authorization returns generic `401`.
- Missing server configuration returns a generic safe failure and performs no work.
- Reject query-controlled cleanup options.
- Return `Cache-Control: no-store`.
- A successful invocation runs one bounded execute batch.
- Return only a safe aggregate summary.
- Candidate-level retryable failures may be reported as counts while remaining eligible for the next run.
- An engine-wide failure returns a generic `500` or `503`.
- The route must never be exposed through storefront navigation or UI.

Add `CRON_SECRET` to `.env.example` with a placeholder and document that production must use a random secret of at least 32 characters. Never create, print, or modify the real `.env.local` value.

## Vercel schedule

Create or safely merge `vercel.json` with:

- path: `/api/internal/cron/checkout-cleanup`
- schedule: `0 10 * * *`

This runs once per day at 10:00 UTC on Vercel production deployments.

Preserve any existing Vercel configuration.

## Safe summary

Track aggregate counts such as:

- scanned;
- eligible;
- skipped active;
- skipped protected;
- Stripe Sessions expired;
- Storage objects deleted;
- upload rows deleted;
- Intents deleted;
- retryable failures.

Do not include customer or private file information.

## Focused acceptance coverage

Prove:

1. Dry run performs zero mutations.
2. Missing or invalid Cron authorization performs zero work.
3. Valid Cron authorization runs one bounded batch.
4. Future `deleteAfter` candidates are skipped.
5. Due unpaid drafts are deleted in Storage → uploads → Intent order.
6. Completed Intents, Orders, and Order-owned uploads are protected.
7. Open unpaid Stripe Sessions are expired before cleanup.
8. Paid, complete, uncertain, and Stripe-failure candidates are skipped.
9. Storage failure retains database rows for retry.
10. Missing Storage objects are idempotently accepted.
11. Duplicate or concurrent runs converge safely.
12. Unrelated rows and Storage objects remain unchanged.
13. The response and logs contain no PII, secrets, tokens, Stripe URLs, Storage keys, or file contents.
14. `vercel.json` contains the exact daily production schedule.

Use only uniquely identified synthetic fixtures during validation. Never execute cleanup against pre-existing user-owned candidates.

## Validation

Run only:

- focused cleanup service, CLI, authorization, and schedule tests;
- one isolated database/private-Storage lifecycle with synthetic fixtures;
- focused Stripe Sandbox retrieve/expire coverage if required;
- TypeScript;
- changed-file ESLint or the existing lint command if required;
- one production build;
- `git diff --check`.

Record database and Storage baselines before and after integration validation. Remove only task-created fixtures.

## Documentation

Update the README with:

- how automatic cleanup works;
- the daily UTC schedule;
- how to configure `CRON_SECRET` in Vercel;
- dry-run and manual execute commands;
- how to inspect Vercel Cron logs;
- confirmation that paid-order data and images are excluded.

## Out of scope

Do not add cleanup for paid Orders, Customers, Stripe events, or fulfilled-order images.

Do not change checkout, recovery, payment methods, shipping, tax, tracking, email, webhook fulfillment, upload, preview, narrative, or unrelated UI behavior.

Do not add dependencies or schema changes unless correctness is impossible with the existing model. If a migration is required, stop and explain the missing invariant before creating it.

## Repository rules

- Preserve user-owned data and existing changes.
- Do not modify or print `.env.local`.
- Do not execute cleanup against existing data.
- Do not deploy to Vercel.
- Do not commit or push.
- Stop all task-created processes.
- Report starting and ending HEAD, changed files, validation evidence, synthetic cleanup evidence, and final repository status.