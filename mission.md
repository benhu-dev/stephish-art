# Phase 2 — Unit 2.10.2: Unified Text Transitions and Final-Stage Pacing

## Goal

Fix the remaining stuck or overlapping text states and give the final narrative stages more scroll room before the CTA appears.

Keep this task limited to text visibility, transition state, and scroll-stage spacing.

## Unified Text State

Treat every major text presentation as part of one mutually exclusive sequence:

1. Initial hero text
2. Narrative stage 1
3. Narrative stage 2
4. Narrative stage 3
5. Narrative stage 4
6. Final CTA panel

The initial hero, narrative copy, and CTA must not use separate competing visibility calculations.

At rest, exactly one presentation group may be visible and readable. Every inactive group must finish with:

* `opacity: 0`
* Its intended hidden transform
* `visibility: hidden`
* `pointer-events: none`
* `aria-hidden="true"` where applicable

Remove any remaining scroll-derived partial opacity or transform that can leave the hero, narrative text, or CTA frozen between states.

A transition must:

1. Finish the outgoing animation.
2. Fully hide the outgoing group.
3. Activate the requested group.
4. Finish the incoming animation independently of further scrolling.
5. End in explicit settled styles.

Use a reliable completion path with a safe fallback so missed animation or transition events cannot leave an intermediate state.

If scrolling changes the requested stage during an active transition, retain only the latest requested stage and settle there after the current transition completes.

Reduced-motion mode must switch immediately to a valid settled state.

## Final-Stage Pacing

Do not make the fade or slide animations artificially slow.

Instead, increase the available scroll distance near the end of the scene:

* The last two narrative stages must have at least as much scroll space as the earlier narrative stages.
* The final line, `A small piece of your story, made by hand.`, must remain fully settled for approximately one viewport height of scrolling before the CTA transition begins.
* `Want one of your own?` must not begin entering while the final narrative is still entering or visible.
* Extend the overall scene scroll height if necessary instead of compressing earlier stages.
* Preserve deterministic reverse scrolling with the same improved spacing.

Keep all copy, visual styling, scene artwork, modal behavior, and CTA content unchanged.

## Focused Verification

Test only this frontend behavior:

* Stop just after every transition trigger and wait; no text may remain partially visible or overlapped.
* Confirm the initial hero fully disappears before narrative stage 1 becomes readable.
* Confirm every inactive presentation is hidden after settling.
* Confirm rapid forward and reverse scrolling settles on the latest requested stage.
* Confirm the final narrative receives a clearly longer stable dwell before the CTA.
* Confirm the CTA never overlaps readable narrative text.
* Verify desktop, portrait mobile, landscape mobile, day/night, and reduced motion.
* Run focused tests, postcard-scene regression, TypeScript, ESLint, and production build only.

Do not change the modal, APIs, backend, Stripe, database, schema, migrations, dependencies, environment files, or copy.

Preserve the current Unit 2.10 changes and user-owned files. Do not commit or push.

Report the transition fix, revised stage spacing, validation results, files changed, and final Git status.
