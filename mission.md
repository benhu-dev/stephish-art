# Phase 2 — Unit 2.16.2: Checkout Confirmation Transition

## Goal

Polish the existing `/checkout/success` experience with a short, interruptible NYC postmark animation while preserving the existing status polling and payment behavior.

This Unit is presentation-only. Do not change Stripe, webhook fulfillment, database records, status contracts, or payment logic.

## Required experience

### Processing

When the status is processing:

- Show the heading: `Confirming your order…`
- Show supporting copy explaining that the payment was submitted and the order is being finalized.
- Reuse or extend the existing NYC postmark styling as the loading indicator.
- Delay the animated loader’s visibility by approximately 150ms to prevent flashing during extremely fast confirmation.
- Use a short seamless loop, approximately 0.8–1.2 seconds, that looks intentional at any interruption point.
- Do not impose a minimum processing duration.
- Do not delay or block polling.

### Confirmed

As soon as the existing status endpoint returns confirmed:

- Update the application state immediately.
- Stop the processing animation.
- Trigger a pink `CONFIRMED` postmark effect.
- Animate the stamp and content transition over approximately 350–500ms.
- The animation must be purely visual and must not delay the confirmed state in JavaScript.
- Crossfade the existing confirmed heading, monetary summary, and `Return Home` action into the same card.
- Do not automatically redirect to the homepage.

If confirmation arrives before the loader’s 150ms appearance delay, skip the loader and show the confirmed transition directly.

### Slow confirmation and timeout

- Preserve the existing bounded polling interval and 60-second maximum.
- After approximately 10–15 seconds, add calm supporting copy such as:
  `This is taking a little longer than usual.`
- When bounded polling ends without a terminal status:
  - Do not claim that payment failed.
  - Show a safe “still confirming” message.
  - Provide `Check Again` and `Return Home`.
- `Check Again` starts a fresh bounded read-only polling cycle.
- It must not create a Checkout Session, charge, Order, Customer, or any other mutation.

## Motion and accessibility

- Respect `prefers-reduced-motion`.
- Reduced-motion mode uses a static postmark and immediate content changes without rotation, drawing, bouncing, or translation.
- Keep meaningful status text available independently of animation.
- Use an appropriate polite live region for processing and confirmed status updates.
- Decorative animation must be hidden from assistive technology.
- Do not unexpectedly move keyboard focus.
- Preserve visible focus states.

## Visual requirements

- Match the existing postcard, hand-drawn, 2.5D art direction.
- Do not use a generic circular web spinner.
- Keep typography, colors, borders, shadows, spacing, and button styling consistent with the existing result pages and checkout modal.
- Preserve day/night presentation where already supported.
- Verify desktop 1440×900, mobile 390×844, and landscape 844×390 without overflow or clipped actions.

## Security and behavior constraints

- Preserve the existing cookie-authenticated, identifier-free status flow.
- Do not add IDs, Stripe data, email, PII, query parameters, or payment details to the DOM, URL, logs, or browser storage.
- Do not change status endpoint requests or response parsing.
- Do not change polling authority or introduce client-side payment assumptions.
- No dependency, environment, schema, migration, Payload, Stripe, webhook, Storage, Email Outbox, or admin changes.

## Focused verification

Add deterministic focused coverage for:

- Processing loader hidden during the initial delay.
- Loader appearing after the delay.
- Confirmation before the delay without loader flash.
- Confirmation during any loader cycle.
- Confirmed stamp and content transition.
- No artificial confirmation delay.
- Slow-confirmation copy.
- Polling timeout actions.
- Check Again starting only a new read-only polling cycle.
- Reduced-motion behavior.
- No duplicate or overlapping polling.
- Cleanup and request abort on unmount.
- Responsive layout and keyboard accessibility.

Run only:

- Focused result-page tests
- Focused mocked browser checks
- TypeScript
- Changed-file ESLint
- One production build
- git diff --check

Do not run real Stripe, webhook, database, Storage, Email Outbox, checkout lifecycle, scene, or unrelated full regression suites.

## Repository rules

- Preserve unrelated work and mission.md.
- Do not modify AGENTS.md.
- Do not commit or push.
- Stop task-created servers and browsers.