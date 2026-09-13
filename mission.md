# Mission

## Phase and Unit

Phase 1 — Payload Foundation
Unit 1.3 — Payload Admin and REST Route Integration

## Goal

Integrate the existing Payload 3.88.0 configuration into the existing Next.js application by adding the minimum official Admin Panel and REST API route foundation.

Preserve the existing public `/` route, 2.5D postcard experience, styling, metadata, responsive behavior, and animations.

This Unit must not create an administrator account, expose GraphQL routes, add business collections, change the database schema, deploy the application, or begin storefront development.

## Accepted Baseline

The accepted baseline includes:

* Next.js 16.3.4
* React and React DOM 19.2.8
* TypeScript 5.9.3
* Payload packages aligned at 3.88.0
* PostgreSQL through the Supabase Session pooler
* Verified TLS using `certs/prod-ca-2021.crt`
* An applied initial Payload migration
* An empty `users` table
* No administrator account
* No Payload Admin, REST, GraphQL, or playground route
* Existing frontend validation passing
* `package.json` configured as an ES module package

The user has already completed and committed Unit 1.2.

A modified `mission.md` is expected and is not a blocker.

## API Decision

This project will use Payload’s REST and Local APIs.

GraphQL is not required for the current application architecture and must remain disabled.

The presence of the transitive `graphql` package in the dependency tree does not authorize or enable GraphQL usage.

Configure Payload with `graphQL.disable` set to `true`.

Do not create GraphQL or GraphQL Playground route handlers.

## Security Decision

Payload account-unlock behavior must be treated as unsafe until a confirmed patched version is available.

The `Users` collection must explicitly configure its `unlock` access function to unconditionally return `false`.

Do not use `Boolean(req.user)` for `unlock`.

The unlock prohibition must apply even when `req.user` contains an authenticated administrator.

Do not implement a custom unlock endpoint or workaround.

Account recovery and administrator-managed unlock functionality remain deferred to a later security Unit.

## Pre-implementation Gate

Before changing files:

1. Read `AGENTS.md` and `mission.md` completely.
2. Inspect `git status --short`.
3. Confirm that Unit 1.2 is committed.
4. Inspect:

   * `package.json`
   * `next.config.ts`
   * `tsconfig.json`
   * `src/app`
   * `src/payload.config.ts`
   * `src/collections/Users.ts`
   * `src/payload-types.ts`
   * `src/migrations`
5. Inspect the installed Payload 3.88.0 Next.js integration exports, type declarations, and official route template.
6. Determine the minimum route and layout structure required by this exact installed Payload version.
7. Verify that no dependency upgrade is required.
8. Verify that the existing migration remains applied and that no new migration is pending.

Do not rely on a template from a different Payload version.

If a framework or dependency change is required, stop and ask before proceeding.

## In Scope

* Add the official Payload Admin catch-all route.
* Add the official Payload REST catch-all route.
* Add the Payload route-group layout required by Payload 3.88.0.
* Generate the Payload Admin import map using the installed Payload CLI.
* Wrap the existing Next.js configuration with the supported Payload integration.
* Add the required `@payload-config` TypeScript path alias if necessary.
* Explicitly disable GraphQL in the Payload configuration.
* Explicitly disable account unlock for every caller.
* Explicitly configure or verify reasonable login-attempt and lock-duration settings.
* Preserve the existing frontend under `/`.
* Use temporary local servers only for validation and stop them afterward.
* Run database, type, lint, build, route, security, and scene validation.

## Route Requirements

The completed application must expose:

* `/` — existing postcard frontend
* `/admin` and its required catch-all segments — Payload Admin
* `/api/[...slug]` — Payload REST API

Do not create:

* `/graphql`
* `/api/graphql`
* `/graphql-playground`
* `/api/graphql-playground`
* Any custom GraphQL route
* Any custom account-unlock route
* Any business API route

Set `graphQL.disable` to `true` in the Payload configuration.

Verify that no GraphQL route appears in the Next.js build output or responds successfully during route validation.

## Next.js Layout Integration

Use the route and layout structure officially supported by the installed Payload 3.88.0 package.

If separate root layouts are required, it is authorized to move only the existing application entry files into a frontend route group, for example:

* `src/app/layout.tsx` to `src/app/(frontend)/layout.tsx`
* `src/app/page.tsx` to `src/app/(frontend)/page.tsx`

Keep `/` as the public URL. Route-group names must not appear in the URL.

Move files only when necessary for the official integration.

When moving existing frontend entry files:

* Preserve their behavior and rendered output.
* Preserve existing metadata.
* Preserve global CSS loading.
* Preserve all 2.5D components and animation behavior.
* Make only path or import adjustments required by the move.
* Do not refactor or restyle the frontend.
* Do not modify files under `src/features/postcard-machine`.

If the installed integration can be completed safely without moving the frontend root layout, prefer the smaller change.

## Admin Requirements

Use the Admin components and CSS exported by the installed Payload 3.88.0 packages.

The import map must be generated by the installed Payload CLI, not written from memory.

The Admin Panel must load sufficiently to display the first-user bootstrap interface.

Do not:

* Enter an administrator email or password.
* Create the first administrator.
* Create test users.
* Seed credentials.
* Add default credentials to source files.
* Store credentials in environment files.
* Display or log environment values.

First-user creation is reserved for manual user acceptance after this Unit’s automated work.

## Users Collection Requirements

Retain `auth: true` and the existing deny-by-default access posture.

Ensure:

* Anonymous collection reads are denied.
* Anonymous normal creates are denied except Payload’s internal first-user bootstrap flow, if required.
* Anonymous updates and deletes are denied.
* Authenticated access does not automatically grant account unlock.
* The `unlock` access function always returns `false`.

Do not add roles or customer authentication in this Unit.

## Database Rules

* Use the existing `DATABASE_URL`.
* Use the existing verified CA certificate configuration.
* Do not display or copy the database URL.
* Do not edit `.env.local`.
* Do not change SSL verification.
* Do not use schema push.
* Do not generate or apply a migration unless an unexpected schema change is detected and approved.
* Do not create, update, or delete database rows.
* Do not create an administrator.
* Do not modify existing migration files.
* Confirm the initial migration remains applied.
* Confirm the `users` table remains empty after automated validation.

If route integration unexpectedly requires a schema change, stop and ask.

## Dependency Rules

Keep these packages at 3.88.0 during this Unit:

* `payload`
* `@payloadcms/next`
* `@payloadcms/db-postgres`

Do not upgrade to Payload 3.89.0 merely because it is newer. There is not yet sufficient evidence in this mission that it fixes the account-unlock issue.

Do not:

* Install new dependencies.
* Run `npm audit fix`.
* Use `--force`.
* Use `--legacy-peer-deps`.
* Approve pending lifecycle scripts.
* Upgrade Next.js, React, TypeScript, Payload, or other packages.
* Remove `graphql` from the lockfile.
* Add `graphql` as a direct dependency.

If an additional direct dependency is mandatory for the installed official integration, stop and report the exact package and reason.

## Files Allowed to Change

Expected changes may include only:

* `next.config.ts`
* `tsconfig.json`
* `src/payload.config.ts`
* `src/collections/Users.ts`
* Official Payload route-group files under `src/app/(payload)`
* Generated Payload import-map files
* Existing `src/app/layout.tsx` and `src/app/page.tsx` only if moved into `src/app/(frontend)`
* A frontend route-group layout or page created solely by moving the existing entry files
* `package.json` only if a minimum non-dependency script adjustment is required
* `mission.md` as the pre-existing user change

Do not change:

* `package-lock.json`
* `.env.local`
* `.gitignore`
* `certs/prod-ca-2021.crt`
* Existing migration files
* `src/payload-types.ts`, unless generation proves the checked-in file is stale without a schema change
* Files under `src/features/postcard-machine`
* Existing visual assets, CSS, SVG, animation, or business content

Do not create a new migration in this Unit.

## Required Security Probes

Verify account-unlock protection at two levels:

1. Directly exercise the configured `unlock` access function without an authenticated user. The result must be `false`.
2. Directly exercise the same function with a synthetic authenticated user. The result must also be `false`.

If the REST unlock endpoint is reachable without creating a user, confirm that an unauthenticated request is rejected.

Do not weaken or temporarily remove the protection for testing.

Also confirm:

* Payload configuration sets `graphQL.disable` to `true`.
* No GraphQL route appears in the build route manifest.
* A request to `/api/graphql` does not expose a GraphQL endpoint.
* The REST Users collection cannot be listed anonymously.
* No secret appears in build output, logs, Git diff, or generated client files.
* The CA certificate contents are not copied into application bundles.
* The Admin bootstrap route is not deployed anywhere.

## Required Route Validation

Run the production build, start it temporarily on localhost, and verify:

* `GET /` returns the existing frontend successfully.
* `GET /admin` returns or redirects to the Payload Admin first-user flow.
* Admin static assets load without server errors.
* `GET /api/users` is rejected for an unauthenticated caller.
* `/api/graphql` does not expose GraphQL.
* No GraphQL Playground route exists.
* No unexpected browser console error occurs on `/`.
* No unexpected server error occurs while loading `/admin`.

HTTP status may differ where Payload intentionally redirects, but the final destination must be the expected Admin bootstrap interface.

Do not submit the first-user form.

Stop the local server after validation.

## Required Verification

Inspect the scripts before executing them, then run the applicable equivalent of:

* `git status --short`
* `node --version`
* `npm.cmd --version`
* `npm.cmd ls --depth=0`
* `npm.cmd run payload -- migrate:status`
* `npm.cmd run payload -- generate:importmap`
* `npm.cmd run payload -- generate:types`
* `npm.cmd run lint`
* `npx.cmd tsc --noEmit`
* `npm.cmd run build`
* `node scripts/check-scene.mjs`
* `git status --short`
* `git diff --stat`

Use a temporary production server for route tests and stop it afterward.

If `generate:types` produces no semantic change, do not leave formatting-only changes.

Do not use a persistent development server for automated validation.

## Acceptance Criteria

1. Payload Admin is integrated using the installed official Payload 3.88.0 interface.
2. Payload REST API routes are integrated.
3. `/` still serves the existing postcard frontend.
4. `/admin` reaches the first-user bootstrap interface.
5. No administrator or test user is created.
6. The `users` table remains empty.
7. Anonymous Users collection listing is denied.
8. Account unlock returns false for anonymous and authenticated access contexts.
9. Payload configuration explicitly disables GraphQL.
10. No GraphQL or GraphQL Playground route exists.
11. Payload packages remain at 3.88.0.
12. No dependency is installed, upgraded, downgraded, or removed.
13. No database migration is created or applied.
14. The initial migration remains applied.
15. No environment or secret file changes.
16. No frontend feature, design, route URL, animation, or responsive behavior changes.
17. Dependency-tree validation passes.
18. Lint passes, allowing only previously documented generated-migration warnings.
19. TypeScript validation passes.
20. Production build passes.
21. Scene validation passes.
22. Temporary validation servers are stopped.
23. No commit or push is created.
24. Only approved files are changed.
25. Unit 1.4 is not started.

## Stop and Ask If

Stop and ask before proceeding if:

* Unit 1.2 is not committed.
* An unexpected existing modification overlaps this Unit.
* Official integration requires a dependency installation or version change.
* Payload package versions are not aligned.
* Integration requires an undocumented workaround.
* A source file outside the allowed scope must change.
* A new migration or schema change is required.
* The initial migration is not applied.
* The Users table is not empty before or after automated validation.
* The Admin Panel cannot load without creating a user.
* The first-user flow requires Codex to supply credentials.
* GraphQL cannot be disabled as required.
* A GraphQL endpoint remains exposed.
* Account unlock cannot be denied for authenticated users.
* SSL or database validation fails.
* Frontend regression validation fails.
* A secret is exposed.
* A persistent process cannot be stopped.

Do not improvise around a stop condition.

## Completion Report

Provide:

### Outcome

Use:

* `COMPLETE`
* `BLOCKED`
* `FAILED`

### Integration Summary

Report:

* Final route-group structure
* Files created
* Files moved
* Files modified
* Official installed Payload exports or templates used
* Whether the existing frontend root layout needed relocation

### Route Evidence

Report results for:

* `/`
* `/admin`
* Admin assets
* `/api/users`
* `/api/graphql`
* GraphQL Playground absence

Do not report database or credential values.

### Security Evidence

Report:

* Anonymous unlock access result
* Synthetic authenticated unlock access result
* Anonymous Users listing result
* GraphQL configuration state
* GraphQL route absence
* Users table row count
* Confirmation that no account was created
* Confirmation that no secret was exposed

### Database Evidence

Report:

* Migration status
* Whether any migration was created or applied
* Whether any schema object changed
* Whether any row was created, updated, or deleted

### Regression Results

Report the actual outcome of:

* Dependency-tree validation
* Lint
* TypeScript
* Production build
* Scene validation
* Local route probes

### Acceptance Evidence

For all 25 acceptance criteria, report:

* Verification method
* `PASS`, `FAIL`, `BLOCKED`, or `NOT RUN`

### Repository State

Confirm:

* Final changed-file list
* Dependency changes
* Database changes
* Frontend behavior changes
* Environment-file changes
* Commit or push
* Remaining listeners or background processes

Do not begin Unit 1.4.
