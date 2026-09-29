# Phase 2 — Unit 2.17.1: New York Time Policy

## Goal

Establish one explicit business-time policy:

- PostgreSQL continues storing absolute timestamps in UTC.
- Artist/business-facing dates use `America/New_York`.
- The public day/night scene uses New York time regardless of visitor location.

Complete Unit 2.17.1 only.

## Confirmed decisions

- Do not rewrite existing database timestamps.
- Do not change the PostgreSQL or Supabase session timezone.
- Do not attempt to change how Supabase Table Editor displays timestamps.
- Use the IANA zone `America/New_York`, never hard-coded EST, EDT, UTC-5, or UTC-4.
- Preserve the scene’s existing day/night hour thresholds.
- Preserve `?theme=day` and `?theme=night` overrides.
- Database and provider timestamps remain authoritative UTC instants.

## In scope

### Shared time policy

Create a small deterministic server-safe utility for:

- Converting an instant into New York calendar/time parts.
- Determining day/night using the existing scene thresholds.
- Formatting artist/business-facing timestamps in New York time when the current application displays such timestamps.
- Dependency-injected or explicit `Date` input for testing.

Use platform `Intl` APIs unless the installed runtime demonstrably requires something else. Do not add a date library.

### Public scene

Update automatic scene theme resolution so:

- Visitor device timezone has no effect.
- The same instant produces the same theme in Los Angeles, New York, Taiwan, or UTC environments.
- Valid query overrides take precedence.
- Invalid override values fall back to automatic New York-time resolution.
- Existing reduced-motion, responsive, and manual override behavior remains unchanged.
- A page left open across an existing day/night boundary can update without reload if the current implementation already supports automatic re-evaluation; otherwise add the smallest bounded timer necessary.

Avoid hydration mismatch, timer leaks, or repeated intervals.

### Existing business-facing output

Inspect current email/result-page formatting:

- If an existing timestamp is shown to the artist or customer, format it explicitly and label it clearly using New York business time.
- If no timestamp is currently displayed, do not add new UI or email content solely for this Unit.
- Do not change Stripe, Resend, Cron, Order, or cleanup timestamps.

### Documentation

Document briefly:

- Database timestamps are UTC.
- Business timezone is `America/New_York`.
- Supabase Table Editor may continue showing UTC.
- Current Vercel Cron expressions remain UTC and are unchanged.

## Acceptance criteria

1. Database schema, stored timestamps, existing rows, and migrations remain unchanged.
2. Automatic day/night resolution uses `America/New_York`.
3. Host/browser timezone does not change the result for the same instant.
4. Existing day/night hour thresholds remain unchanged.
5. `?theme=day` and `?theme=night` still override automatic behavior.
6. Invalid query values do not grant a new theme mode.
7. At least one winter EST instant and one summer EDT instant resolve correctly.
8. DST behavior is derived from the IANA timezone rather than a fixed offset.
9. Timer/listener cleanup prevents updates after unmount.
10. Reduced-motion and existing scene behavior remain intact.
11. No new dependency, environment variable, schema, migration, database mutation, or provider call is introduced.

## Required verification

Keep verification focused:

1. Red-first deterministic timezone/theme tests.
2. Focused theme and query-override tests.
3. One browser check with a mocked instant proving New York-based automatic selection.
4. One browser query-override check.
5. TypeScript.
6. ESLint on changed handwritten files.
7. One production build.
8. `git diff --check`.

Do not run Stripe, Storage, Resend, database lifecycle, checkout lifecycle, upload, email, full viewport, or broad acceptance suites.

## Out of scope

- Changing Supabase Table Editor timezone
- Database timestamp conversion or backfill
- Payload Admin customization
- Custom timezone selector
- Geolocation
- Sunrise/sunset APIs
- Weather-based themes
- Cron schedule changes
- Refund handling
- Abuse protection
- Upload hardening
- Public visual redesign
- New animations

## Repository rules

- Inspect starting HEAD and working tree once.
- Treat the updated `AGENTS.md` and active `mission.md` as intentional.
- Preserve all user-owned changes.
- Do not modify `.env.local`.
- Do not commit or push.
- Stop task-created processes.
- Report the exact theme threshold found in existing code and confirm it was preserved.