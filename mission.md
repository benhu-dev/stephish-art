# Phase 3 - Unit 3.1: Photo Booth Homepage Structure and Visual Foundation

## Outcome

Restructure the public homepage into a video-led Photo Booth brand experience that introduces Stephish, presents real-world event imagery, transitions naturally into the existing Manhattan park 2.5D scene, and exposes the `Drop Your Coins` purchase entry point.

This Unit changes homepage presentation and composition only. It must preserve the current checkout modal and all backend behavior unchanged.

## Product decisions

1. Photo Booth is the provisional brand homepage at `/`.
2. A detailed About page will be implemented separately; this homepage includes only a concise artist introduction.
3. The approved existing Manhattan park, postcard machine, reversible scroll stages, New York day/night behavior, theme overrides, responsive layouts, and reduced-motion behavior remain intact.
4. Photo Booth presentation must remain portable enough to move to a dedicated route later.
5. User-provided sample video, gallery images, or template previews may be used when the user explicitly identifies them for development. Keep replaceable sample assets isolated from layout logic.

## Required behavior

1. Compose the homepage in this order:
   - a Photo Booth hero with a replaceable background video or approved temporary visual;
   - concise Photo Booth and artist introduction;
   - an accessible event-photo gallery;
   - a visually continuous gradient transition;
   - the existing 2.5D Manhattan park scene and scroll interaction.
2. The hero must provide readable content over moving media through controlled overlays and contrast.
3. Video behavior, when an approved video is available, must be muted, looping, inline, and non-blocking, with a poster or static fallback.
4. Reduced-motion users must receive a stable static presentation without autoplay-dependent meaning.
5. The existing 2.5D scene must pin and animate only within its own section. Earlier content must use ordinary document scrolling, and entry into or exit from the scene must not trap scrolling.
6. Add a visible, keyboard-accessible `Drop Your Coins` call to action that opens the existing checkout modal without changing its request contracts, state model, copy beyond the entry label, or backend behavior.
7. Preserve `?theme=day` and `?theme=night` deterministic overrides and New York-time default theming.
8. Keep the page usable on desktop, portrait mobile, and landscape mobile without page-level horizontal overflow.
9. Preserve semantic headings, keyboard operation, meaningful image alternatives, focus visibility, and sufficient text contrast.
10. Do not load unapproved remote fonts, trackers, embeds, or media.

## Scope

In scope:

- homepage section composition;
- reusable Photo Booth presentation components;
- hero media and fallback behavior;
- concise introduction and event-gallery presentation;
- gradient and spatial transition into the existing scene;
- `Drop Your Coins` entry-point wiring to the existing modal;
- focused responsive, accessibility, motion, and browser verification.

Out of scope:

- template schema or Payload Admin template management;
- multi-portrait cart, subject fields, photo mapping, per-portrait notes, or new pricing;
- shipping, international addresses, customer policy acceptance, Stripe Session, webhook, Order, email, cleanup, or workbench changes;
- About, Live Drawing, Portfolio, or global-navigation implementation;
- replacing or broadly redesigning the approved 2.5D artwork;
- copying reference files into the repository unless the user identifies them as approved development assets;
- new dependencies without a stop-and-ask decision.

## Acceptance

- The homepage presents the approved section order and reaches the existing scene through a coherent visual transition.
- Ordinary page scrolling remains natural before the scene; the existing reversible scene interaction still works inside its section.
- `Drop Your Coins` opens the unchanged checkout modal with mouse and keyboard.
- Day, night, query overrides, reduced motion, background visibility handling, and scene reversal remain functional.
- Hero content remains readable with media available, unavailable, loading, or disabled.
- Gallery media has appropriate alternatives and does not cause layout shift or horizontal overflow.
- Desktop 1440x900, portrait mobile 390x844, and landscape mobile 844x390 are usable.
- There are no browser console errors attributable to this Unit.
- No database, Storage, Stripe, Resend, migration, or provider mutation occurs during homepage acceptance.

## Focused validation

1. Add or update focused component and presentation coverage where it provides meaningful evidence.
2. Run the affected homepage, scene, and checkout-entry acceptance checks.
3. Run TypeScript.
4. Run ESLint on changed handwritten files.
5. Run focused browser checks at the three approved viewport classes, both themes, and reduced motion.
6. Run one production build after the final UI state.
7. Run `git diff --check`.

Do not run Stripe, Storage, Resend, database, migration, webhook, cleanup, email, or Admin lifecycle suites for this presentation-only Unit.

## Stop conditions

- Stop and ask if the requested layout requires replacing approved scene artwork or changing scene interaction semantics.
- Stop and ask before treating a reference video, screenshot, or photograph as a production asset when the user has not explicitly approved that use.
- Stop and ask if a global navigation or About-page decision becomes necessary to complete the homepage.
- Stop and ask if opening `Drop Your Coins` cannot be achieved without changing checkout contracts or backend behavior.
- Do not commit or push.
