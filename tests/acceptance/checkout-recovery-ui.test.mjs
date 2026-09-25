import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CheckoutRecoveryStep } from "../../src/features/checkout/components/CheckoutRecoveryStep.tsx";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("recovery offers explicit resume and inline-confirmed start-over actions", () => {
  const initial = renderToStaticMarkup(createElement(CheckoutRecoveryStep, {
    confirmStartOver: false,
    error: null,
    onCancelStartOver() {},
    onConfirmStartOver() {},
    onResume() {},
    onStartOver() {},
    pending: null,
  }));
  assert.match(initial, /Your checkout is ready/);
  assert.match(initial, /Resume Secure Checkout/);
  assert.match(initial, /Start a New Order/);
  assert.doesNotMatch(initial, /Starting over will close this payment session/);

  const confirming = renderToStaticMarkup(createElement(CheckoutRecoveryStep, {
    confirmStartOver: true,
    error: null,
    onCancelStartOver() {},
    onConfirmStartOver() {},
    onResume() {},
    onStartOver() {},
    pending: null,
  }));
  assert.match(confirming, /Starting over will close this payment session\. Your current uploads and note will no longer be available\./);
  assert.match(confirming, /Confirm Start Over/);
  assert.doesNotMatch(confirming, /window\.confirm/);
});

test("modal hydrates and reconciles recovery, then resets every draft state after abandonment", async () => {
  const modal = await read("src/features/checkout/components/ArtisticCheckoutModal.tsx");
  for (const term of [
    "readCurrentCheckoutState",
    "result.reason === \"conflict\"",
    "CheckoutRecoveryStep",
    "abandonCurrentCheckout",
    "URL.revokeObjectURL",
    "setAmountCents(null)",
    "setPhotos([])",
    "setNote(\"\")",
    "setConfirmedNote(\"\")",
    "setStep(1)",
  ]) assert.equal(modal.includes(term), true, `missing ${term}`);
  assert.doesNotMatch(modal, /window\.confirm|location\.(?:href|replace)\s*=/);
});

test("cancelled page preserves navigation-only Return Home and all recovery actions", async () => {
  const [page, actions] = await Promise.all([
    read("src/app/(frontend)/checkout/cancelled/page.tsx"),
    read("src/features/checkout/components/CheckoutCancelledActions.tsx"),
  ]);
  assert.match(page, /Payment not completed/);
  assert.match(actions, /Resume Secure Checkout/);
  assert.match(actions, /Start a New Order/);
  assert.match(actions, /Return Home/);
  assert.match(actions, /href=["']\/["']/);
  assert.match(actions, /abandonCurrentCheckout/);
  assert.doesNotMatch(actions, /onClick=[^>]*(?:Return Home|abandon)/);
});
