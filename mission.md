# Phase 3 - Unit 3.5: Photo Booth Purchase Modal Development Preview

## Outcome

Build the new template-first multi-portrait purchase modal at development-only `/checkout/preview`. Connect the existing catalog, cart and portrait upload APIs. Preserve the homepage purchase entry until Unit 3.6 integrates payments.

## Confirmed decisions

- One to five portraits, each with one template, one to three named people/pets, private mapped photos and its own note.
- Existing server prices, upload limits and cookie authorization are authoritative.
- Group photos can cover several selected subjects; every subject needs coverage before review completion.
- Show shipping region and final-sale policy as presentation previews. The approved $10 US tracked / $5 international untracked proposals apply once per order and are estimates here, not final payable totals.
- Payment remains disabled; never submit these carts to legacy Stripe Session creation.
- Return not-found for this route in production. Do not link it from the homepage.
- Detect legacy drafts and non-draft payment state before editing. Starting over requires explicit confirmation through existing abandonment.
- Prevent the legacy amount/payment entry points from treating a portrait cart as a legacy checkout while the preview shares its Intent cookie.

## Scope

- Isolated browser contracts with response validation for catalog/cart/portrait/uploads.
- Template selection, subject entry, private photo mapping/removal, per-portrait review/note, adding portraits, cart edit/removal and shipping/policy preview.
- Refresh/reopen recovery of confirmed state and uncertain-write read-back without automatic retries.
- Accessible focus containment/restoration, keyboard access, day/night, mobile and reduced motion.
- Focused tests, TypeScript, changed-file ESLint, production build and mocked browser verification.

## Out of scope

Stripe/webhooks, shipping persistence/country allowlists, paid Order graphs, emails, artist workbench, schema/migrations, dependencies, provider configuration, homepage redesign, production assets and deployment.

## Acceptance

1. Development preview opens the new modal; production returns not-found and homepage checkout is unchanged.
2. Available templates have empty/error/retry states.
3. Create/edit preserves subject IDs and server prices; block a sixth portrait.
4. Upload mapping supports group photos and requires every subject to be covered.
5. Mapped subjects cannot be removed until their photos are adjusted or removed.
6. Save each portrait note before leaving review; edit/remove updates server state.
7. Refresh/close/reopen restores cart state. Uncertain writes require read-back before further mutation and are not automatically retried.
8. Existing legacy drafts and non-draft Intents are handled safely; the preview never calls Stripe.
9. Cart shows server subtotal, estimated shipping and policy review with payment disabled.
10. Desktop/mobile/day/night/keyboard/reduced-motion checks have no material defects.

## Verification and provider authorization

Local edits, focused tests, TypeScript, ESLint, build and isolated local browser/server checks are authorized. Browser fixtures must intercept provider-bound requests. No synthetic live database/Storage/Stripe/Resend mutation, migration apply, deployment or Git mutation is authorized. User-driven manual acceptance may exercise existing draft APIs.

## Stop conditions

Ask before changing payment/shipping authority, schemas, retention, production availability, dependencies or using live-provider fixtures. Preserve pre-existing processes and stop task-created processes. Do not stage, commit or push.
