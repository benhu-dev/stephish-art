# Phase 2 — Unit 2.18: Anonymous Storefront Abuse Protection

## Goal

Add distributed, privacy-preserving rate limiting to the anonymous storefront checkout APIs.

The protection must prevent one client or Checkout Intent from repeatedly consuming PostgreSQL, private Storage, Stripe, or server resources while preserving the existing normal checkout, upload, preview, polling, recovery, cancellation, and retry flows.

Complete Unit 2.18 only.

## Confirmed architecture

- Use PostgreSQL for shared rate-limit state across Vercel instances.
- Do not use process-memory counters as the production authority.
- Do not add Redis, Upstash, CAPTCHA, Turnstile, Vercel Firewall SDK, or another external provider.
- Use the existing high-entropy `PAYLOAD_SECRET` with domain-separated HMAC to derive irreversible subject hashes.
- Never store raw IP addresses, cookies, access tokens, user agents, email addresses, URLs, or request bodies in rate-limit records.
- Rate limiting is defense-in-depth and never replaces cookie authentication, same-origin enforcement, validation, or Stripe idempotency.
- No public Payload Collection, REST endpoint, or GraphQL surface should be created for rate-limit records.

## In scope

### 1. Internal rate-limit persistence

Add one internal PostgreSQL table through a reviewed forward migration.

Store only the minimum required data:

- Action/scope
- HMAC subject hash
- Fixed-window start
- Request count
- Expiration time

Requirements:

- Atomic insert/increment under concurrency
- Unique key preventing duplicate buckets
- Database-authoritative time where practical
- Bounded integer counters
- RLS enabled in the same migration
- No `anon` or `authenticated` policies
- No Payload collection or Admin UI
- Expired rows removable through a bounded cleanup operation

Do not modify existing application records or migrations.

### 2. Privacy-preserving subjects

Create deterministic domain-separated HMAC subjects.

For Intent creation:

- Use the trusted network identity available from the supported Vercel request boundary.
- Do not trust arbitrary client-supplied forwarding headers in production.
- Do not expose the resolved address or hash.

For requests carrying the Checkout Intent cookie:

- Enforce both a network-level bucket and an Intent-credential bucket.
- Hash the credential material before persistence.
- Never store or log the raw cookie or token.
- A caller must not evade the network limit by inventing cookies.
- A shared network must not allow one Intent to consume every other Intent’s credential allowance.

Local development may use a deterministic loopback subject. Production must fail safely if the trusted client identity cannot be resolved rather than accepting a spoofable identity source.

Use installed platform/runtime facilities where available. Do not add a dependency solely to read an IP address without first establishing that it is necessary.

### 3. Initial limits

Centralize the policy in one typed server-only module.

Use these initial fixed-window limits:

- Intent create/resume: 10 requests per 15 minutes per network
- Amount save: 30 requests per 15 minutes per network and Intent
- Photo upload: 12 requests per 15 minutes per network and Intent
- Photo removal: 20 requests per 15 minutes per network and Intent
- Protected photo preview: 90 requests per 15 minutes per network and Intent
- Artist-note save: 30 requests per 15 minutes per network and Intent
- Checkout Session create/resume: 10 requests per 15 minutes per network and Intent
- Abandon/start-over: 10 requests per 15 minutes per network and Intent
- Current/recovery reads: 60 requests per 15 minutes per network
- Checkout status polling: 90 requests per 5 minutes per network and Intent

Count attempts before expensive application work, including malformed, unauthorized, or business-rejected requests where the trusted network identity is available.

Do not rate-limit:

- Stripe webhooks
- Internal Cron routes
- CLI commands
- Payload Admin
- Static pages/assets
- Health checks

### 4. Endpoint behavior

When allowed:

- Preserve the exact existing endpoint contracts and behavior.

When denied:

- Return HTTP 429.
- Include an integer `Retry-After` header.
- Use `Cache-Control: no-store`.
- Return one generic safe JSON error.
- Do not reveal thresholds, counters, bucket keys, identities, Intent existence, internal IDs, or whether the network or credential bucket triggered.
- Perform no downstream Stripe, Storage, upload, email, or business mutation.

If the limiter itself cannot safely determine or persist a decision:

- Return a generic HTTP 503.
- Perform no protected business mutation.
- Log only a safe bounded classification without identity or PII.

Rate-limit checks must not create a database transaction that remains open during Stripe, Storage, or Resend calls.

### 5. Client behavior

Add only the minimum functional handling required:

- Amount, photo, note, Checkout Session, cancellation, recovery, preview, and status clients must treat 429 safely.
- Show a short generic retry-later message where user action is required.
- Prevent automatic polling from hammering after a 429.
- Respect a valid bounded `Retry-After` value where appropriate.
- Do not show counters, internal rules, IP information, or security terminology.
- Preserve all existing visual styling and layout.
- Do not redesign the modal or result pages.

### 6. Cleanup

Extend the existing cleanup infrastructure to delete expired rate-limit buckets safely and in bounded batches.

Requirements:

- Dry-run performs no deletion.
- Cleanup output contains only an aggregate rate-limit-row count.
- Existing Intent/upload/Storage cleanup behavior remains unchanged.
- No raw rate-limit keys or subjects enter logs or responses.
- Concurrent cleanup runs converge safely.

### 7. Migration and access

- Generate and review exactly one migration if required.
- Enable RLS for the new internal table.
- Apply it to the configured development database.
- Verify there are no public policies or public application endpoints.
- Regenerate supported generated artifacts only when required.
- Do not modify existing applied migrations.

## Acceptance criteria

1. Counters are shared through PostgreSQL and not process memory.
2. Concurrent requests cannot exceed the configured bucket through lost updates.
3. Raw IP addresses, cookies, tokens, PII, URLs, and user agents are never persisted or logged.
4. Identical subjects and actions produce stable hashes; different actions are domain-separated.
5. Production does not trust arbitrary spoofable client IP headers.
6. Every listed storefront action enforces its configured network/Intent policy.
7. Normal status polling and three-photo checkout remain below the limits.
8. The first request over a limit returns generic 429 with safe `Retry-After` and `no-store`.
9. A denied upload performs no Storage write or upload-row mutation.
10. A denied Checkout Session request performs no Stripe call.
11. Invalid/unauthorized request floods still consume the network allowance.
12. Limiter failure returns generic 503 without downstream mutation.
13. Client polling stops or backs off safely after 429.
14. Expired buckets are cleaned in bounded batches; dry-run is mutation-free.
15. The internal table has RLS enabled and no public policies.
16. Existing authentication, origin, cookie, validation, idempotency, payment, cleanup, and UI contracts remain unchanged.
17. No new external service, dependency, environment variable, CAPTCHA, or public Admin surface is introduced.

## Required verification

Keep verification focused:

1. Red-first rate-limit service and endpoint tests.
2. Deterministic HMAC/privacy tests.
3. Concurrent PostgreSQL increment test.
4. Focused endpoint tests for 429, Retry-After, no-store, and zero downstream side effects.
5. Focused client/polling tests for 429 behavior.
6. Isolated cleanup lifecycle with starting/final application-data counts.
7. Migration generation/review/application/status.
8. RLS and no-public-policy inspection.
9. TypeScript.
10. ESLint on changed handwritten files.
11. One production build.
12. `git diff --check`.

Do not run real Stripe, Resend, Storage upload, payment, email, scene, viewport, or full browser suites.

Mock or spy on provider boundaries to prove that denied requests make zero provider calls.

## Out of scope

- CAPTCHA or Turnstile
- Vercel WAF configuration
- Redis or Upstash
- Upload content decoding or EXIF removal
- Refund/dispute handling
- Fulfillment/tracking
- Admin Dashboard
- Public UI redesign
- Authentication changes
- Customer accounts
- Production deployment
- Dynamic limit management UI

## Repository rules

- Read the updated `AGENTS.md` and this mission.
- Record starting HEAD and working tree once.
- The committed Unit 2.17.1 work is the baseline.
- Preserve user-owned changes.
- Do not modify `.env.local`.
- Do not print or expose `PAYLOAD_SECRET`.
- Do not commit or push.
- Stop task-created servers and browsers.
- Report exact changed files, migration status, focused validation, cleanup restoration, and remaining limitations.