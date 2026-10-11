# Unit 3.5 acceptance

## Development preview

With the normal development server running, open `http://localhost:3000/checkout/preview`. Use `?theme=day` or `?theme=night` to compare palettes. Production builds intentionally return 404 for this route. The homepage still uses legacy checkout; multi-portrait Stripe integration is Unit 3.6.

The preview uses the existing Checkout Intent cookie. It does not silently replace an existing empty/legacy draft or an Intent that has moved to payment. Starting over explicitly abandons a draft under the existing retention policy. Only server-confirmed changes survive refresh. Shipping selections and policy acknowledgment are temporary presentation state.

## Manual checks

1. Select a real available template. Enter one to three names and person/pet types. Confirm the saved portrait costs $20/$25/$30.
2. Add a private JPEG/PNG/WebP photo, selecting the people/pets visible in it. One group photo can cover several subjects. Check that missing coverage and unsaved assignments block review. Photo count must not exceed subject count.
3. Add a note, then choose `Order another portrait`. Make the second portrait use different names, a different design and a separate note. Confirm that `Save & next` shows both portraits and the server subtotal.
4. Refresh, reopen, and edit a portrait. Confirm its subjects, private previews and note return. Removing a mapped subject should instruct you to adjust/remove photos first.
5. Remove one portrait using its confirmation. Confirm that the remaining portrait, its photos/note and subtotal remain correct.
6. Check US $10 tracked and international $5 untracked estimates, each charged once in the display. Read the policy. Payment stays disabled even after acknowledgment.
7. Check a phone-sized viewport, night palette, Tab/Shift+Tab, Escape, focus restoration, and system reduced-motion preference.

No real payment or new migration is required. User-driven reference uploads create private draft records and objects; abandon unwanted drafts through the UI so existing cleanup can reclaim them.

## Isolated synthetic fixture

To exercise the UI without creating provider data, keep the development server running and launch:

```powershell
node tests/fixtures/portrait-preview-server.mjs
```

Open `http://localhost:3105/checkout/preview`. The proxy serves synthetic templates and keeps cart/uploads only in its memory. It forwards app assets and Next.js HMR, but never forwards `/api/` requests. Restarting the fixture clears its data. A synthetic PNG is generated at `.next/portrait-preview-reference.png` for upload checks. Stop this process with Ctrl+C when finished.

Optional arguments are app origin, fixture port, and scenario (`fresh`, `legacy`, `payment`, `empty`). Do not use personal files in synthetic tests.

## Verification record

- PASS: affected focused suite (35 tests), then final transaction/isolation suite (5 tests, including one additional status-race case).
- PASS: TypeScript and changed-file ESLint.
- PASS: final production build; generated preview metadata has status 404.
- PASS: mocked two-portrait browser lifecycle, notes, mapping changes, recovery, removal, shipping estimates and payment isolation.
- PASS: visual review at default desktop width, 1280×900 and 390×844; keyboard trapping, Escape and focus restoration.
- NOT RUN: live provider lifecycle fixtures, real payment, OS-level reduced-motion emulation. Reduced-motion CSS was reviewed.

All browser cart/upload mutations in agent verification were synthetic. The real development page was checked only through catalog/state reads and unsaved template selection.
