import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  INITIAL_CHECKOUT_LIMITS,
  parseUsdAmount,
} from "../../src/features/checkout/clientCheckoutDraft.ts";
import {
  submitCheckoutAmount,
} from "../../src/features/checkout/checkoutIntentClient.ts";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");
const responseBody = ({ amountCents = 825, minimumAmountCents = 500 } = {}) => ({
  amountCents,
  expiresAt: "2026-09-22T12:00:00.000Z",
  limits: {
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    maxFileBytes: 15 * 1024 * 1024,
    maxFiles: 3,
    maxTotalBytes: 30 * 1024 * 1024,
    minimumAmountCents,
  },
  status: "draft",
  uploads: [],
});
const jsonResponse = (body, status) => Response.json(body, { status });

test("dollar input converts to exact cents without accepting ambiguous formats", () => {
  assert.deepEqual(parseUsdAmount("5"), { cents: 500, error: null });
  assert.deepEqual(parseUsdAmount("8.25"), { cents: 825, error: null });
  assert.deepEqual(parseUsdAmount("12.50"), { cents: 1250, error: null });
  assert.deepEqual(parseUsdAmount("7", 700), { cents: 700, error: null });
  assert.equal(parseUsdAmount("6.99", 700).cents, null);

  for (const value of ["", "-5", "0", "0.00", "1e2", "5,00", "5.001", "+5", ".50"]) {
    assert.equal(parseUsdAmount(value).cents, null, `${value || "empty"} must be rejected`);
  }
});

test("invalid integer cents make zero requests", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse(responseBody(), 201);
  };
  for (const amountCents of [0, -1, 500.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    const result = await submitCheckoutAmount(amountCents, { fetchImpl });
    assert.equal(result.ok, false);
  }
  assert.equal(calls, 0);
});

test("new Intent request has the exact cookie-authenticated no-store contract", async () => {
  const calls = [];
  const fetchImpl = async (...args) => {
    calls.push(args);
    return jsonResponse(responseBody(), 201);
  };
  const result = await submitCheckoutAmount(825, { fetchImpl });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "/api/storefront/checkout-intents");
  assert.deepEqual(calls[0][1], {
    body: JSON.stringify({ amountCents: 825 }),
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  assert.deepEqual(JSON.parse(calls[0][1].body), { amountCents: 825 });
});

test("201 and 200 both return only authoritative amount and limits", async () => {
  for (const status of [201, 200]) {
    const body = responseBody({ amountCents: 900, minimumAmountCents: 700 });
    const result = await submitCheckoutAmount(825, {
      fetchImpl: async () => jsonResponse(body, status),
    });
    assert.deepEqual(result, {
      ok: true,
      value: { amountCents: 900, limits: body.limits },
    });
    assert.equal(/expiresAt|uploads|status|id|token|hash/i.test(JSON.stringify(result)), false);
  }
});

test("malformed success data and private extra fields never become client state", async () => {
  for (const body of [
    { ...responseBody(), intentId: 17 },
    { ...responseBody(), accessToken: "private-token" },
    { ...responseBody(), amountCents: "825" },
    { ...responseBody(), limits: { ...INITIAL_CHECKOUT_LIMITS, extra: true } },
    { ...responseBody(), limits: { ...INITIAL_CHECKOUT_LIMITS, allowedMimeTypes: ["image/svg+xml"] } },
    { ...responseBody(), status: "checkout_created" },
  ]) {
    const result = await submitCheckoutAmount(825, {
      fetchImpl: async () => jsonResponse(body, 201),
    });
    assert.deepEqual(result, {
      message: "We couldn't save your amount right now. Please try again.",
      ok: false,
    });
    assert.equal(/private-token|intentId|accessToken/.test(JSON.stringify(result)), false);
  }
});

test("network, authorization, validation, and server failures stay safe and retryable", async () => {
  const replies = [
    new TypeError("private network detail"),
    jsonResponse({ error: { code: "UNAUTHORIZED" } }, 401),
    jsonResponse({ error: { code: "INVALID_AMOUNT" } }, 400),
    jsonResponse({ error: { code: "AMOUNT_BELOW_MINIMUM" } }, 422),
    jsonResponse({ error: { code: "INTERNAL_ERROR" } }, 503),
    jsonResponse(responseBody(), 200),
  ];
  const fetchImpl = async () => {
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    return reply;
  };
  const results = [];
  for (let index = 0; index < 6; index += 1) {
    results.push(await submitCheckoutAmount(825, { fetchImpl }));
  }
  assert.deepEqual(results.map(({ ok }) => ok), [false, false, false, false, false, true]);
  assert.match(results[0].message, /connection/i);
  assert.match(results[1].message, /browser/i);
  assert.match(results[2].message, /check.*try again/i);
  assert.match(results[3].message, /current minimum/i);
  assert.match(results[4].message, /right now/i);
  assert.equal(results.slice(0, 5).some(({ message }) => /private|UNAUTHORIZED|INVALID_AMOUNT|AMOUNT_BELOW_MINIMUM|INTERNAL_ERROR/.test(message)), false);
});

test("modal wires only Step 1 to the Intent client and keeps later actions local", async () => {
  const [modal, photo, review] = await Promise.all([
    read("src/features/checkout/components/ArtisticCheckoutModal.tsx"),
    read("src/features/checkout/components/CheckoutPhotoStep.tsx"),
    read("src/features/checkout/components/CheckoutReviewStep.tsx"),
  ]);
  assert.match(modal, /submitCheckoutAmount/);
  assert.match(modal, /Saving your amount…/);
  assert.match(modal, /requestControllerRef/);
  assert.doesNotMatch(`${photo}\n${review}`, /fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|\/api\/|stripe/i);
  assert.match(review, /type=["']button["'][^>]*>\s*Continue to Secure Checkout/s);
});
