import assert from "node:assert/strict";
import test from "node:test";

import {
  createPortraitCartEndpoints,
  portraitCartEndpoints,
} from "../../src/server/cart/portraitCartEndpoints.ts";
import { buildSafePortraitCartResponse } from "../../src/server/cart/portraitCartService.ts";

test("portrait cart endpoints expose only the intended cookie-authorized routes", () => {
  assert.deepEqual(
    portraitCartEndpoints.map(({ method, path }) => ({ method, path })),
    [
      {
        method: "get",
        path: "/storefront/checkout-intents/current/cart",
      },
      {
        method: "post",
        path: "/storefront/checkout-intents/current/cart/portraits",
      },
      {
        method: "put",
        path: "/storefront/checkout-intents/current/cart/portraits/:portraitId",
      },
      {
        method: "delete",
        path: "/storefront/checkout-intents/current/cart/portraits/:portraitId",
      },
      {
        method: "put",
        path: "/storefront/checkout-intents/current/cart/order",
      },
    ],
  );
});

test("every portrait cart route is rate-limited before cart work", async () => {
  const selections = [];
  const downstream = [];
  const endpoints = createPortraitCartEndpoints(async (input) => {
    selections.push({
      action: input.action,
      credential: Boolean(input.credential),
    });
    return { allowed: false, retryAfterSeconds: 23 };
  });
  const credential = { intentId: 17, rawToken: "A".repeat(43) };
  for (const endpoint of endpoints) {
    const response = await endpoint.handler({
      headers: new Headers({
        cookie: `stephish_checkout_intent=v1.${credential.intentId}.${credential.rawToken}`,
      }),
      payload: {
        find: async () => downstream.push("find"),
        logger: { error: () => downstream.push("log") },
        update: async () => downstream.push("update"),
      },
      url: `https://shop.example/api${endpoint.path}`,
    });
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "23");
  }
  assert.deepEqual(
    selections.map(({ action }) => action),
    ["cartRead", "cartMutate", "cartMutate", "cartMutate", "cartMutate"],
  );
  assert.equal(selections.every(({ credential }) => credential), true);
  assert.deepEqual(downstream, []);
});

test("safe cart responses expose presentation data without persistence details", () => {
  const response = buildSafePortraitCartResponse({
    intentAmountCents: 2500,
    portraits: [
      {
        accessTokenHash: "secret",
        amountCents: 2500,
        artistNote: "Blue scarf",
        checkoutIntent: 17,
        createdAt: "private timestamp",
        id: 91,
        position: 1,
        publicId: "a9f42c44-5a8b-4c2d-9431-66bd108cf261",
        subjects: [
          {
            id: "internal-array-row",
            kind: "person",
            name: "Steph",
            position: 1,
            subjectId: "26613a1d-6cc0-4778-9508-a6cb60af9a32",
          },
          {
            id: "internal-array-row-2",
            kind: "pet",
            name: "Mochi",
            position: 2,
            subjectId: "bd28f154-20b3-4c69-9487-23869997dd76",
          },
        ],
        template: {
          available: true,
          createdAt: "private timestamp",
          description: "City frame",
          id: 8,
          name: "City Blue",
          previewMedia: {
            alt: "Blue city frame",
            filename: "private.webp",
            height: 800,
            id: 12,
            url: "https://private.invalid/object",
            width: 600,
          },
        },
      },
    ],
  });

  assert.equal(response.subtotalCents, 2500);
  assert.equal(response.portraits[0].id, "a9f42c44-5a8b-4c2d-9431-66bd108cf261");
  assert.deepEqual(response.portraits[0].template.preview, {
    alt: "Blue city frame",
    height: 800,
    url: "/api/storefront/template-media/12",
    width: 600,
  });
  assert.equal(
    /accessToken|checkoutIntent|createdAt|filename|private\.invalid|internal-array-row/.test(
      JSON.stringify(response),
    ),
    false,
  );
});
