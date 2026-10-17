import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";


const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("portrait recovery offers explicit resume and confirmed start-over without the old purchase UI", async () => {
  const modal = await read("src/features/checkout/components/PortraitCheckoutModal.tsx");
  assert.match(modal, /Resume secure checkout/);
  assert.match(modal, /void pay\(true\)/);
  assert.match(modal, /setStartOver\(true\)/);
  assert.match(modal, /Confirm \{removeTarget \? "removal" : "start over"\}/);
  assert.match(modal, /Keep my draft/);
  assert.match(modal, /purchase flow has been retired/);
  assert.doesNotMatch(modal, /Continue saved legacy draft|window\.confirm|href="\/checkout\/legacy"/);
});

test("portrait modal hydrates recovery and clears draft state only after safe abandonment", async () => {
  const modal = await read("src/features/checkout/components/PortraitCheckoutModal.tsx");
  for (const term of [
    "readPortraitRecovery", "abandonCurrentCheckout", "setCart(null)",
    "setPortraitId(undefined)", "setTemplateId(null)", 'setNote("")',
    'setStep("template")', "setRecovery(null)", "setAccepted(false)",
    "setReloadRequired(true)", "This checkout has expired",
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
