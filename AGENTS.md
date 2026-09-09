# AGENTS.md

## Project

This repository is a frontend proof of concept for an artist's custom postcard website.

The current goal is to validate the visual style and scroll-driven 2.5D interaction before building ecommerce, authentication, database, payment, email, shipping, or admin features.

## Current Experience

Build a fixed-camera 2.5D scene with these elements:

- A stylized Manhattan park background with grass, trees, buildings, and skyline layers.
- Automatic day and night appearance based on the visitor's local time.
- Daytime elements may include the sun and slowly moving clouds.
- Nighttime elements may include the moon, stars, and occasional shooting stars.
- A handmade instant-postcard machine remains centered in the scene.
- The machine should approximately reproduce the supplied reference photos while preserving its handmade character. Exact geometry is not required.
- At scroll stage A, a coin moves into the machine's payment slot and disappears behind a mask.
- At scroll stage B, a postcard prints downward from the output slot.
- Scrolling upward should reverse the animations naturally.
- The scene, camera, and machine must not support dragging, rotation, orbit controls, or 360-degree viewing.

Ignore backend, Supabase, Stripe, email, shipping, customer accounts, and admin features unless they are explicitly requested.

## Technology

Use:

- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- Anime.js v4

Prefer lightweight 2.5D techniques:

- HTML and CSS layers
- SVG artwork
- Transparent PNG or WebP assets
- CSS transforms and perspective
- Masks, clipping, and controlled z-index layers

Do not add Three.js, React Three Fiber, GSAP, Spline runtime, a physics engine, or another animation library unless explicitly approved.

Use Anime.js for scroll progress, timelines, and element animation.

## Architecture

Organize code by feature and responsibility.

- Route and page files should mainly compose features.
- Keep feature-specific components, hooks, types, constants, and utilities together.
- Separate visual components from scroll and animation control logic.
- Put reusable scroll behavior in custom hooks.
- Put calculations and other pure logic in utility functions.
- Move code into shared folders only when it is genuinely reused.
- Avoid large general-purpose components and unnecessary abstractions.
- Keep each file focused on one responsibility.
- Aim to keep files below approximately 250 lines.
- When a file exceeds approximately 300 lines, evaluate whether it should be split by responsibility.
- Do not split a cohesive file solely to satisfy a line limit.

A suitable direction is:

src/
  app/
  features/
    postcard-machine/
      components/
      hooks/
      lib/
      types/
  shared/
    components/
    hooks/
    lib/
    types/

Adapt this structure when the actual implementation provides a clearer boundary.

## Code Quality

- Use TypeScript with explicit, useful types.
- Avoid `any` unless there is a documented reason.
- Prefer small, reusable components and functions.
- Avoid duplicated logic and duplicated constants.
- Avoid adding dependencies for functionality that can be implemented simply.
- Clean up observers, event listeners, animation instances, and timers.
- Preserve existing user changes and avoid unrelated rewrites.
- Ask before adding a new production dependency or substantially changing scope.
- Add comments only when they explain non-obvious behavior or constraints.

## Responsive Design and Accessibility

- Build mobile-first and support common desktop and mobile viewport sizes.
- Keep the machine visible and properly framed across different aspect ratios.
- Use semantic HTML for actual content.
- Do not place important text only inside decorative graphics.
- Support `prefers-reduced-motion`.
- Ensure the page remains understandable when motion is reduced.
- Decorative animations must not block navigation or interaction.

## Animation and Performance

- Prefer animating `transform` and `opacity`.
- Avoid unnecessary layout-triggering animation.
- Keep scroll-linked animation smooth and reversible.
- Keep background animations subtle.
- Pause or reduce nonessential animation when appropriate.
- Optimize image dimensions and file sizes.
- Do not introduce complex 3D rendering unless the 2.5D approach proves insufficient.

## Verification

After meaningful code changes:

1. Run `npm run lint`.
2. Run `npm run build`.
3. Report any remaining warnings or failures.
4. Do not claim the task is complete unless relevant checks pass.