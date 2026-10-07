import assert from "node:assert/strict";
import test from "node:test";

import {
  STOREFRONT_RATE_LIMIT_POLICY,
  enforceStorefrontRateLimit,
  hashRateLimitSubject,
  resolveTrustedNetworkIdentity,
} from "../../src/server/storefront/storefrontRateLimit.ts";
import { createRateLimitedStorefrontHandler } from "../../src/server/storefront/storefrontRateLimitEndpoint.ts";
import { createStorefrontCheckoutIntentEndpoints } from "../../src/server/storefront/checkoutIntentEndpoints.ts";

const secret = "S".repeat(64);
const credential = { intentId: 17, rawToken: "A".repeat(43) };

test("the centralized fixed-window policy matches every storefront action", () => {
  assert.deepEqual(STOREFRONT_RATE_LIMIT_POLICY, {
    abandon: { limit: 10, requiresCredential: true, windowSeconds: 900 },
    amountSave: { limit: 30, requiresCredential: true, windowSeconds: 900 },
    cartMutate: { limit: 30, requiresCredential: true, windowSeconds: 900 },
    cartRead: { limit: 60, requiresCredential: true, windowSeconds: 900 },
    checkoutSession: { limit: 10, requiresCredential: true, windowSeconds: 900 },
    currentRead: { limit: 60, requiresCredential: false, windowSeconds: 900 },
    intentCreate: { limit: 10, requiresCredential: false, windowSeconds: 900 },
    noteSave: { limit: 30, requiresCredential: true, windowSeconds: 900 },
    photoPreview: { limit: 90, requiresCredential: true, windowSeconds: 900 },
    photoRemove: { limit: 20, requiresCredential: true, windowSeconds: 900 },
    photoUpload: { limit: 12, requiresCredential: true, windowSeconds: 900 },
    statusPoll: { limit: 90, requiresCredential: true, windowSeconds: 300 },
  });
});

test("HMAC subjects are stable, irreversible-looking, and domain-separated", () => {
  const first = hashRateLimitSubject({
    action: "photoUpload",
    kind: "network",
    secret,
    subject: "203.0.113.8",
  });
  assert.equal(first, hashRateLimitSubject({
    action: "photoUpload",
    kind: "network",
    secret,
    subject: "203.0.113.8",
  }));
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, hashRateLimitSubject({
    action: "photoRemove",
    kind: "network",
    secret,
    subject: "203.0.113.8",
  }));
  assert.notEqual(first, hashRateLimitSubject({
    action: "photoUpload",
    kind: "credential",
    secret,
    subject: "203.0.113.8",
  }));
  assert.equal(first.includes("203.0.113.8"), false);
});

test("production accepts only the Vercel-owned identity header and otherwise fails closed", () => {
  const production = { nodeEnv: "production", vercel: "1" };
  assert.equal(resolveTrustedNetworkIdentity(new Request("https://shop.example", {
    headers: {
      "x-forwarded-for": "198.51.100.9",
      "x-real-ip": "198.51.100.10",
      "x-vercel-forwarded-for": "203.0.113.8",
    },
  }), production), "203.0.113.8");
  for (const fixture of [
    new Request("https://shop.example", { headers: { "x-forwarded-for": "203.0.113.8" } }),
    new Request("https://shop.example", { headers: { "x-vercel-forwarded-for": "not-an-ip" } }),
    new Request("https://shop.example", { headers: { "x-vercel-forwarded-for": "203.0.113.8, 198.51.100.1" } }),
  ]) {
    assert.throws(() => resolveTrustedNetworkIdentity(fixture, production), /RATE_LIMIT_IDENTITY_UNAVAILABLE/);
  }
  assert.throws(() => resolveTrustedNetworkIdentity(
    new Request("https://shop.example", { headers: { "x-vercel-forwarded-for": "203.0.113.8" } }),
    { nodeEnv: "production", vercel: undefined },
  ), /RATE_LIMIT_IDENTITY_UNAVAILABLE/);
  assert.equal(resolveTrustedNetworkIdentity(
    new Request("http://localhost", { headers: { "x-vercel-forwarded-for": "203.0.113.8" } }),
    { nodeEnv: "development", vercel: undefined },
  ), "loopback");
});

test("credential actions consume network then separately domain-separated credential buckets", async () => {
  const calls = [];
  const result = await enforceStorefrontRateLimit({
    action: "photoUpload",
    credential,
    dependencies: {
      consume: async (input) => {
        calls.push(input);
        return { allowed: true, retryAfterSeconds: 1 };
      },
      networkIdentity: () => "203.0.113.8",
      secret: () => secret,
    },
    request: new Request("https://shop.example"),
  });
  assert.deepEqual(result, { allowed: true, retryAfterSeconds: 1 });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(({ scope }) => scope), [
    "photoUpload:network",
    "photoUpload:credential",
  ]);
  assert.notEqual(calls[0].subjectHash, calls[1].subjectHash);
  assert.equal(JSON.stringify(calls).includes(credential.rawToken), false);
  assert.equal(JSON.stringify(calls).includes("203.0.113.8"), false);
});

test("a network denial short-circuits the credential bucket", async () => {
  let calls = 0;
  const result = await enforceStorefrontRateLimit({
    action: "checkoutSession",
    credential,
    dependencies: {
      consume: async () => {
        calls += 1;
        return { allowed: false, retryAfterSeconds: 37 };
      },
      networkIdentity: () => "203.0.113.8",
      secret: () => secret,
    },
    request: new Request("https://shop.example"),
  });
  assert.deepEqual(result, { allowed: false, retryAfterSeconds: 37 });
  assert.equal(calls, 1);
});

test("an allowed decision preserves the exact downstream response", async () => {
  const expected = Response.json({ unchanged: true }, {
    headers: { "X-Existing": "preserved" },
    status: 207,
  });
  let calls = 0;
  const handler = createRateLimitedStorefrontHandler({
    action: () => ({ action: "currentRead" }),
    enforce: async () => ({ allowed: true, retryAfterSeconds: 1 }),
    handler: async () => {
      calls += 1;
      return expected;
    },
  });
  const response = await handler(requestFixture().request);
  assert.equal(response, expected);
  assert.equal(response.status, 207);
  assert.equal(response.headers.get("x-existing"), "preserved");
  assert.equal(calls, 1);
});

const requestFixture = () => {
  const logs = [];
  return {
    logs,
    request: {
      headers: new Headers(),
      payload: { logger: { error: (value) => logs.push(value) } },
      url: "https://shop.example/api/storefront/checkout-intents/current/uploads",
    },
  };
};

test("denial is generic 429 with bounded Retry-After and no downstream call", async () => {
  const fixture = requestFixture();
  let downstreamCalls = 0;
  const handler = createRateLimitedStorefrontHandler({
    action: () => ({ action: "photoUpload", credential }),
    enforce: async () => ({ allowed: false, retryAfterSeconds: 41 }),
    handler: async () => {
      downstreamCalls += 1;
      return new Response(null, { status: 201 });
    },
  });
  const response = await handler(fixture.request);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("retry-after"), "41");
  assert.deepEqual(await response.json(), { error: { code: "RATE_LIMITED" } });
  assert.equal(downstreamCalls, 0);
  assert.deepEqual(fixture.logs, []);
});

test("limiter failure is generic 503, logs only a safe classification, and does no work", async () => {
  const fixture = requestFixture();
  let downstreamCalls = 0;
  const handler = createRateLimitedStorefrontHandler({
    action: () => ({ action: "photoUpload", credential }),
    enforce: async () => { throw new Error("203.0.113.8 private-token request-body"); },
    handler: async () => {
      downstreamCalls += 1;
      return new Response(null, { status: 201 });
    },
  });
  const response = await handler(fixture.request);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.has("retry-after"), false);
  assert.deepEqual(await response.json(), { error: { code: "SERVICE_UNAVAILABLE" } });
  assert.equal(downstreamCalls, 0);
  assert.deepEqual(fixture.logs, [{
    classification: "rate_limit_unavailable",
    msg: "Storefront rate limit unavailable.",
  }]);
  assert.equal(JSON.stringify(fixture.logs).includes("203.0.113.8"), false);
});

test("every storefront endpoint is gated before validation, persistence, Storage, or Stripe work", async () => {
  const selections = [];
  const downstream = [];
  const endpoints = createStorefrontCheckoutIntentEndpoints(async (input) => {
    selections.push({ action: input.action, credential: Boolean(input.credential) });
    return { allowed: false, retryAfterSeconds: 29 };
  });
  const byPath = (path) => endpoints.find((endpoint) => endpoint.path === path).handler;
  const request = (includeCookie = true) => ({
    headers: new Headers(includeCookie ? {
      cookie: `stephish_checkout_intent=v1.${credential.intentId}.${credential.rawToken}`,
    } : {}),
    payload: {
      create: async () => downstream.push("create"),
      db: { pool: { query: async () => downstream.push("query") } },
      delete: async () => downstream.push("delete"),
      find: async () => downstream.push("find"),
      findByID: async () => downstream.push("findByID"),
      logger: { error: () => downstream.push("log") },
      update: async () => downstream.push("update"),
    },
    url: "https://shop.example/api/storefront/checkout-intents",
  });
  const cases = [
    ["/storefront/checkout-intents", false, "intentCreate", false],
    ["/storefront/checkout-intents", true, "amountSave", true],
    ["/storefront/checkout-intents/current", true, "currentRead", false],
    ["/storefront/checkout-intents/current/recovery", true, "currentRead", false],
    ["/storefront/checkout-intents/current/artist-note", true, "noteSave", true],
    ["/storefront/checkout-intents/current/status", true, "statusPoll", true],
    ["/storefront/checkout-intents/current/uploads", true, "photoUpload", true],
    ["/storefront/checkout-intents/current/uploads/:uploadId", true, "photoRemove", true],
    ["/storefront/checkout-intents/current/uploads/:uploadId/preview", true, "photoPreview", true],
    ["/storefront/checkout-intents/current/checkout-session", true, "checkoutSession", true],
    ["/storefront/checkout-intents/current/abandon", true, "abandon", true],
  ];
  for (const [path, includeCookie, action, hasCredential] of cases) {
    const response = await byPath(path)(request(includeCookie));
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "29");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(selections.at(-1), { action, credential: hasCredential });
  }
  assert.deepEqual(downstream, []);
});
