# Phase 2 — Unit 2.1: Private Customers Collection

## Goal

Create the minimal Customers collection needed for future guest checkout and Stripe integration.

Customers do not have accounts and cannot authenticate. The collection must be private, accessible only through authenticated Payload administration or future trusted server-side operations.

## Current Baseline

- Phase 1 is complete and committed.
- Payload 3.88.0 Admin and REST routes are operational.
- GraphQL is disabled.
- Development schema push is disabled.
- All eight existing Payload tables have RLS enabled with no permissive policies.
- One Payload administrator exists.
- The public postcard experience is working.
- The current `mission.md` modification is intentional and authorized.

Record the starting HEAD and Git status. Stop if the Phase 1 changes were not committed or if unrelated uncommitted changes exist other than `mission.md`.

## Collection Contract

Add a `customers` collection with only these business fields:

1. `fullName`
   - Text
   - Required
   - Trim surrounding whitespace
   - Maximum 150 characters

2. `email`
   - Email
   - Required
   - Unique
   - Normalize by trimming whitespace and converting to lowercase before validation or persistence

3. `stripeCustomerId`
   - Text
   - Optional
   - Unique when present
   - Intended for a future Stripe Customer identifier
   - Do not integrate Stripe or create Stripe records in this Unit

Use `email` as the Admin title and show `fullName`, `email`, and `updatedAt` as the useful default columns.

Do not add phone numbers, billing addresses, shipping addresses, passwords, authentication, roles, marketing fields, order relationships, analytics fields, or sample customer data.

Customers must not use Payload authentication. Guest checkout does not mean customer accounts.

## Access Control

Collection create, read, update, and delete access must require an authenticated Payload user.

Anonymous REST callers must not be able to:

- List customers
- Read an individual customer
- Create a customer
- Update a customer
- Delete a customer

Do not expose customer data through a custom public route. Future webhook operations will use explicitly trusted server-side Payload access in a later Unit.

Register the collection in the existing Payload configuration without changing the Users security model.

## Migration and RLS

Generate one reviewed Payload migration for this collection.

Before applying it, confirm that it contains only changes directly required for:

- The new Customers table
- Payload metadata or lock relationships required by the collection
- Indexes and constraints required by the declared fields
- Enabling RLS on the new Customers table
- Migration bookkeeping

The Customers table must have RLS enabled in the same migration, without FORCE RLS and without any permissive policies.

All eight existing Payload tables must remain protected by RLS.

Stop before applying if the migration deletes or rewrites data, disables RLS, modifies unrelated tables, changes Supabase-managed schemas, or contains unexplained schema operations.

If the migration passes inspection, apply it normally. Do not execute a down migration.

## Verification

Verify all of the following:

- The Customers collection is registered and included in generated Payload types.
- The Customers table exists and contains zero rows.
- RLS is enabled on Customers.
- No Customer RLS policy exists.
- Supabase `anon` and `authenticated` roles cannot read or write Customer records.
- Security probes use synthetic non-personal values and are fully rolled back.
- Anonymous `GET /api/customers` is denied.
- Anonymous `POST /api/customers` is denied and creates no row.
- Direct access-control evaluation denies anonymous callers and permits an authenticated Payload user context.
- The existing administrator remains unchanged.
- `/admin` remains operational.
- Anonymous `/api/users` remains denied.
- GraphQL and GraphQL Playground remain unavailable.
- `/` and the existing postcard scene remain unchanged.

Run the existing dependency, migration-status, import-map, type-generation, lint, TypeScript, production-build, route, and scene validations.

Generated Payload types and migration files are expected to change. Dependencies, environment files, secrets, certificates, frontend features, styles, and assets must not change.

Stop all temporary servers and browser processes after validation.

## Excluded Work

Do not implement:

- Customer registration or login
- Orders
- Checkout intents
- Addresses or phone collection
- Uploads or Media
- Stripe SDK, Checkout, webhooks, payments, or refunds
- Email notifications
- Public forms or frontend changes
- Analytics or marketing attribution
- Phase 2 Unit 2.2

Do not modify `AGENTS.md` unless a blocking conflict is discovered and reported first.

## Completion Report

Report:

- Outcome: COMPLETE or BLOCKED
- Starting and ending HEAD
- Collection fields and access behavior
- Migration created and applied
- Tables and metadata changed
- Customers RLS and API-role denial evidence
- Customer row count
- Regression results
- Files changed
- Final Git status
- Confirmation that no customer account, real PII, Stripe integration, or Unit 2.2 work was introduced