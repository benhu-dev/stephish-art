import assert from "node:assert/strict";
import test from "node:test";

import {
  checkoutRecoveryHandler,
  createStorefrontCheckoutIntentEndpoints,
} from "../../src/server/storefront/checkoutIntentEndpoints.ts";
import { StorefrontApiError } from "../../src/server/storefront/storefrontApiError.ts";

const rawToken = "A".repeat(43);
const cookie = `stephish_checkout_intent=v1.41.${rawToken}`;
const endpoint =
  "https://shop.example/api/storefront/checkout-intents/current/recovery";
const safeState = {
  amountCents: 900,
  artistNote: "",
  expiresAt: "2026-09-28T20:00:00.000Z",
  limits: {
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    maxFileBytes: 15 * 1024 * 1024,
    maxFiles: 3,
    maxTotalBytes: 30 * 1024 * 1024,
    minimumAmountCents: 500,
  },
  shippingAmountCents: 100,
  status: "checkout_created",
  totalAmountCents: 1000,
  uploads: [],
};

const requestFor = ({ cookieHeader = cookie, url = endpoint } = {}) => ({
  headers: new Headers(cookieHeader ? { cookie: cookieHeader } : {}),
  payload: {
    logger: { error() {} },
  },
  url,
});

const intent = (status, stripeCheckoutSessionId = null) => ({
  expiresAt: "2026-09-28T20:00:00.000Z",
  id: 41,
  status,
  stripeCheckoutSessionId,
});

const dependencies = ({
  authorizeIntent = async () => intent("checkout_created", "cs_test_safe"),
  readSafeState = async () => safeState,
  retrieveSession = async () => ({
    id: "cs_test_safe",
    status: "open",
    url: "https://checkout.stripe.com/c/pay/cs_test_safe",
  }),
} = {}) => ({
  authorizeIntent,
  gateway: { retrieveSession },
  readSafeState,
});

test("optional recovery returns an empty no-store 204 without a cookie", async () => {
  const response = await checkoutRecoveryHandler(
    requestFor({ cookieHeader: null }),
    dependencies({
      authorizeIntent: async () => assert.fail("unexpected authorization"),
    }),
  );
  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.has("set-cookie"), false);
});

test("malformed, unknown, expired, completed, abandoned, and pending recovery is the same 204", async () => {
  const fixtures = [
    {
      cookieHeader: "stephish_checkout_intent=malformed",
      dependencies: dependencies(),
    },
    {
      dependencies: dependencies({
        authorizeIntent: async () => {
          throw new StorefrontApiError(401, "UNAUTHORIZED");
        },
      }),
    },
    { dependencies: dependencies({ authorizeIntent: async () => intent("expired") }) },
    { dependencies: dependencies({ authorizeIntent: async () => intent("completed") }) },
    { dependencies: dependencies({ authorizeIntent: async () => intent("abandoned") }) },
    {
      dependencies: dependencies({
        authorizeIntent: async () => intent("checkout_pending"),
      }),
    },
  ];

  for (const fixture of fixtures) {
    const response = await checkoutRecoveryHandler(
      requestFor({ cookieHeader: fixture.cookieHeader ?? cookie }),
      fixture.dependencies,
    );
    assert.equal(response.status, 204);
    assert.equal(await response.text(), "");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
  }
});

test("a reusable Session returns only the unchanged safe recovery response", async () => {
  const response = await checkoutRecoveryHandler(requestFor(), dependencies());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), safeState);
  assert.equal(
    /intentId|cs_test|token|storage|email/i.test(JSON.stringify(safeState)),
    false,
  );
});

test("non-open Sessions are empty and dependency failures remain generic 5xx", async () => {
  for (const status of ["complete", "expired"]) {
    const response = await checkoutRecoveryHandler(
      requestFor(),
      dependencies({ retrieveSession: async () => ({ status }) }),
    );
    assert.equal(response.status, 204);
    assert.equal(await response.text(), "");
  }

  const unavailable = await checkoutRecoveryHandler(
    requestFor(),
    dependencies({
      retrieveSession: async () => {
        throw new Error("private Stripe detail");
      },
    }),
  );
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), {
    error: { code: "CHECKOUT_UNAVAILABLE" },
  });

  const failed = await checkoutRecoveryHandler(
    requestFor(),
    dependencies({
      authorizeIntent: async () => intent("draft"),
      readSafeState: async () => {
        throw new Error("private database detail");
      },
    }),
  );
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), { error: { code: "INTERNAL_ERROR" } });
});

test("the optional route accepts no identifiers and protected current stays strict", async () => {
  const queryResponse = await checkoutRecoveryHandler(
    requestFor({ url: `${endpoint}?intentId=41&session_id=cs_test_forged` }),
    dependencies(),
  );
  assert.equal(queryResponse.status, 400);

  const current = createStorefrontCheckoutIntentEndpoints(
    async () => ({ allowed: true, retryAfterSeconds: 1 }),
  ).find(
    ({ method, path }) =>
      method === "get" && path === "/storefront/checkout-intents/current",
  );
  assert.ok(current);
  const strictResponse = await current.handler(requestFor({ cookieHeader: null }));
  assert.equal(strictResponse.status, 401);
  assert.deepEqual(await strictResponse.json(), {
    error: { code: "UNAUTHORIZED" },
  });
});
