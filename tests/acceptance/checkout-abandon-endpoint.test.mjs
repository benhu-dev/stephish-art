import assert from "node:assert/strict";
import test from "node:test";

import { abandonCheckoutIntentHandler } from "../../src/server/storefront/checkoutIntentEndpoints.ts";

const rawToken = "A".repeat(43);
const cookie = `stephish_checkout_intent=v1.41.${rawToken}`;
const endpoint = "https://shop.example/api/storefront/checkout-intents/current/abandon";
const expiredSession = {
  expiresAt: "2026-09-26T20:00:00.000Z",
  expiresAtEpochSeconds: 1_790_451_200,
  id: "cs_test_synthetic",
  status: "expired",
  url: null,
};

const requestFor = ({
  body = "{}",
  contentType = "application/json",
  cookieHeader = cookie,
  origin = "https://shop.example",
  url = endpoint,
} = {}) => {
  const request = new Request(url, {
    body,
    headers: {
      ...(contentType ? { "content-type": contentType } : {}),
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
      ...(origin ? { origin } : {}),
    },
    method: "POST",
  });
  request.payload = { logger: { error() {} } };
  return request;
};

const dependencies = (calls) => ({
  authorizeIntent: async () => ({ status: "checkout_created" }),
  finalizeExpiredIntent: async ({ credential, sessionId }) => {
    calls.push(["finalize", credential, sessionId]);
  },
  gateway: {
    createSession: async () => assert.fail("unexpected create"),
    expireSession: async () => assert.fail("unexpected expire"),
    retrieveSession: async () => assert.fail("unexpected retrieve"),
  },
  resolveSession: async ({ credential }) => {
    calls.push(["resolve", credential]);
    return { created: false, session: expiredSession };
  },
});

test("successful abandonment is no-store, clears the exact protected cookie, and returns 204", async () => {
  const calls = [];
  const response = await abandonCheckoutIntentHandler(requestFor(), dependencies(calls));
  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
  assert.equal(response.headers.get("cache-control"), "no-store");
  const cleared = response.headers.get("set-cookie");
  assert.match(cleared, /^stephish_checkout_intent=;/);
  assert.match(cleared, /Path=\/api\/storefront\/checkout-intents/);
  assert.match(cleared, /HttpOnly/);
  assert.match(cleared, /SameSite=Strict/);
  assert.match(cleared, /Max-Age=0/);
  assert.deepEqual(calls, [
    ["resolve", { intentId: 41, rawToken }],
    ["finalize", { intentId: 41, rawToken }, "cs_test_synthetic"],
  ]);
});

test("abandon rejects missing authority, cross-origin, query, content type, and non-empty bodies before mutation", async () => {
  const cases = [
    [{ cookieHeader: null }, 401],
    [{ origin: "https://attacker.invalid" }, 403],
    [{ url: `${endpoint}?intentId=41` }, 400],
    [{ contentType: "text/plain" }, 415],
    [{ body: JSON.stringify({ intentId: 41 }) }, 400],
    [{ body: "[]" }, 400],
  ];
  for (const [options, expectedStatus] of cases) {
    const calls = [];
    const response = await abandonCheckoutIntentHandler(requestFor(options), dependencies(calls));
    assert.equal(response.status, expectedStatus);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(calls.length, 0);
  }
});

test("unexpected failures are generic and do not clear the cookie", async () => {
  const response = await abandonCheckoutIntentHandler(requestFor(), {
    ...dependencies([]),
    resolveSession: async () => { throw new Error("private Stripe identifier"); },
  });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: { code: "INTERNAL_ERROR" } });
  assert.equal(response.headers.get("set-cookie"), null);
});
