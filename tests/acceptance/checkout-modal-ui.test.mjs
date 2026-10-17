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

test("portrait modal is keyboard accessible with confirmed references and secure checkout", async () => {
  const [modal, steps, preview] = await Promise.all([
    read("src/features/checkout/components/PortraitCheckoutModal.tsx"),
    read("src/features/checkout/components/PortraitSteps.tsx"),
    read("src/features/checkout/components/PortraitPhotoPreview.tsx"),
  ]);
  assert.match(modal, /role="dialog"/);
  assert.match(modal, /aria-modal="true"/);
  assert.match(modal, /e\.key === "Escape"/);
  assert.match(modal, /e\.key !== "Tab"/);
  assert.match(modal, /document\.body\.style\.overflow/);
  assert.match(modal, /trigger\?\.focus/);
  assert.match(modal, /el\.inert = true/);
  assert.match(modal, /el\.inert = priorInert/);
  assert.match(preview, /URL\.createObjectURL/);
  assert.match(preview, /URL\.revokeObjectURL/);
  assert.match(modal, /startPortraitDraft/);
  assert.match(modal, /requestPortraitPayment/);
  assert.match(modal, /window\.location\.assign\(result\.checkoutUrl\)/);
  assert.match(modal, /active\.current !== controller/);
  assert.match(steps, /disabled=\{!cartReady\(cart\) \|\| !accepted\}/);
  assert.match(steps, /Secure checkout/);
  assert.match(modal, /role="alert"/);
  assert.doesNotMatch(steps, /fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|\/api\/|payload\./i);
});

test("portrait art direction covers focus, themes, reduced motion, and narrow responsive widths", async () => {
  const styles = await read("src/features/checkout/components/portrait-checkout.css");
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /data-theme=["']night["']/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce/);
  assert.match(styles, /max-width:\s*760px/);
  assert.match(styles, /max-width:\s*370px/);
  assert.match(styles, /paper/);
});
