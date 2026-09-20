import assert from "node:assert/strict";
import test from "node:test";

import { hashCheckoutIntentToken } from "../../src/server/checkout-intents/checkoutIntentCredentials.ts";
import { checkoutStatusHandler } from "../../src/server/storefront/checkoutIntentEndpoints.ts";

const intentId = 29;
const rawToken = "A".repeat(43);
const alternateToken = "B".repeat(43);
const cookie = `stephish_checkout_intent=v1.${intentId}.${rawToken}`;
const future = new Date(Date.now() + 60_000).toISOString();
const past = new Date(Date.now() - 60_000).toISOString();

const intent = (status, overrides = {}) => ({
  accessTokenHash: hashCheckoutIntentToken(rawToken),
  amountCents: 800,
  deleteAfter: future,
  expiresAt: future,
  id: intentId,
  shippingAmountCents: 100,
  status,
  totalAmountCents: 900,
  ...overrides,
});

const requestFor = ({
  cookieHeader = cookie,
  document = intent("draft"),
  orders = [],
  url = "http://127.0.0.1/api/storefront/checkout-intents/current/status",
} = {}) => {
  const calls = { find: [], findByID: [], mutations: [] };
  const request = {
    headers: new Headers({
      ...(cookieHeader === null ? {} : { cookie: cookieHeader }),
      "x-order-id": "999999",
      "x-stripe-session-id": "cs_test_has_no_authority",
    }),
    payload: {
      create: async () => calls.mutations.push("create"),
      delete: async () => calls.mutations.push("delete"),
      find: async (options) => {
        calls.find.push(options);
        return { docs: orders };
      },
      findByID: async (options) => {
        calls.findByID.push(options);
        if (document instanceof Error) throw document;
        return document;
      },
      logger: { error() {} },
      update: async () => calls.mutations.push("update"),
    },
    url,
  };
  return { calls, request };
};

const read = async (options) => {
  const fixture = requestFor(options);
  const response = await checkoutStatusHandler(fixture.request);
  const body = await response.json();
  return { ...fixture, body, response };
};

test("status responses are exact, no-store, and map every Intent state", async () => {
  for (const [persisted, expected] of [
    ["draft", "not_started"],
    ["checkout_pending", "processing"],
    ["checkout_created", "processing"],
    ["expired", "expired"],
  ]) {
    const result = await read({ document: intent(persisted) });
    assert.equal(result.response.status, 200);
    assert.equal(result.response.headers.get("cache-control"), "no-store");
    assert.deepEqual(result.body, { state: expected });
    assert.equal(result.calls.find.length, 0);
  }
});

test("confirmed status requires the linked Order and returns only safe snapshots", async () => {
  const result = await read({
    document: intent("completed"),
    orders: [
      {
        amountCents: 900,
        checkoutIntent: intentId,
        currency: "usd",
        id: 71,
      },
    ],
    url:
      "http://127.0.0.1/api/storefront/checkout-intents/current/status" +
      "?session_id=cs_test_fake&order_id=999",
  });

  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body, {
    currency: "usd",
    shippingAmountCents: 100,
    state: "confirmed",
    subtotalAmountCents: 800,
    totalAmountCents: 900,
  });
  assert.equal(result.calls.find.length, 1);
  assert.equal(result.calls.find[0].collection, "orders");
  assert.deepEqual(result.calls.find[0].where, {
    checkoutIntent: { equals: intentId },
  });
  assert.deepEqual(Object.keys(result.calls.find[0].select).sort(), [
    "amountCents",
    "checkoutIntent",
    "currency",
  ]);
  assert.equal(result.calls.mutations.length, 0);

  const serialized = JSON.stringify(result.body);
  for (const forbidden of [
    "id",
    "stripe",
    "email",
    "address",
    "upload",
    "filename",
    "token",
    "hash",
    "createdAt",
    "updatedAt",
  ]) {
    assert.equal(serialized.toLowerCase().includes(forbidden.toLowerCase()), false);
  }
});

test("a completed Intent without its expected Order is never confirmed", async () => {
  const missing = await read({ document: intent("completed"), orders: [] });
  assert.equal(missing.response.status, 503);
  assert.deepEqual(missing.body, { error: { code: "STATUS_UNAVAILABLE" } });
  assert.equal(JSON.stringify(missing.body).includes("confirmed"), false);

  const mismatched = await read({
    document: intent("completed"),
    orders: [
      {
        amountCents: 800,
        checkoutIntent: intentId,
        currency: "usd",
        id: 72,
      },
    ],
  });
  assert.equal(mismatched.response.status, 503);
  assert.equal(JSON.stringify(mismatched.body).includes("confirmed"), false);
});

test("missing, malformed, unknown, incorrect, expired, and cross-Intent cookies share generic denial", async () => {
  const cases = [
    { cookieHeader: null },
    { cookieHeader: "stephish_checkout_intent=malformed" },
    { document: new Error("unknown") },
    {
      cookieHeader: `stephish_checkout_intent=v1.${intentId}.${alternateToken}`,
    },
    { document: intent("draft", { expiresAt: past }) },
    {
      cookieHeader: `stephish_checkout_intent=v1.${intentId + 1}.${rawToken}`,
      document: intent("draft", {
        accessTokenHash: hashCheckoutIntentToken(alternateToken),
        id: intentId + 1,
      }),
    },
  ];

  for (const options of cases) {
    const result = await read(options);
    assert.equal(result.response.status, 401);
    assert.equal(result.response.headers.get("cache-control"), "no-store");
    assert.deepEqual(result.body, { error: { code: "UNAUTHORIZED" } });
    assert.equal(result.calls.find.length, 0);
    assert.equal(result.calls.mutations.length, 0);
  }
});

test("fake URL and header identifiers provide no authority and no Stripe or write path is called", async () => {
  const result = await read({
    document: intent("checkout_created"),
    url:
      "http://127.0.0.1/api/storefront/checkout-intents/current/status" +
      "?session_id=cs_test_forged&intentId=1&email=private%40example.invalid",
  });
  assert.deepEqual(result.body, { state: "processing" });
  assert.equal(result.calls.mutations.length, 0);
  assert.equal(result.calls.findByID.length, 1);
  assert.equal(result.calls.findByID[0].id, intentId);
});
