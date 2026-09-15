# Handmade postcard machine

A single-page visual POC built with Next.js App Router, React, TypeScript, Tailwind CSS, and Anime.js v4. All three photographs in `references/` informed the layered SVG machine; photographs are not rendered in the scene.

## Run

```sh
npm install
npm run dev
```

Open http://localhost:3000. For a production preview, run `npm run build` followed by `npm run start`. In PowerShell environments that block `npm.ps1`, use `npm.cmd`.

Payload requires `DATABASE_URL` and `PAYLOAD_SECRET`. Private order uploads also
require these server-only variable names in `.env.local`:

```text
SUPABASE_STORAGE_BUCKET
SUPABASE_STORAGE_ENDPOINT
SUPABASE_STORAGE_REGION
SUPABASE_STORAGE_ACCESS_KEY_ID
SUPABASE_STORAGE_SECRET_ACCESS_KEY
```

The configured bucket must be the private `order-uploads` bucket. Payload accepts
JPEG, PNG, and WebP uploads up to 15 MiB, stores no local copy, and serves files
only through authenticated, signed downloads. Apply reviewed migrations with
`npm run payload -- migrate`; inspect status with
`npm run payload -- migrate:status`.

## Scene and timing

The machine, camera, and park stay fixed in a sticky viewport across a 360svh scroll container. Scroll down to insert a coin and print a postcard; scroll up to reverse. Anime.js controls the timeline using its [scroll synchronization](https://animejs.com/documentation/events/onscroll/scrollobserver-synchronisation-modes/).

- `src/features/postcard-machine/components/`: scene, park, machine, coin, and postcard presentation.
- `src/features/postcard-machine/hooks/`: scroll/ambient animation lifecycle and local-time theme updates.
- `src/features/postcard-machine/lib/animation-config.ts`: stage boundaries and scroll length. Timeline units map to scroll progress, not elapsed milliseconds.
- `src/features/postcard-machine/lib/theme.ts`: pure theme calculation.
- `src/features/postcard-machine/scene.css`: scene composition, theme colors, and responsive framing.

Local time selects day at 06:00–17:59 and night at 18:00–05:59, refreshed every 30 seconds. `/?theme=day` and `/?theme=night` override the clock for testing. Reduced motion removes ambient animation and uses discrete coin/postcard states. Background animation pauses while the document is hidden. No extra dependencies, remote fonts, or remote assets are required.

## Verify

```sh
npm run lint
npm run build
```

`scripts/check-scene.mjs` also checks the production page through Chromium's debugging protocol without an added dependency. Start the production server on port 3000, launch a dedicated headless Chromium with `--remote-debugging-port=9222` and a temporary `--user-data-dir`, then run:

```sh
node scripts/check-scene.mjs
```

The check covers 1440×900, 390×844, and 844×390, both themes, scroll reversal, machine bounds, local-time boundaries, override precedence, reduced motion, and browser errors. Screenshots go to the ignored `.next/scene-checks/` folder.

Manually verify:

1. At `/?theme=day`, scroll slowly from top to bottom. The coin appears, enters the vertical payment slot, and disappears; the postcard then prints down from the cyan opening.
2. Reverse direction during each stage and return to the top. Confirm smooth reversal and a hidden postcard at the start.
3. Repeat at `/?theme=night`; check the moon, stars, and occasional shooting star (roughly every 18 seconds after its initial delay). In day mode, watch the subtle cloud drift.
4. Remove the query parameter and confirm the theme matches your local hour.
5. Repeat at 1440×900 and 390×844, plus a landscape phone. Check framing, text, postcard visibility, and absence of horizontal scrolling. Use Page Down/Page Up as well as wheel or touch scrolling.
6. Enable your system/browser reduced-motion preference. Confirm stationary clouds and discrete, reversible coin/postcard states.

## Visual limitations

The park postcard and small portrait decorations are temporary original SVG illustrations. Cardboard texture, lettering, illustrated hands, and construction depth are simplified interpretations of the photographs. The dark central opening is illustrative. The POC has no commerce or other backend behavior.
