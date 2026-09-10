# Mission

## Phase and Unit

Phase 0 — Baseline and Architecture
Unit 0.1 — Existing Repository Verification

## Goal

Verify that the existing repository is a clean, working, and reproducible baseline before Payload CMS is introduced.

This is a read-only inspection Unit. The existing Next.js application and 2.5D frontend are already implemented and must remain unchanged.

## Existing Project State

The repository already contains:

* An initialized Git repository connected to GitHub.
* An existing Next.js application.
* TypeScript, React, Tailwind CSS, and Anime.js.
* A working 2.5D postcard-machine proof of concept.
* Scroll-controlled coin and postcard animations.
* Automatic day and night themes.
* Responsive and reduced-motion behavior.
* Existing lint, build, and scene validation scripts.

This Unit does not authorize recreating or restructuring any of these items.

## In Scope

* Read `AGENTS.md` and this `mission.md` completely.
* Inspect the current Git status.
* Record the current branch, commit, and configured remote.
* Inspect `package.json` and the package lockfile.
* Record the installed Node.js, npm, Next.js, React, TypeScript, Anime.js, and related package versions.
* Inspect the existing source-directory structure.
* Identify the existing public application entry points.
* Identify the 2.5D scene components, hooks, utilities, styles, and tests.
* Inspect `.gitignore` and confirm generated output is excluded.
* Confirm whether `.next`, `node_modules`, test artifacts, and local environment files are excluded from Git.
* Run the existing non-destructive validation commands.
* Identify any current OneDrive, path, generated-output, or package-management risks.
* Produce a concise readiness report for the future Payload integration Unit.

## Out of Scope

Do not:

* Modify any source file.
* Modify configuration or documentation.
* Modify `AGENTS.md` or `mission.md`.
* Install, remove, or update dependencies.
* Install Payload.
* Run `git init`.
* Run `create-next-app`.
* Run `create-payload-app`.
* Create or execute database migrations.
* Add environment variables.
* Reorganize directories.
* Rename or move files.
* Reformat files.
* Repair detected issues.
* Delete `.next` or any other directory.
* Start implementing backend functionality.
* Change the existing frontend.
* Create a commit.
* Push to GitHub.
* Start the next Unit.

## Required Inspection

Inspect at least:

* `AGENTS.md`
* `mission.md`
* `package.json`
* The package lockfile
* `.gitignore`
* `next.config.*`
* `tsconfig.json`
* `src/app`
* `src/features`
* `scripts`
* Existing test files and test configuration

Do not expose the contents of `.env` files or print secret values.

## Required Verification

Run these commands if they exist and are supported by the repository:

```text
git status --short
git branch --show-current
git rev-parse HEAD
git remote -v
node --version
npm --version
npm run lint
npm run build
node scripts/check-scene.mjs
```

Before running project commands, inspect `package.json` to confirm the scripts and their purpose.

Do not start a persistent development server.

If a command fails because of OneDrive synchronization, stale generated output, permissions, or environment configuration, report the failure and stop. Do not clean, delete, reinstall, or repair anything without approval.

## Acceptance Criteria

1. The current Git branch, commit, remote, and working-tree state are reported.
2. The current framework and relevant dependency versions are reported.
3. The existing application structure is summarized without changing it.
4. The existing 2.5D frontend implementation and validation coverage are identified.
5. Git-ignore coverage for generated output, dependencies, and local secrets is assessed.
6. Existing lint completes successfully, or its exact failure is reported.
7. Existing production build completes successfully, or its exact failure is reported.
8. The existing scene validation completes successfully, or its exact failure is reported.
9. No source, configuration, dependency, documentation, or lockfile changes are made.
10. No Git commit or push is created.
11. No persistent background process remains.
12. Risks relevant to introducing Payload CMS are listed without attempting to fix them.

## Stop and Ask If

Stop and ask the user before continuing if:

* `AGENTS.md` and `mission.md` conflict.
* The working tree contains unexpected existing changes.
* Validation appears to require deleting or regenerating files manually.
* The repository cannot be inspected safely.
* A command would modify tracked source or dependency files.
* The current project appears corrupted.
* The Git remote does not match the expected project.
* Any requested action would exceed this read-only Unit.

## Completion Report

Return a concise report containing:

### Outcome

Use one of:

* `COMPLETE`
* `BLOCKED`
* `FAILED`

### Repository Baseline

Report:

* Branch
* Commit
* Remote
* Working-tree status
* Project location

Do not expose private credentials contained in remote URLs.

### Current Stack

Report the relevant installed versions found in the repository and environment.

### Existing Structure

Summarize the important frontend directories and responsibilities. Do not suggest a broad refactor during this Unit.

### Validation Results

For every acceptance criterion, report:

* Verification method
* `PASS`, `FAIL`, `BLOCKED`, or `NOT RUN`

### Payload Readiness Risks

List only concrete risks observed from the repository, such as:

* Version compatibility requiring investigation
* Route-group integration considerations
* Existing path or layout conflicts
* OneDrive synchronization
* Environment-variable preparation
* Database or storage configuration still missing

Do not install or configure Payload.

### Repository State Confirmation

Explicitly confirm:

* Whether any file changed
* Whether dependencies changed
* Whether `AGENTS.md` or `mission.md` changed
* Whether a commit or push was created
* Whether any background process remains

Do not proceed to Phase 1.
