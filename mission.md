# Mission

## Phase and Unit

Phase 1 — Payload Foundation
Unit 1.1 — Payload Compatibility and Dependency Foundation

## Goal

Verify Payload CMS compatibility with the existing project and install only the minimum Payload dependencies required for a future PostgreSQL-backed integration.

This Unit establishes the dependency foundation. It does not configure Payload routes, connect a database, create collections, or expose an Admin Panel.

The existing Next.js application and 2.5D frontend must remain functionally and visually unchanged.

## Existing Baseline

The accepted pre-Payload baseline is:

* Branch: `main`
* Baseline commit: `c86775323d41a3298f234a94eac946a8ee0e2c35`
* Node.js: `24.19.0`
* npm: `11.17.0`
* Next.js: `16.3.4`
* React and React DOM: `19.2.8`
* TypeScript: `5.9.3`
* Anime.js: `4.5.0`
* Tailwind CSS: `4.3.3`

The existing baseline has already passed lint, production build, and scene validation.

## Acceptance Contract

Before installing anything:

1. Inspect the current package manifest and lockfile.
2. Verify compatibility using current official Payload documentation and package metadata.
3. Record the exact Payload and related package versions proposed for installation.
4. Confirm that npm can resolve them without force flags or ignored peer dependencies.
5. Confirm that only the minimum required dependencies will be installed.

Do not choose package versions merely because they are the newest. They must be mutually compatible with the existing project.

## In Scope

* Read `AGENTS.md` and this `mission.md`.
* Inspect current Git status.
* Treat the user-approved `mission.md` change as expected.
* Inspect `package.json` and `package-lock.json`.
* Verify official Payload requirements for:

  * Node.js
  * Next.js
  * React
  * TypeScript
  * npm
  * PostgreSQL adapter
* Inspect current npm package metadata and peer dependencies.
* Select one mutually compatible Payload version set.
* Install only the minimum dependencies required for:

  * Payload core
  * Payload’s Next.js integration
  * Payload’s PostgreSQL adapter
* Keep related Payload packages on the same compatible release version where required.
* Update `package.json` and `package-lock.json` through npm.
* Run dependency integrity, lint, build, and existing scene validation.
* Report dependency advisories and installation-script warnings without automatically applying unrelated fixes.

## Expected Dependency Scope

The expected dependency candidates are:

* `payload`
* `@payloadcms/next`
* `@payloadcms/db-postgres`

Confirm the current official requirements before installation.

Do not install optional packages unless they are proven necessary for this Unit.

Packages that are expected to remain deferred include:

* `@payloadcms/richtext-lexical`
* `sharp`
* `graphql`
* Stripe SDK or Payload Stripe plugin
* Storage adapters
* Email SDKs
* Test frameworks
* Validation libraries
* Supabase client libraries

If an additional package is technically required to complete the minimum installation, explain why and ask the user before adding it.

## Package-Management Rules

* Continue using npm because the repository already uses `package-lock.json`.
* Use `npm.cmd` where PowerShell’s script policy requires it.
* Do not switch to pnpm or yarn.
* Do not delete or regenerate the lockfile from scratch.
* Do not use `--force`.
* Do not use `--legacy-peer-deps`.
* Do not suppress peer-dependency conflicts.
* Do not run `npm audit fix`.
* Do not perform unrelated dependency upgrades.
* Do not approve unrelated package install scripts automatically.
* Do not change global npm configuration.

If compatible dependencies cannot be resolved normally, stop and ask the user.

## Files Allowed to Change

Expected changes are limited to:

* `package.json`
* `package-lock.json`

Do not change other files unless an unexpected, mandatory installation requirement is discovered and approved by the user.

In particular, do not modify:

* Existing frontend source files
* `src/app`
* `src/features/postcard-machine`
* Existing CSS or SVG
* `next.config.ts`
* `tsconfig.json`
* `.gitignore`
* `README.md`
* `AGENTS.md`
* `mission.md`
* Environment files
* Test scripts

## Out of Scope

Do not:

* Run `create-payload-app`.
* Run `create-next-app`.
* Replace or regenerate the existing application.
* Create `payload.config.ts`.
* Create Payload route groups.
* Move the existing frontend into a route group.
* Add or modify an `/admin` route.
* Connect to Supabase or PostgreSQL.
* Add a database connection string.
* Generate or execute database migrations.
* Create administrator accounts.
* Create Payload collections.
* Configure uploads.
* Configure Stripe.
* Configure email.
* Add environment secrets.
* Start a persistent development server.
* Modify the 2.5D design or animation.
* Begin Unit 1.2.
* Commit or push changes.

## Acceptance Criteria

1. Current official Payload compatibility requirements are reported with source links.
2. The selected Payload package versions are reported before installation.
3. The selected versions support the existing Next.js and Node.js versions.
4. npm resolves the dependency set without `--force` or `--legacy-peer-deps`.
5. Only approved minimum Payload dependencies are added.
6. Existing dependencies are not broadly upgraded or removed.
7. `npm ls --depth=0` completes without an invalid dependency tree.
8. The existing lint command passes.
9. The existing production build passes.
10. The existing scene validation passes.
11. Existing public routes and 2.5D behavior remain unchanged.
12. Only `package.json` and `package-lock.json` are changed.
13. No secrets, database URLs, or environment files are added.
14. No commit or push is created.
15. No background process remains.

## Required Verification

Inspect the scripts before running them, then run the applicable equivalent of:

```text
git status --short
node --version
npm.cmd --version
npm.cmd ls --depth=0
npm.cmd run lint
npm.cmd run build
node scripts/check-scene.mjs
git status --short
git diff --stat
```

Also inspect:

* The final root dependency list.
* The exact versions resolved in `package-lock.json`.
* npm peer-dependency output.
* npm audit summary.
* Any install-script warnings.

Do not run a persistent development server.

## Stop and Ask If

Stop and ask the user before proceeding if:

* Official Payload documentation does not support the existing Next.js or Node.js version.
* npm reports an unresolved peer-dependency conflict.
* Installation requires `--force` or `--legacy-peer-deps`.
* A Payload package requires downgrading or upgrading Next.js, React, Node.js, or TypeScript.
* Installation requires changing source or configuration files in this Unit.
* An additional non-approved package appears mandatory.
* npm attempts to remove or broadly upgrade existing dependencies.
* Existing frontend validation fails after installation.
* Unexpected pre-existing source changes overlap this Unit.
* A security warning indicates immediate material risk.
* Any operation would exceed the allowed file scope.

Do not attempt a workaround without approval.

## Completion Report

Provide:

### Outcome

Use:

* `COMPLETE`
* `BLOCKED`
* `FAILED`

### Compatibility Decision

Report:

* Official requirements
* Existing versions
* Selected Payload versions
* Compatibility conclusion
* Official sources consulted

### Dependency Changes

List:

* Packages added
* Exact installed versions
* Any transitive-install warnings
* npm audit summary

### Acceptance Evidence

For every acceptance criterion, report:

* Verification method
* `PASS`, `FAIL`, `BLOCKED`, or `NOT RUN`

### Regression Results

Report the actual outcome of:

* Dependency-tree validation
* Lint
* Production build
* Scene validation

### Security Review

Confirm:

* No secret was added
* No environment file changed
* No database connection was attempted
* No install conflict was bypassed
* No unrelated audit fix was applied

### Repository State

Confirm:

* Final changed files
* Whether dependencies changed
* Whether frontend files changed
* Whether a commit or push was created
* Whether a background process remains

Do not begin Unit 1.2.
