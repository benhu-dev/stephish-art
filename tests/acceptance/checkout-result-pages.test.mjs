import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("success page is noindex, scrubs legacy queries, and exposes every safe state", async () => {
  const [page, client] = await Promise.all([
    read("src/app/(frontend)/checkout/success/page.tsx"),
    read("src/features/checkout/components/CheckoutSuccessStatus.tsx"),
  ]);
  assert.match(page, /robots:\s*\{[^}]*index:\s*false/s);
  assert.match(page, /referrer:\s*["']no-referrer["']/);
  for (const text of [
    "Confirming your payment…",
    "Your postcard order is confirmed.",
    "confirmation may take a moment",
    "no confirmed Order was found",
    "cannot be accessed from this browser",
  ]) {
    assert.equal(client.includes(text), true);
  }
  assert.match(client, /aria-live=["']polite["']/);
  assert.match(client, /history\.replaceState\([^;]*window\.location\.pathname/);
  assert.equal(/session_id|checkout_session_id|payment_intent/i.test(client), false);
  assert.equal(/stripe|webhook/i.test(client), false);
});

test("cancel page retries only through the controlled endpoint with exactly an empty object", async () => {
  const [page, client, sessionClient] = await Promise.all([
    read("src/app/(frontend)/checkout/cancelled/page.tsx"),
    read("src/features/checkout/components/CheckoutCancelledActions.tsx"),
    read("src/features/checkout/checkoutSessionClient.ts"),
  ]);
  assert.match(page, /Payment not completed/);
  assert.match(page, /No Order was created by visiting this page\./);
  assert.match(page, /robots:\s*\{[^}]*index:\s*false/s);
  assert.match(page, /referrer:\s*["']no-referrer["']/);
  assert.match(client, /requestCheckoutSession/);
  assert.match(sessionClient, /checkout-intents\/current\/checkout-session/);
  assert.match(sessionClient, /JSON\.stringify\(\{\}\)/);
  assert.match(client, /checkoutUrl/);
  assert.match(client, /Return Home/);
  assert.match(client, /Resume Secure Checkout/);
  assert.match(client, /Start a New Order/);
  assert.equal(/session_id|order_id|payment_intent/i.test(client), false);
  assert.equal(/stripe|webhook/i.test(client), false);
});

test("result layout has responsive, focus, reduced-motion, and overflow protections", async () => {
  const [layout, styles] = await Promise.all([
    read("src/features/checkout/components/CheckoutResultLayout.tsx"),
    read("src/features/checkout/components/checkout-result.module.css"),
  ]);
  assert.match(layout, /<main/);
  assert.match(layout, /<h1/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce/);
  assert.match(styles, /orientation:\s*landscape/);
  assert.match(styles, /max-width:/);
  assert.match(styles, /overflow/);
});

test("result pages and clients contain no payment or Order mutation path", async () => {
  const sources = await Promise.all([
    read("src/app/(frontend)/checkout/success/page.tsx"),
    read("src/app/(frontend)/checkout/cancelled/page.tsx"),
    read("src/features/checkout/components/CheckoutSuccessStatus.tsx"),
    read("src/features/checkout/components/CheckoutCancelledActions.tsx"),
  ]);
  const joined = sources.join("\n");
  assert.equal(/payload\.(create|update|delete)|fulfillPaid|processStripe/i.test(joined), false);
  assert.equal(/\/api\/webhooks\/stripe/.test(joined), false);
});
