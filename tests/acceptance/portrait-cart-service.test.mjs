import assert from "node:assert/strict";
import test from "node:test";

import { addPortraitToCart } from "../../src/server/cart/portraitCartService.ts";
import { StorefrontApiError } from "../../src/server/storefront/storefrontApiError.ts";

const template = {
  available: true,
  description: "City frame",
  id: 8,
  name: "City Blue",
  previewMedia: {
    alt: "Blue city frame",
    height: 800,
    id: 12,
    width: 600,
  },
};

const intent = {
  amountCents: 500,
  checkoutAttemptId: null,
  checkoutStartedAt: null,
  deleteAfter: "2026-10-09T00:00:00.000Z",
  expiresAt: "2026-10-08T00:00:00.000Z",
  id: 17,
  shippingAmountCents: null,
  status: "draft",
  stripeCheckoutSessionExpiresAt: null,
  stripeCheckoutSessionId: null,
  totalAmountCents: null,
};

const transactionHarness = () => {
  const events = [];
  const transaction = { database: {}, id: "tx", request: {}, session: {} };
  return {
    dependencies: {
      begin: async () => {
        events.push("begin");
        return transaction;
      },
      commit: async () => events.push("commit"),
      lock: async () => {
        events.push("lock");
        return structuredClone(intent);
      },
      rollback: async () => events.push("rollback"),
    },
    events,
  };
};

test("adding a portrait transactionally persists server pricing and subtotal", async () => {
  const harness = transactionHarness();
  let created;
  let subtotalUpdate;
  const request = {
    payload: {
      create: async (options) => {
        created = structuredClone(options.data);
        return { id: 91, ...options.data };
      },
      find: async () => ({
        docs: created
          ? [
              {
                ...created,
                id: 91,
                template,
              },
            ]
          : [],
      }),
      findByID: async () => structuredClone(template),
      update: async (options) => {
        subtotalUpdate = {
          collection: options.collection,
          data: structuredClone(options.data),
          id: options.id,
        };
        return options.data;
      },
    },
  };

  const response = await addPortraitToCart({
    credential: { intentId: 17, rawToken: "A".repeat(43) },
    input: {
      artistNote: "Blue scarf",
      subjects: [
        { kind: "person", name: "Steph" },
        { kind: "pet", name: "Mochi" },
      ],
      templateId: 8,
    },
    request,
    transactionDependencies: harness.dependencies,
  });

  assert.deepEqual(harness.events, ["begin", "lock", "commit"]);
  assert.equal(created.amountCents, 2500);
  assert.equal(created.intent, 17);
  assert.equal(created.position, 1);
  assert.equal(created.template, 8);
  assert.match(created.publicId, /^[0-9a-f-]{36}$/);
  assert.equal(created.subjects.length, 2);
  assert.equal(created.subjects[0].position, 1);
  assert.equal(created.subjects[1].position, 2);
  assert.match(created.subjects[0].subjectId, /^[0-9a-f-]{36}$/);
  assert.equal(subtotalUpdate.collection, "checkout-intents");
  assert.equal(subtotalUpdate.id, 17);
  assert.deepEqual(subtotalUpdate.data, { amountCents: 2500 });
  assert.equal(response.subtotalCents, 2500);
  assert.equal(response.portraits[0].amountCents, 2500);
});

test("the sixth portrait fails inside the lock and rolls back", async () => {
  const harness = transactionHarness();
  const request = {
    payload: {
      find: async () => ({
        docs: Array.from({ length: 5 }, (_, index) => ({ id: index + 1 })),
      }),
    },
  };

  await assert.rejects(
    addPortraitToCart({
      credential: { intentId: 17, rawToken: "A".repeat(43) },
      input: {
        artistNote: null,
        subjects: [{ kind: "person", name: "Steph" }],
        templateId: 8,
      },
      request,
      transactionDependencies: harness.dependencies,
    }),
    (error) =>
      error instanceof StorefrontApiError &&
      error.code === "PORTRAIT_COUNT_LIMIT",
  );
  assert.deepEqual(harness.events, ["begin", "lock", "rollback"]);
});

test("non-draft carts reject mutations before any portrait persistence", async () => {
  const harness = transactionHarness();
  harness.dependencies.lock = async () => ({
    ...structuredClone(intent),
    status: "checkout_created",
  });
  let payloadCalls = 0;
  await assert.rejects(
    addPortraitToCart({
      credential: { intentId: 17, rawToken: "A".repeat(43) },
      input: {
        artistNote: null,
        subjects: [{ kind: "person", name: "Steph" }],
        templateId: 8,
      },
      request: {
        payload: {
          find: async () => {
            payloadCalls += 1;
            return { docs: [] };
          },
        },
      },
      transactionDependencies: harness.dependencies,
    }),
    (error) =>
      error instanceof StorefrontApiError && error.code === "INTENT_NOT_DRAFT",
  );
  assert.equal(payloadCalls, 0);
  assert.deepEqual(harness.events, ["begin", "rollback"]);
});
