import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  MAX_PHOTO_BYTES,
  MAX_TOTAL_PHOTO_BYTES,
  SHIPPING_AMOUNT_CENTS,
  formatUsd,
  parseUsdAmount,
  validatePhotoSelection,
} from "../../src/features/checkout/clientCheckoutDraft.ts";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("amount entry is converted to integer cents and enforces the five-dollar minimum", () => {
  assert.deepEqual(parseUsdAmount("5"), { cents: 500, error: null });
  assert.deepEqual(parseUsdAmount("20.25"), { cents: 2025, error: null });
  assert.equal(parseUsdAmount("4.99").cents, null);
  assert.equal(parseUsdAmount("5.001").cents, null);
  assert.equal(parseUsdAmount("Infinity").cents, null);
  assert.equal(parseUsdAmount("").cents, null);
  assert.equal(formatUsd(500 + SHIPPING_AMOUNT_CENTS), "$6.00");
});

test("local photo rules accept only one to three bounded raster previews", () => {
  const jpeg = { name: "private-name.jpg", size: 1_000, type: "image/jpeg" };
  assert.deepEqual(validatePhotoSelection([], [jpeg]), { error: null });
  assert.match(validatePhotoSelection([], [{ ...jpeg, type: "image/gif" }]).error, /JPEG, PNG, or WebP/);
  assert.match(validatePhotoSelection([], [{ ...jpeg, size: MAX_PHOTO_BYTES + 1 }]).error, /15 MiB/);
  assert.match(validatePhotoSelection([jpeg, jpeg, jpeg], [jpeg]).error, /up to 3/);
  assert.match(
    validatePhotoSelection(
      [{ ...jpeg, size: MAX_TOTAL_PHOTO_BYTES - 500 }],
      [{ ...jpeg, size: 501 }],
    ).error,
    /30 MiB/,
  );
});

test("modal is keyboard accessible while photos, review, and final action remain local", async () => {
  const [modal, amount, photo, review] = await Promise.all([
    read("src/features/checkout/components/ArtisticCheckoutModal.tsx"),
    read("src/features/checkout/components/CheckoutAmountStep.tsx"),
    read("src/features/checkout/components/CheckoutPhotoStep.tsx"),
    read("src/features/checkout/components/CheckoutReviewStep.tsx"),
  ]);
  const joined = [modal, amount, photo, review].join("\n");
  for (const text of [
    "Choose your amount",
    "Add your photos",
    "Ready for the press?",
    "Continue to Secure Checkout",
  ]) assert.equal(joined.includes(text), true, `missing ${text}`);
  assert.match(joined, /role=["']dialog["']/);
  assert.match(joined, /aria-modal=["']true["']/);
  assert.match(joined, /event\.key === ["']Escape["']/);
  assert.match(joined, /event\.key === ["']Tab["']/);
  assert.match(joined, /document\.body\.style\.overflow/);
  assert.match(joined, /trigger\?\.focus/);
  assert.match(joined, /URL\.createObjectURL/);
  assert.match(joined, /URL\.revokeObjectURL/);
  assert.match(modal, /submitCheckoutAmount/);
  assert.match(joined, /type=["']button["'][^>]*>\s*Continue to Secure Checkout/s);
  assert.equal(/fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|\/api\/|payload\.|stripe/i.test(`${photo}\n${review}`), false);
});

test("art direction covers focus, themes, reduced motion, and both mobile orientations", async () => {
  const styles = await read("src/features/checkout/components/checkout-modal.css");
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /data-theme=["']night["']/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce/);
  assert.match(styles, /orientation:\s*landscape/);
  assert.match(styles, /max-width:\s*600px/);
  assert.match(styles, /paper/);
});
