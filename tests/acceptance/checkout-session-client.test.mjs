import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  requestCheckoutSession,
} from "../../src/features/checkout/checkoutSessionClient.ts";

const validResponse = () => ({
  checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_safe",
  expiresAt: "2026-09-25T20:00:00.000Z",
});
const jsonResponse = (body, status = 200) => Response.json(body, { status });
const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("checkout-session request uses the exact empty same-origin no-store contract", async () => {
  const calls = [];
  const fetchImpl = async (...args) => {
    calls.push(args);
    return jsonResponse(validResponse(), 201);
  };

  const result = await requestCheckoutSession({ fetchImpl });

  assert.deepEqual(result, { kind: "ready", checkoutUrl: validResponse().checkoutUrl });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "/api/storefront/checkout-intents/current/checkout-session");
  assert.deepEqual(calls[0][1], {
    body: JSON.stringify({}),
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  assert.deepEqual(JSON.parse(calls[0][1].body), {});
});

test("only an exact HTTPS Stripe Checkout origin is accepted", async () => {
  const unsafeUrls = [
    "http://checkout.stripe.com/c/pay/cs_test_unsafe",
    "/c/pay/cs_test_relative",
    "https://checkout-stripe.com/c/pay/cs_test_lookalike",
    "https://checkout.stripe.com.attacker.invalid/c/pay/cs_test_subdomain",
    "https://user:password@checkout.stripe.com/c/pay/cs_test_credentials",
    "https://checkout.stripe.com:444/c/pay/cs_test_port",
    "not a URL",
  ];

  for (const checkoutUrl of unsafeUrls) {
    const result = await requestCheckoutSession({
      fetchImpl: async () => jsonResponse({ ...validResponse(), checkoutUrl }),
    });
    assert.deepEqual(result, {
      kind: "failed",
      message: "We couldn't open secure checkout. Please try again.",
    }, checkoutUrl);
  }
});

test("success response is exact, complete, and valid before navigation data is returned", async () => {
  const malformedBodies = [
    { checkoutUrl: validResponse().checkoutUrl },
    { ...validResponse(), expiresAt: "not-a-date" },
    { ...validResponse(), sessionId: "cs_test_private" },
    { ...validResponse(), checkoutUrl: 42 },
    null,
  ];
  for (const body of malformedBodies) {
    const result = await requestCheckoutSession({
      fetchImpl: async () => jsonResponse(body),
    });
    assert.equal(result.kind, "failed");
    assert.equal(JSON.stringify(result).includes("cs_test_private"), false);
  }
  for (const status of [200, 201]) {
    assert.deepEqual(await requestCheckoutSession({
      fetchImpl: async () => jsonResponse(validResponse(), status),
    }), { kind: "ready", checkoutUrl: validResponse().checkoutUrl });
  }
});

test("network, recovery-state, validation, and server outcomes remain safe", async () => {
  const replies = [
    new TypeError("private network detail"),
    jsonResponse({ error: { code: "UNAUTHORIZED" } }, 401),
    jsonResponse({ error: { code: "INVALID_STATE" } }, 409),
    jsonResponse({ error: { code: "MISSING_UPLOAD" } }, 422),
    jsonResponse({ error: { code: "INTERNAL_ERROR" } }, 503),
    jsonResponse(validResponse(), 200),
  ];
  const fetchImpl = async () => {
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    return reply;
  };

  const results = [];
  for (let index = 0; index < 6; index += 1) {
    results.push(await requestCheckoutSession({ fetchImpl }));
  }
  assert.deepEqual(results.map(({ kind }) => kind), [
    "failed", "fresh", "processing", "failed", "failed", "ready",
  ]);
  assert.equal(
    results.slice(0, 5).some((result) =>
      /private|UNAUTHORIZED|INVALID_STATE|MISSING_UPLOAD|INTERNAL_ERROR|checkout\.stripe/i.test(JSON.stringify(result))),
    false,
  );
});

test("abort is distinct from a customer-visible failure and carries no redirect", async () => {
  const controller = new AbortController();
  const pending = requestCheckoutSession({
    fetchImpl: async (_input, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }),
    signal: controller.signal,
  });
  controller.abort();

  assert.deepEqual(await pending, { kind: "aborted" });
});

test("redirect data has one navigation sink and no logging or persistent browser sink", async () => {
  const [client, modal] = await Promise.all([
    read("src/features/checkout/checkoutSessionClient.ts"),
    read("src/features/checkout/components/ArtisticCheckoutModal.tsx"),
  ]);
  const joined = `${client}\n${modal}`;
  assert.equal(modal.match(/window\.location\.assign\(result\.checkoutUrl\)/g)?.length, 1);
  assert.doesNotMatch(joined, /console\.|localStorage|sessionStorage|document\.cookie|sendBeacon|window\.open/);
  assert.doesNotMatch(modal, /location\.(?:href|replace)\s*=|history\.(?:pushState|replaceState)/);
  assert.doesNotMatch(joined, /session[_ -]?id|payment[_ -]?intent|idempotency/i);
});
