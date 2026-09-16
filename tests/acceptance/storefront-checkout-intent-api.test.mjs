import assert from "node:assert/strict";
import test from "node:test";

import {
  STOREFRONT_SAFE_LIMITS,
  buildSafeCheckoutIntentResponse,
} from "../../src/server/storefront/checkoutIntentApiContract.ts";
import {
  CHECKOUT_INTENT_COOKIE_NAME,
  clearCheckoutIntentCookie,
  parseCheckoutIntentCookie,
  serializeCheckoutIntentCookie,
} from "../../src/server/storefront/checkoutIntentCookie.ts";
import { storefrontCheckoutIntentEndpoints } from "../../src/server/storefront/checkoutIntentEndpoints.ts";
import {
  detectAndValidateImage,
  detectImageContent,
} from "../../src/server/storefront/storefrontImageValidation.ts";
import {
  isSameOriginRequest,
  parseAmountRequest,
} from "../../src/server/storefront/storefrontRequestSecurity.ts";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("root storefront endpoints have the exact route and method contract", () => {
  assert.deepEqual(
    storefrontCheckoutIntentEndpoints.map(({ method, path }) => ({
      method,
      path,
    })),
    [
      { method: "post", path: "/storefront/checkout-intents" },
      { method: "get", path: "/storefront/checkout-intents/current" },
      {
        method: "post",
        path: "/storefront/checkout-intents/current/uploads",
      },
      {
        method: "delete",
        path: "/storefront/checkout-intents/current/uploads/:uploadId",
      },
    ],
  );
});

test("safe response and limits omit every private persistence field", () => {
  assert.deepEqual(STOREFRONT_SAFE_LIMITS, {
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    maxFileBytes: 15 * 1024 * 1024,
    maxFiles: 3,
    maxTotalBytes: 30 * 1024 * 1024,
  });

  const response = buildSafeCheckoutIntentResponse({
    intent: {
      accessTokenHash: "a".repeat(64),
      amountCents: 725,
      deleteAfter: "2026-09-18T00:00:00.000Z",
      expiresAt: "2026-09-17T00:00:00.000Z",
      id: 123,
      status: "draft",
    },
    minimumAmountCents: 700,
    uploads: [
      {
        checkoutIntent: 123,
        filename: "private.png",
        filesize: 42,
        id: 9,
        mimeType: "image/png",
        position: 2,
        url: "https://private.invalid/object",
      },
    ],
  });

  assert.deepEqual(response, {
    amountCents: 725,
    expiresAt: "2026-09-17T00:00:00.000Z",
    limits: {
      ...STOREFRONT_SAFE_LIMITS,
      minimumAmountCents: 700,
    },
    status: "draft",
    uploads: [
      { id: 9, mimeType: "image/png", position: 2, sizeBytes: 42 },
    ],
  });
  assert.equal(
    /accessToken|deleteAfter|filename|bucket|private\.invalid/.test(
      JSON.stringify(response),
    ),
    false,
  );
});

test("cookie is versioned, scoped, protected, and parseable without a hash", () => {
  const expiresAt = new Date("2026-09-17T00:00:00.000Z");
  const rawToken = "A".repeat(43);
  const productionCookie = serializeCheckoutIntentCookie(
    { intentId: 17, rawToken },
    expiresAt,
    true,
  );

  assert.equal(CHECKOUT_INTENT_COOKIE_NAME, "stephish_checkout_intent");
  assert.match(productionCookie, /^stephish_checkout_intent=v1\.17\./);
  assert.match(productionCookie, /; Path=\/api\/storefront\/checkout-intents/);
  assert.match(productionCookie, /; Expires=Thu, 17 Sep 2026 00:00:00 GMT/);
  assert.match(productionCookie, /; HttpOnly/);
  assert.match(productionCookie, /; SameSite=Strict/);
  assert.match(productionCookie, /; Secure/);
  assert.equal(/Domain=/i.test(productionCookie), false);
  assert.equal(/[a-f0-9]{64}/.test(productionCookie), false);
  assert.deepEqual(parseCheckoutIntentCookie(productionCookie), {
    kind: "valid",
    credential: { intentId: 17, rawToken },
  });

  const developmentCookie = serializeCheckoutIntentCookie(
    { intentId: 17, rawToken },
    expiresAt,
    false,
  );
  assert.equal(/; Secure/.test(developmentCookie), false);
  assert.equal(parseCheckoutIntentCookie("other=value").kind, "missing");
  assert.equal(
    parseCheckoutIntentCookie(
      `${CHECKOUT_INTENT_COOKIE_NAME}=malformed-value`,
    ).kind,
    "malformed",
  );
  assert.match(clearCheckoutIntentCookie(false), /Expires=Thu, 01 Jan 1970/);
});

test("origin and exact amount validation reject confused request shapes", () => {
  assert.equal(
    isSameOriginRequest(
      new Request("https://shop.example/api/example", {
        headers: { Origin: "https://shop.example" },
      }),
    ),
    true,
  );
  for (const origin of [
    undefined,
    "null",
    "not a url",
    "https://elsewhere.example",
  ]) {
    const headers = origin === undefined ? undefined : { Origin: origin };
    assert.equal(
      isSameOriginRequest(
        new Request("https://shop.example/api/example", { headers }),
      ),
      false,
    );
  }

  assert.deepEqual(parseAmountRequest({ amountCents: 500 }, 500), {
    amountCents: 500,
  });
  for (const value of [
    {},
    { amountCents: 499 },
    { amountCents: "500" },
    { amountCents: 500.5 },
    { amountCents: Number.NaN },
    { amountCents: Number.MAX_SAFE_INTEGER + 1 },
    { amountCents: 500, extra: true },
    [],
    null,
  ]) {
    assert.throws(() => parseAmountRequest(value, 500));
  }
});

test("image detection requires matching declared and decoded raster content", async () => {
  assert.deepEqual(detectImageContent(png), {
    extension: "png",
    mimeType: "image/png",
  });
  assert.deepEqual(await detectAndValidateImage(png, "image/png"), {
    extension: "png",
    height: 1,
    mimeType: "image/png",
    width: 1,
  });
  await assert.rejects(() => detectAndValidateImage(png, "image/jpeg"));
  await assert.rejects(() =>
    detectAndValidateImage(Buffer.from("not an image"), "image/png"),
  );
});
