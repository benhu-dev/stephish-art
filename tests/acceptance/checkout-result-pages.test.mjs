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
    "Confirming your order…",
    "Your postcard order is confirmed.",
    "Your payment was submitted",
    "This is taking a little longer than usual.",
    "We’re still confirming your order.",
    "Check Again",
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

test("success transition is interruptible, immediate, decorative, and CSS-only", async () => {
  const [client, presentation, styles] = await Promise.all([
    read("src/features/checkout/components/CheckoutSuccessStatus.tsx"),
    read("src/features/checkout/checkoutResultPresentation.ts"),
    read("src/features/checkout/components/checkout-result.module.css"),
  ]);

  assert.match(presentation, /CHECKOUT_LOADER_DELAY_MS\s*=\s*150/);
  assert.match(presentation, /CHECKOUT_SLOW_MESSAGE_DELAY_MS\s*=\s*12_000/);
  assert.match(client, /aria-hidden=["']true["']/);
  assert.match(client, /CONFIRMED/);
  assert.match(client, /setState\(nextState\)/);
  assert.equal(/await[^;]*(?:confirmed|setState)|setTimeout[^;]*(?:confirmed|setState)/s.test(client), false);
  assert.match(client, /<svg[\s\S]*?<circle[\s\S]*?pathLength=["']100["']/);
  assert.match(client, /className=\{styles\.headingEllipsis\}[\s\S]*?<span>\.<\/span>[\s\S]*?<span>\.<\/span>[\s\S]*?<span>\.<\/span>/);
  assert.match(client, /aria-label=["']Confirming your order…["']/);
  assert.match(styles, /stroke-dasharray:\s*100/);
  assert.match(styles, /stroke-dashoffset:\s*100/);
  assert.match(styles, /transform:\s*rotate\(-90deg\)/);
  assert.match(styles, /animation:\s*processing-ring-draw\s+950ms\s+linear\s+infinite/);
  assert.match(styles, /74%\s*\{[^}]*stroke-dashoffset:\s*0[^}]*\}/s);
  assert.match(styles, /86%\s*\{[^}]*stroke-dashoffset:\s*0[^}]*\}/s);
  assert.match(styles, /100%\s*\{[^}]*opacity:\s*0[^}]*stroke-dashoffset:\s*100[^}]*\}/s);
  assert.match(styles, /\.headingEllipsis\s*\{[^}]*width:/s);
  assert.match(styles, /\.headingEllipsis span[^}]*animation:\s*ellipsis-dot/s);
  assert.match(styles, /animation:\s*confirmed-stamp-in\s+420ms/);
  assert.match(styles, /animation:\s*confirmed-content-in\s+420ms/);
  assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.postmarkRingStroke[\s\S]*stroke-dashoffset:\s*0/s);
  assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.headingEllipsis span[\s\S]*animation:\s*none/s);
});

test("timeout retry is a fresh read-only cycle with both safe actions", async () => {
  const client = await read("src/features/checkout/components/CheckoutSuccessStatus.tsx");
  assert.match(client, />\s*Check Again\s*</);
  assert.match(client, />\s*Return Home\s*</);
  assert.match(client, /setPollingCycle\(\(current\) => current \+ 1\)/);
  assert.match(client, /fetch\(statusEndpoint/);
  assert.equal(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/.test(client), false);
  assert.equal(/window\.location\.reload/.test(client), false);
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
  assert.match(styles, /max-width:\s*390px/);
  assert.match(styles, /max-height:\s*31rem/);
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
