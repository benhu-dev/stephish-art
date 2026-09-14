# Phase 1 — Unit 1.4: Secure the Supabase Boundary for Payload Tables

## Goal

Enable PostgreSQL Row Level Security on every existing Payload-owned table in Supabase's public schema so Supabase API roles cannot bypass Payload access control.

Payload Admin, Payload REST, the existing administrator, and the public postcard frontend must continue working normally.

## Current Baseline

- Phase 1 Unit 1.3 is committed.
- Payload 3.88.0 Admin and REST routes are integrated.
- GraphQL is disabled.
- Development schema push is disabled.
- The initial Payload migration is applied.
- One administrator was created manually through `/admin`.
- The public postcard experience is working.
- The current `mission.md` modification is intentional and authorized.

Record the starting HEAD and Git status during preflight. Preserve unrelated user changes.

## Allowed Work

1. Inspect the live database before making changes:

   - Identify every Payload-owned table currently present in the public schema.
   - Confirm they match the existing migration and expected baseline.
   - Inspect RLS state, table ownership, relevant grants, the runtime database role, and whether that role owns the tables or bypasses RLS.
   - Do not print administrator data, password hashes, session tokens, connection strings, certificate contents, or environment values.

2. Add one reviewed Payload migration that:

   - Enables RLS on every existing Payload-owned public table.
   - Does not use FORCE ROW LEVEL SECURITY.
   - Does not create permissive policies.
   - Does not change table data, columns, indexes, constraints, ownership, grants, or Supabase-managed schemas.
   - Does not create or modify business collections.
   - Includes a conventional down migration only if required by the repository's established Payload migration structure. Never execute the down migration in this Unit.

3. Before applying the migration:

   - Inspect the generated SQL or migration implementation.
   - Confirm it contains only the expected RLS changes and migration bookkeeping.
   - Stop before applying if it is destructive, contains unrelated schema changes, or could prevent the Payload runtime role from accessing its tables.

4. Apply the migration only after the inspection passes.

5. If `AGENTS.md` does not already contain an equivalent permanent rule, add one concise database-safety rule:

   Any new table created in Supabase's exposed public schema must have RLS enabled in the same reviewed migration before application data is stored. Do not add anon or authenticated policies without explicit mission authorization.

Do not make any other changes to `AGENTS.md`.

## Security Verification

After applying the migration:

- Confirm RLS is enabled on every existing Payload-owned public table.
- Confirm no permissive RLS policies were introduced.
- Verify that Supabase `anon` and `authenticated` roles cannot read administrator or session records.
- When possible, perform role-based checks inside transactions and roll them back.
- Treat either zero visible rows or a permission-denied result as a successful denial.
- Do not output existing row contents.
- Confirm the Payload server database role can still access the tables.
- Confirm the existing administrator record remains present without displaying its personal fields.
- Do not create, update, or delete any administrator, session, or test record.
- Confirm anonymous `/api/users` access remains denied.
- Confirm GraphQL and GraphQL Playground routes remain unavailable.

Supabase Auth roles and Payload administrator accounts are separate systems. Do not create Supabase Auth users or policies for Payload users.

## Validation

Run the repository's existing validation commands, including:

- Dependency-tree validation
- Payload migration status
- Payload type generation
- ESLint
- TypeScript without emit
- Production build
- Local route probes
- Existing postcard scene validation

Verify:

- `/` still renders the existing postcard experience.
- `/admin` remains available.
- `/api/users` denies anonymous access.
- No GraphQL route appears in the build or at runtime.
- No dependency, environment, secret, certificate, frontend feature, style, or visual asset changed.
- Temporary validation servers and browsers are stopped.

## Stop Conditions

Stop and report before making or applying changes if:

- The live Payload table set does not match the existing migration baseline.
- The Payload runtime role is neither a table owner nor able to bypass non-forced RLS.
- The migration contains destructive or unrelated operations.
- Enabling RLS would prevent Payload Admin or REST from operating.
- The task requires administrator credentials, a Supabase API key not already configured, a new dependency, or a change outside this Unit.
- TLS or database identity verification fails.

Never request or expose the administrator password.

## Completion Report

Report:

- Outcome: COMPLETE or BLOCKED
- Starting and ending HEAD
- Tables inspected and their final RLS status
- Runtime-role compatibility evidence
- Migration created and applied
- Anonymous and authenticated role-denial evidence
- Payload route and regression results
- Files changed
- Database rows changed, if any
- Final Git status
- Confirmation that Phase 2 business collections were not started