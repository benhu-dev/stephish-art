import assert from "node:assert/strict";
import test from "node:test";

import {
  createPortraitUploadEndpoints,
  portraitUploadEndpoints,
} from "../../src/server/cart/portraitUploadEndpoints.ts";

test("portrait uploads expose only narrow nested routes", () => {
  assert.deepEqual(
    portraitUploadEndpoints.map(({ method, path }) => ({ method, path })),
    [
      {
        method: "post",
        path: "/storefront/checkout-intents/current/cart/portraits/:portraitId/uploads",
      },
      {
        method: "put",
        path: "/storefront/checkout-intents/current/cart/portraits/:portraitId/uploads/:uploadId",
      },
      {
        method: "delete",
        path: "/storefront/checkout-intents/current/cart/portraits/:portraitId/uploads/:uploadId",
      },
      {
        method: "get",
        path: "/storefront/checkout-intents/current/cart/portraits/:portraitId/uploads/:uploadId/preview",
      },
    ],
  );
});

test("every portrait upload route is rate-limited before body, database, or Storage work", async () => {
  const selections = [];
  const downstream = [];
  const endpoints = createPortraitUploadEndpoints(async (input) => {
    selections.push({
      action: input.action,
      credential: Boolean(input.credential),
    });
    return { allowed: false, retryAfterSeconds: 31 };
  });
  const credential = { intentId: 17, rawToken: "A".repeat(43) };
  for (const endpoint of endpoints) {
    const response = await endpoint.handler({
      headers: new Headers({
        cookie: `stephish_checkout_intent=v1.${credential.intentId}.${credential.rawToken}`,
      }),
      payload: {
        db: { beginTransaction: async () => downstream.push("begin") },
        find: async () => downstream.push("find"),
        logger: { error: () => downstream.push("log") },
      },
      url: `https://shop.example/api${endpoint.path}`,
    });
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "31");
  }
  assert.deepEqual(
    selections.map(({ action }) => action),
    ["photoUpload", "photoUpdate", "photoRemove", "photoPreview"],
  );
  assert.equal(selections.every(({ credential }) => credential), true);
  assert.deepEqual(downstream, []);
});
