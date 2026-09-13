# Mission

## Phase and Unit

Phase 1 — Payload Foundation  
Unit 1.2 — Payload Configuration and Supabase Schema Foundation

## Goal

Create the minimum Payload configuration, establish the authenticated Users collection required by the future Admin Panel, connect Payload to the user-provided Supabase PostgreSQL database, and create the initial controlled database migration.

This Unit must not expose Payload routes, an Admin Panel, REST, GraphQL, file uploads, orders, payments, or customer functionality.

The existing Next.js frontend and 2.5D scene must remain functionally and visually unchanged.

## Accepted Baseline

- Phase 1 / Unit 1.1 is complete.
- Payload packages are aligned at version 3.88.0.
- `payload`, `@payloadcms/next`, and `@payloadcms/db-postgres` are installed.
- `graphql` exists only as a resolved peer/transitive dependency.
- The existing frontend passed lint, production build, and scene validation.
- A new Supabase project has been created for this application.
- The project uses a Session pooler connection on port 5432.
- `.env.local` contains `DATABASE_URL` and `PAYLOAD_SECRET`.
- `.env.local` is user-owned, ignored by Git, and must not be modified or displayed.

## Preflight Security Gate

Before modifying source files:

1. Read `AGENTS.md` and this mission completely.
2. Inspect Git status and confirm the Unit 1.1 baseline is committed.
3. Confirm `.env.local` is ignored by Git.
4. Confirm `DATABASE_URL` and `PAYLOAD_SECRET` are present without printing, echoing, logging, or partially revealing either value.
5. Confirm the installed Payload CLI can securely load `.env.local`.
6. Confirm the database URL:
   - Uses PostgreSQL.
   - Uses a Supabase pooler host.
   - Uses Session pooler port 5432.
   - Requests SSL.
7. Test the database connection without printing credentials.
8. Inspect the existing user-created tables in the Supabase `public` schema.

If the Payload CLI cannot load `.env.local`, stop and ask. Do not copy secrets into another file, install dotenv, or expose them through a command line.

If unexpected user-created tables already exist in the `public` schema, stop and report them before generating or applying a migration.

Supabase-managed schemas such as `auth`, `storage`, `realtime`, and system schemas are not unexpected and must not be modified.

## In Scope

- Create the minimum typed Payload configuration.
- Configure `@payloadcms/db-postgres` using `process.env.DATABASE_URL`.
- Configure Payload using `process.env.PAYLOAD_SECRET`.
- Fail clearly when either required environment variable is absent.
- Disable automatic development schema push with `push: false`.
- Create a minimal authenticated `users` collection required by the future Admin Panel.
- Configure `admin.user` to use the Users collection.
- Do not add unnecessary custom fields.
- Do not grant anonymous access to user records.
- Generate Payload TypeScript types.
- Add only the minimum Payload CLI scripts to `package.json` if required.
- Generate an initial named Postgres migration.
- Inspect the generated migration before applying it.
- Apply the migration only if it contains expected create operations for the new Payload schema and no destructive or unrelated operations.
- Verify migration status after application.
- Verify the expected Payload tables exist in the Supabase `public` schema.
- Run dependency, lint, production build, and existing scene validation.

## Database Rules

The Supabase project is new, but treat all database changes carefully.

Allowed:

- Read-only connection and schema inspection.
- Creating the initial Payload-owned tables, indexes, enums, relations, and migration metadata.
- Applying the reviewed initial migration once.

Not allowed:

- Dropping any schema, table, column, index, function, role, policy, or extension.
- Truncating or deleting data.
- Modifying Supabase-managed schemas.
- Running `migrate:fresh`, `migrate:reset`, `migrate:refresh`, or rollback commands.
- Enabling Supabase Data API.
- Enabling automatic table exposure.
- Enabling RLS automatically.
- Creating an administrator account.
- Using development push mode to mutate the schema.
- Running unreviewed SQL.
- Replacing the database or resetting its password.

Before applying the migration, confirm that it contains no `DROP`, destructive `ALTER`, data deletion, schema deletion, or changes outside the intended Payload tables.

## Users Collection

Create a minimal typed authentication collection for future Payload administrators.

Requirements:

- Slug: `users`
- Authentication enabled.
- Use email as the Admin display title where appropriate.
- Do not add customer-facing roles or business fields.
- Do not add seeded credentials.
- Do not create a first administrator.
- Do not expose anonymous read, update, delete, unlock, or administrative access.
- Follow the installed Payload version’s official types and supported access-control APIs.

The known account-unlock advisory affecting Payload 3.88.0 remains a security gate for the future route-exposure Unit. Because this Unit creates no Payload route, do not implement an improvised workaround here. Record the risk in the completion report.

## Expected Files

Files that may be created or changed:

- `src/payload.config.ts`
- `src/collections/Users.ts`
- `src/payload-types.ts`
- `src/migrations/*`
- `package.json`, only if minimum Payload CLI scripts are required
- `package-lock.json`, only if npm legitimately updates script-related metadata without adding dependencies

The user-approved `mission.md` change is expected but must not be modified by the agent.

Do not modify:

- `.env.local`
- `.gitignore`
- `AGENTS.md`
- Existing frontend components
- `src/app`
- `src/features/postcard-machine`
- Existing CSS or SVG files
- `next.config.ts`
- `tsconfig.json`
- Public routes
- Scene validation scripts
- README files

## Dependency Rules

Do not install, remove, or upgrade dependencies.

In particular, do not add:

- Rich-text packages
- Sharp
- Storage adapters
- Supabase JavaScript clients
- Stripe packages
- Email SDKs
- Cross-env
- Dotenv
- Test frameworks
- Validation libraries

If an additional dependency is required, stop and ask before installing it.

## Out of Scope

Do not:

- Create a Payload route group.
- Create `/admin`.
- Create REST or GraphQL routes.
- Modify `next.config.ts` with `withPayload`.
- Move the existing frontend into a route group.
- Create customers, orders, products, payments, media, or settings collections.
- Create Storage buckets.
- Configure file uploads.
- Configure Stripe or email.
- Deploy the application.
- Expose the database connection to browser code.
- Start Unit 1.3.
- Commit or push.

## Required Verification

Run the applicable Windows/npm equivalents of:

1. `git status --short`
2. `git check-ignore -v .env.local`
3. Required-environment presence check without outputting values
4. Read-only database connection and public-schema inspection
5. Payload type generation
6. Initial migration generation
7. Migration source inspection
8. Initial migration application
9. Migration status verification
10. `npm.cmd ls --depth=0`
11. `npm.cmd run lint`
12. `npm.cmd run build`
13. `node scripts/check-scene.mjs`
14. `git status --short`
15. `git diff --stat`

Do not start a persistent development server.

## Acceptance Criteria

1. `.env.local` remains ignored and unchanged.
2. No secret or connection-string content appears in output or tracked files.
3. Payload successfully connects to Supabase over SSL.
4. Payload config is strongly typed and uses required environment variables.
5. Development schema push is disabled.
6. A minimal authenticated Users collection exists.
7. No anonymous user-record access is intentionally granted.
8. Payload types generate successfully.
9. The initial migration is generated and inspected.
10. The migration contains only expected non-destructive Payload schema creation.
11. The initial migration applies successfully.
12. Migration status reports the migration as applied.
13. No Supabase-managed schema is modified.
14. No administrator account or business data is created.
15. No `/admin`, REST, or GraphQL route exists.
16. No dependency is added, removed, or upgraded.
17. Dependency-tree validation passes.
18. Lint passes.
19. Production build passes.
20. Existing scene validation passes.
21. Existing public frontend routes and visuals remain unchanged.
22. Only approved files change.
23. No commit or push is created.
24. No background process remains.

## Stop and Ask If

Stop before proceeding if:

- Unit 1.1 is not committed.
- `.env.local` is not ignored.
- A required environment variable is missing.
- Any secret would need to be copied, printed, or moved.
- The URL is not the expected Supabase Session pooler connection.
- SSL is not enabled.
- The connection fails.
- Unexpected user tables already exist.
- Payload CLI does not securely load `.env.local`.
- A new dependency is required.
- A framework or dependency version must change.
- Generated migration SQL is destructive or modifies unexpected schemas.
- The migration requires force, reset, refresh, fresh, or rollback behavior.
- A route or frontend restructuring is required.
- Any validation fails after the change.
- Any required action exceeds this Unit’s file or database scope.

Do not attempt an unapproved workaround.

## Completion Report

Provide:

### Outcome

Use `COMPLETE`, `BLOCKED`, or `FAILED`.

### Configuration

Report the created config and collection structure without exposing secrets.

### Database Connection

Report only:

- Connection success or failure
- Session pooler confirmation
- Port confirmation
- SSL confirmation

Never report the hostname, project reference, username, password, complete URL, or Payload secret.

### Migration Review

Report:

- Migration filename
- Tables and major database objects created
- Confirmation that no destructive operation was present
- Migration status

### Security Review

Confirm:

- No secret was exposed
- `.env.local` was not changed
- No anonymous user access was intentionally granted
- No Admin/API route exists
- No administrator was created
- No Supabase-managed schema was modified
- The Payload account-unlock advisory remains gated before route exposure

### Regression Results

Report actual outcomes for:

- Dependency tree
- Lint
- Production build
- Scene validation

### Repository State

Report:

- Final changed-file list
- Dependency changes
- Frontend changes
- Database changes
- Commit/push status
- Background process status

Do not begin Unit 1.3.