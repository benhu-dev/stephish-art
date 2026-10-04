# Phase 2 — Unit 2.21.1: Make the Order Workbench Reachable

## Outcome

Fix the Payload Orders list so administrators can clearly open each Order and reach the existing secure Order Workbench.

This is a focused Admin navigation and list-UX defect fix. Do not redesign the workbench or expand backend functionality.

## Required behavior

1. On `/admin/collections/orders`, every Order must have an obvious, keyboard-accessible `View Order` link or button.
2. Activating it must open the correct Order’s existing custom Workbench.
3. The Workbench must continue showing:
   - customer and shipping details;
   - totals, refund, dispute, and fulfillment state;
   - artist note;
   - owned reference-image previews;
   - protected Preview and Download actions;
   - existing fulfillment controls.
4. Provide a clear way to return to the Orders list.
5. Remove or hide the row-selection checkboxes and `Select all` UI when no permitted bulk action exists.
6. Default list columns must include:
   - Created (New York);
   - Recipient Name;
   - Customer Email;
   - Total;
   - Fulfillment;
   - Refund;
   - Dispute.
7. Artist Note must not be a default list column. It may remain available in the Columns picker.
8. Preserve sorting, filtering, pagination, column selection, responsive behavior, and read-only access rules.
9. Opening or viewing an Order must perform no database, Storage, Stripe, or email mutation.
10. Preview and download authorization must remain scoped to the authenticated administrator and exact Order/upload ownership.

## Constraints

- Diagnose and document the actual navigation failure before fixing it.
- Prefer supported Payload extension points.
- Do not rely on fragile DOM mutation or broad global CSS selectors.
- Do not expose Storage keys, signed URLs, internal credentials, or private identifiers in rendered content or logs.
- No schema, migration, dependency, environment, payment, webhook, email, cleanup, or storefront changes.
- Do not modify user-owned data.
- Do not commit or push.

## Focused acceptance

- Administrator can open each tested Order with mouse and keyboard.
- The opened Workbench always belongs to the selected row.
- Existing image thumbnails render for an Order with uploads.
- Preview and Download remain functional and private.
- Cross-Order and guessed upload access remain denied.
- No inert selection controls remain.
- Default columns appear without manually using Columns.
- Desktop 1280×900 and mobile 390×844 remain usable with no page-level horizontal overflow.
- No browser console errors.
- Viewing the list and Workbench causes zero mutations.

## Validation

Run only focused validation:

1. Red-first regression for the missing navigation.
2. Relevant Admin Orders acceptance tests.
3. One focused production-browser lifecycle covering list → Workbench → preview/download → return.
4. TypeScript.
5. ESLint on changed handwritten files.
6. One production build.
7. `git diff --check`.

Stop all task-created processes and report changed files, acceptance results, and final repository status.