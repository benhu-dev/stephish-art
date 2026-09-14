# Phase 2 — Unit 2.3: Private Checkout Settings Global

## Goal

Create one private Payload Global named Checkout Settings as the authoritative source for the storefront's configurable minimum payment amount.

The default must be 500 cents ($5.00). Administrators must be able to change it later through Payload Admin without changing code or redeploying.

This Unit creates the setting only. It does not implement a public settings endpoint or enforce the amount in Checkout yet.

## Current Baseline

- Phase 2 Unit 2.2 is committed.
- Private Customers and Orders collections exist.
- Orders can only be created through future trusted server-side access.
- `Orders.amountCents` accepts positive integer cents with a schema minimum of 1 and does not contain the storefront's $5 business rule.
- Payload Admin and REST are operational.
- GraphQL and development schema push are disabled.
- All existing Payload-owned tables have non-forced RLS with no permissive policies.
- The current `mission.md` modification is intentional and authorized.

Record the starting HEAD and Git status. Stop if Unit 2.2 was not committed or unrelated uncommitted changes exist other than `mission.md`.

## Global Contract

Add a Payload Global with:

- Slug: `checkout-settings`
- Label: `Checkout Settings`
- Admin group: `Settings`, if supported without custom components

Add exactly one field:

- Name: `minimumAmountCents`
- Label: `Minimum Payment Amount (cents)`
- Type: number
- Required: true
- Default: 500
- Minimum: 1
- Validation:
  - Must be a finite integer
  - Must be at least 1
- Admin description:
  - `Enter an integer number of cents. 500 = $5.00.`

Do not add currency, maximum amount, taxes, shipping fees, product prices, feature flags, Stripe IDs, secrets, or other checkout settings in this Unit.

Register the Global in the existing Payload configuration.

## Access

Global read and update access must require an authenticated Payload user.

Anonymous callers must not be able to read or update the setting through Payload REST.

Future trusted server-side code will read this Global through Payload Local API using explicit trusted access. Do not implement that checkout code now.

Do not expose this Global directly to the public frontend. A future controlled endpoint may return only safe storefront settings.

## Historical Order Safety

Do not change the Orders schema or apply the configurable minimum to stored Orders.

Confirm that:

- `Orders.amountCents` still has a schema minimum of 1.
- Existing historical Orders would remain valid if the Admin changes the storefront minimum.
- The Checkout Settings value is not copied into or retroactively applied to existing Orders in this Unit.

## Migration and RLS

Generate one reviewed Payload migration.

It may contain only:

- Structures required by Checkout Settings
- Expected Payload metadata or lock relationships
- Required indexes or constraints
- RLS enablement for every newly created public-schema table
- Migration bookkeeping

Every new table must receive non-forced RLS in the same migration and must have no permissive policies.

Inspect the migration before applying it. Stop if it rewrites data, changes Customers or Orders, disables existing RLS, modifies unrelated or Supabase-managed schemas, or contains unexplained operations.

Apply the migration only after inspection passes. Do not execute the down migration.

## Verification

Add focused red-first acceptance coverage and verify:

- The exact Global and one-field contract.
- Default value is 500.
- Values 1 and 500 pass validation.
- Zero, negative, fractional, non-finite, string, null, and missing values are rejected as applicable.
- Anonymous direct read and update access are denied.
- Authenticated Payload context can read and update.
- Anonymous REST read and update attempts are denied.
- Denied requests do not persist a value.
- Trusted Local API can resolve the Global contract without implementing checkout behavior.
- All new database tables have RLS enabled, FORCE disabled, and zero policies.
- Supabase `anon` and `authenticated` roles cannot read or modify the setting.
- Security probes are rolled back and persist no synthetic data.
- Orders and Customers row counts remain zero.
- The existing administrator is unchanged.
- `/admin` and `/` remain operational.
- Anonymous Users, Customers, and Orders APIs remain denied.
- GraphQL and GraphQL Playground remain unavailable.
- The postcard scene remains unchanged.

Run the existing dependency, migration-status, import-map, Payload type-generation, lint, TypeScript, production-build, route, and scene validations. Stop all temporary processes afterward.

Expected changes are limited to the Checkout Settings Global, Payload config and generated types, one migration, and focused acceptance tests.

Do not change dependencies, environment files, certificates, Customers, Orders, Users, frontend code, styles, or assets.

## Excluded Work

Do not implement:

- Checkout API routes
- Public settings routes
- Minimum-amount enforcement for public requests
- Stripe SDK, Checkout Sessions, webhooks, payments, or refunds
- Maximum payment amount
- Currency configuration
- Customers or Orders changes
- Media or uploads
- Email
- Frontend forms
- Analytics
- Persistent settings or test data created outside normal future Admin use
- Unit 2.4

Do not modify `AGENTS.md` unless a blocking conflict is reported first.

## Completion Report

Report:

- Outcome: COMPLETE or BLOCKED
- Starting and ending HEAD
- Final Global field and access contract
- Migration and database objects changed
- RLS and API-role denial evidence
- Whether any Global row was persisted
- Orders and Customers row counts
- Validation results
- Files changed and final Git status
- Confirmation that no Checkout API, Stripe integration, frontend work, persistent test data, or Unit 2.4 work was introduced