# Phase 2 — Unit 2.21: Admin Order Workbench Foundation

## Outcome

Give authenticated administrators a practical Payload Admin order workspace for reviewing paid Orders, securely viewing/downloading customer reference images, and performing the existing controlled fulfillment transitions.

This is an Orders collection workbench, not a new custom dashboard.

## Required behavior

1. Improve the existing Payload Orders collection list for operational use:

   - newest Orders first;
   - useful columns for creation time, customer, total, fulfillment state, refund state, and dispute state;
   - clear labels and grouping;
   - no secrets, Stripe identifiers, Storage keys, or internal reconciliation fields in the default list.

2. Add an administrator-only order detail workspace showing:

   - customer name and email;
   - immutable shipping-address snapshot;
   - subtotal, shipping, and total;
   - artist note rendered as ordinary text;
   - fulfillment, refund, and dispute state;
   - created, shipped, and delivered times formatted with `America/New_York`;
   - customer reference-image previews and downloads.

3. Keep financial, payment, Customer, address, refund, dispute, email, and upload ownership fields read-only.

4. Fulfillment controls must call only the existing controlled endpoint:

   `PATCH /api/admin/orders/:orderId/fulfillment`

   Do not duplicate transition rules in a second server mutation path.

5. Show only the currently valid next action:

   - `unfulfilled` → Start Work
   - `in_progress` → Mark Ready to Ship
   - `ready_to_ship` → Mark Shipped
   - `shipped` → Mark Delivered
   - `delivered` → no action

6. Mark Shipped must support the existing optional carrier/tracking pair and require explicit administrator confirmation because it can enqueue the customer shipment email.

7. Controls must provide:

   - single-flight submission;
   - disabled pending state;
   - safe inline errors;
   - stale/conflict handling;
   - keyboard operation;
   - accessible labels and focus behavior;
   - refresh of the displayed Order after success.

8. Add administrator-only private upload routes:

   - inline preview;
   - original-byte download.

9. Upload access must require the existing authenticated Payload administrator session and exact Order/upload ownership. Guessed, missing, deleted, or cross-Order uploads return generic denial without exposing existence or metadata.

10. Stream private Storage objects without buffering the complete file.

11. Preview/download responses must:

   - preserve the validated JPEG, PNG, or WebP MIME type;
   - use safe generated filenames;
   - use `private, no-store`;
   - use `nosniff`;
   - use same-origin resource policy;
   - never return a signed Storage URL, bucket name, object key, original filename, cookie, token, or credential.

12. Administrators may preview and download but may not replace, delete, reorder, or publicly share Order uploads from this workspace.

13. Artist notes must render as plain text. Customer or note content must never be interpreted as HTML.

14. Open/full-refund or dispute restrictions must be visibly explained, while the server remains authoritative.

15. Standard anonymous REST and GraphQL access must remain denied. Existing storefront upload-preview authorization must remain unchanged.

16. Do not send real email during tests. A mocked shipment transition may verify that the existing outbox path is invoked exactly once.

## Acceptance

Cover at minimum:

- administrator and anonymous access matrix;
- cross-Order, guessed, deleted, and missing upload denial;
- exact preview/download bytes, MIME type, disposition, filename, and privacy headers;
- bounded Storage streaming;
- no signed URL or private Storage metadata exposure;
- safe plain-text rendering of hostile customer/note content;
- correct New York timestamp display;
- exact visible fulfillment action per state;
- tracking input and shipment confirmation;
- single-flight, retry, stale conflict, and session-expiry behavior;
- successful transition refresh;
- full-refund and dispute warning states;
- exactly one mocked shipment-email job on shipped;
- no mutation from merely viewing the workbench;
- responsive desktop and narrow layout without horizontal-page overflow;
- keyboard and focus behavior;
- focused private-Storage lifecycle with exact cleanup;
- Payload import-map generation if required;
- TypeScript, changed-file ESLint, one production build, and diff check.

Do not run real Stripe, Resend, scene, public storefront, cleanup, or full regression suites.

## Boundaries

Do not add:

- a custom global Admin Dashboard;
- charts or analytics;
- search beyond Payload’s existing collection behavior;
- refund or dispute controls;
- image editing, deletion, or replacement;
- public order or tracking pages;
- carrier API calls;
- new dependencies or environment variables;
- unrelated storefront styling.

Do not create a migration unless a real schema change is necessary. Do not commit or push. Preserve user-owned changes and report the starting and ending HEAD.