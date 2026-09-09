# Mission: Build the First 2.5D Postcard Machine POC

## Objective

Build the first runnable visual proof of concept for the artist postcard website.

The purpose of this task is to evaluate the overall composition, handmade visual style, scroll pacing, and the coin and postcard animations. This is not the final production design.

Read `AGENTS.md` before making changes and follow all project-level rules.

## Reference Images

Inspect every PNG, JPEG, and JPG file inside the `references/` directory before implementation.

Use the photographs as visual references for:

- The machine's overall silhouette
- Its proportions
- The handmade cardboard appearance
- Its main colors and decorative shapes
- The coin slot
- The illustrated hands
- The postcard output slot

The recreation does not need to be geometrically exact. Preserve the recognizable identity and handmade character of the installation.

Do not simply display an original reference photograph as the finished machine. Recreate it as a lightweight 2.5D composition using layered HTML, CSS, SVG, masks, textures, and perspective.

If the reference images are missing or cannot be inspected, stop and ask the user before implementing the machine.

## Scope

Create one scroll-driven page containing:

1. A fixed full-screen 2.5D scene.
2. A stylized Manhattan park background.
3. The handmade postcard machine centered in the foreground.
4. A coin insertion animation.
5. A postcard printing animation.
6. Automatic day and night presentation.

Do not build marketing sections, ordering forms, authentication, payments, a database, email functionality, shipping, or an admin dashboard in this task.

## Scene

The page should use a tall scroll container with a sticky full-screen visual scene.

The scene must remain fixed while scroll progress controls the animation.

The park should include simplified layers for:

- Grass
- Trees
- A distant Manhattan-style skyline
- Sky elements
- Foreground or midground details when useful

The scene should feel like an illustrated stage rather than a realistic 3D environment.

Do not add dragging, rotation, camera movement, orbit controls, or 360-degree interaction.

## Day and Night

Use the visitor's local time by default:

- Day: 6:00 AM through 5:59 PM
- Night: 6:00 PM through 5:59 AM

Daytime should include:

- A bright sky
- A sun
- Slowly moving clouds

Nighttime should include:

- A darker sky
- A moon
- Stars
- An occasional subtle shooting star

Add these testing overrides:

- `?theme=day`
- `?theme=night`

The query parameter should override the automatic local-time theme only for testing.

## Machine

Recreate the machine as a lightweight layered 2.5D illustration.

Focus on the front-facing appearance because the machine will not rotate.

Use simple depth, shadows, perspective, overlap, masks, and irregular shapes to communicate the handmade construction.

Small decorative details may be simplified. Prioritize the elements that make the machine immediately recognizable.

## Scroll Animation

Keep scroll timing values in a clearly named configuration or constants file so they can be adjusted later.

### Stage A: Coin

During the first main animation stage:

- A coin should appear near the machine.
- It should travel toward the payment slot.
- It should pass behind the front layer or mask.
- It should disappear naturally inside the machine.

### Stage B: Postcard

During the second main animation stage:

- A postcard should begin hidden inside the output slot.
- It should move downward as though it is being printed.
- It should become fully visible near the end of the page.
- Use a temporary illustrated placeholder on the postcard.

Both animations must follow scroll progress and reverse naturally when the user scrolls upward.

Use Anime.js for the primary scroll-driven animation behavior.

## Architecture

Keep the implementation feature-based and follow `AGENTS.md`.

Separate:

- Scene presentation
- Park background
- Machine illustration
- Coin presentation
- Postcard presentation
- Theme calculation
- Scroll progress
- Animation configuration

Keep visual components separate from scroll and animation logic.

Do not add new production dependencies without asking first.

Do not modify `AGENTS.md` or `mission.md`.

## Responsive Behavior

The scene must work at minimum on:

- Desktop around 1440 × 900
- Mobile around 390 × 844

Requirements:

- Keep the machine visible and centered.
- Avoid horizontal scrolling.
- Prevent important elements from being clipped.
- Scale the machine and background appropriately.
- Provide a reduced-motion experience.

## Acceptance Criteria

The task is complete when:

- All reference images were inspected.
- The project runs successfully.
- The machine is recreated as a recognizable 2.5D illustration.
- The original photographs are not used as the final machine layer.
- The scene remains fixed during scrolling.
- The coin enters and disappears into the payment slot.
- The postcard prints from the output slot.
- Both animations reverse correctly.
- Automatic day and night modes work.
- The day and night query overrides work.
- Desktop and mobile layouts remain usable.
- There are no obvious browser console errors.
- `npm run lint` passes.
- `npm run build` passes.

## Completion Report

When finished, provide a concise report containing:

1. A summary of the implementation.
2. Files created or changed.
3. Validation commands and their results.
4. Placeholder assets or known visual limitations.
5. Exact steps the user should manually verify.
6. Any unresolved issue that needs a decision.

Do not create a Git commit.