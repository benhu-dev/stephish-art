import assert from "node:assert/strict";
import test from "node:test";

import { hashCheckoutIntentToken } from "../../src/server/checkout-intents/checkoutIntentCredentials.ts";
import { previewUploadHandler } from "../../src/server/storefront/checkoutIntentEndpoints.ts";
import { serializeCheckoutIntentCookie } from "../../src/server/storefront/checkoutIntentCookie.ts";
import { createCheckoutPhotoPreviewManager } from "../../src/features/checkout/checkoutPhotoPreviewClient.ts";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const owner = { intentId: 71, rawToken: "A".repeat(43) };
const other = { intentId: 72, rawToken: "B".repeat(43) };
const uploadId = 901;
const privateKey = "private-object-key-never-exposed.png";

const cookieFor = (credential) => serializeCheckoutIntentCookie(
  credential,
  new Date("2027-01-01T00:00:00.000Z"),
  false,
).split(";", 1)[0];

const requestFor = ({
  credential = owner,
  expiresAt = "2027-01-01T00:00:00.000Z",
  includeUpload = true,
  missingIntent = false,
  persistedRawToken = credential.rawToken,
  routeUploadId = String(uploadId),
  status = "draft",
} = {}) => {
  const findCalls = [];
  const logs = [];
  const request = new Request(
    `http://localhost/api/storefront/checkout-intents/current/uploads/${routeUploadId}/preview?intentId=71`,
    {
      headers: {
        cookie: cookieFor(credential),
        "x-checkout-intent-id": "71",
      },
    },
  );
  Object.assign(request, {
    payload: {
      find: async (options) => {
        findCalls.push(options);
        return { docs: includeUpload && credential.intentId === owner.intentId
          ? [{
              checkoutIntent: owner.intentId,
              filename: privateKey,
              filesize: png.length,
              id: uploadId,
              mimeType: "image/png",
            }]
          : [] };
      },
      findByID: async () => {
        if (missingIntent) throw new Error("not found");
        return {
        accessTokenHash: hashCheckoutIntentToken(persistedRawToken),
        amountCents: 900,
        deleteAfter: "2027-01-02T00:00:00.000Z",
        expiresAt,
        id: credential.intentId,
        status,
      };
      },
      logger: { error: (value) => logs.push(value) },
    },
    routeParams: { uploadId: routeUploadId },
  });
  return { findCalls, logs, request };
};

const streamObject = async () => ({
  contentLength: png.length,
  contentType: "image/png",
  stream: new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(png));
      controller.close();
    },
  }),
});

test("owner preview streams exact bytes with private same-origin headers", async () => {
  const { findCalls, logs, request } = requestFor();
  const response = await previewUploadHandler(request, {
    openOrderUploadObject: streamObject,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("content-length"), String(png.length));
  assert.equal(response.headers.get("content-disposition"), "inline");
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(response.headers.has("access-control-allow-origin"), false);
  assert.deepEqual(logs, []);
  assert.deepEqual(findCalls[0].where, {
    and: [
      { id: { equals: uploadId } },
      { checkoutIntent: { equals: owner.intentId } },
    ],
  });
  assert.doesNotMatch(JSON.stringify(Object.fromEntries(response.headers)), /bucket|supabase|signed|token|filename|private-object/i);
});

test("credentials, ownership, eligibility, and deleted rows fail generically", async () => {
  const missingCookie = requestFor();
  missingCookie.request.headers.delete("cookie");
  const malformedCookie = requestFor();
  malformedCookie.request.headers.set("cookie", "stephish_checkout_intent=bad");

  for (const fixture of [missingCookie, malformedCookie]) {
    const response = await previewUploadHandler(fixture.request, { openOrderUploadObject: streamObject });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: { code: "UNAUTHORIZED" } });
  }

  for (const fixture of [
    requestFor({ missingIntent: true }),
    requestFor({ persistedRawToken: "C".repeat(43) }),
  ]) {
    const response = await previewUploadHandler(fixture.request, { openOrderUploadObject: streamObject });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: { code: "UNAUTHORIZED" } });
  }

  for (const fixture of [
    requestFor({ credential: other }),
    requestFor({ includeUpload: false }),
    requestFor({ routeUploadId: "not-an-id" }),
  ]) {
    const response = await previewUploadHandler(fixture.request, { openOrderUploadObject: streamObject });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: { code: "UPLOAD_NOT_FOUND" } });
  }

  for (const fixture of [
    requestFor({ expiresAt: "2020-01-01T00:00:00.000Z" }),
    requestFor({ status: "checkout_created" }),
  ]) {
    const response = await previewUploadHandler(fixture.request, { openOrderUploadObject: streamObject });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: { code: "UNAUTHORIZED" } });
  }
});

test("unreadable backing objects return no private storage details", async () => {
  const { logs, request } = requestFor();
  const response = await previewUploadHandler(request, {
    openOrderUploadObject: async () => {
      throw new Error(`missing s3://order-uploads/${privateKey}`);
    },
  });
  const responseText = await response.text();

  assert.equal(response.status, 500);
  assert.equal(responseText, JSON.stringify({ error: { code: "PREVIEW_UNAVAILABLE" } }));
  assert.doesNotMatch(`${responseText}${JSON.stringify(Object.fromEntries(response.headers))}`, /order-uploads|private-object|s3:|supabase|signed/i);
  assert.deepEqual(logs, []);
});

test("preview manager validates images, deduplicates, retries, aborts, and revokes URLs", async () => {
  const calls = [];
  const revoked = [];
  let created = 0;
  const manager = createCheckoutPhotoPreviewManager({
    createObjectURL: () => `blob:preview-${++created}`,
    fetchImpl: async (url, options) => {
      calls.push({ options, url });
      return new Response(png, {
        headers: {
          "content-length": String(png.length),
          "content-type": "image/png",
        },
      });
    },
    revokeObjectURL: (url) => revoked.push(url),
  });

  const first = manager.load(901);
  const duplicate = manager.load(901);
  assert.equal(first, duplicate);
  assert.deepEqual(await first, { kind: "ready", previewUrl: "blob:preview-1" });
  assert.equal(calls.length, 1);
  assert.deepEqual(
    [calls[0].url, calls[0].options.method, calls[0].options.credentials, calls[0].options.cache],
    ["/api/storefront/checkout-intents/current/uploads/901/preview", "GET", "same-origin", "no-store"],
  );
  assert.equal(calls[0].options.signal instanceof AbortSignal, true);
  assert.deepEqual(await manager.load(901), { kind: "ready", previewUrl: "blob:preview-1" });
  assert.equal(calls.length, 1);
  manager.release(901);
  assert.deepEqual(revoked, ["blob:preview-1"]);

  let attempt = 0;
  const retrying = createCheckoutPhotoPreviewManager({
    createObjectURL: () => "blob:retried",
    fetchImpl: async () => ++attempt === 1
      ? new Response("not an image", { headers: { "content-type": "text/html" } })
      : new Response(png, { headers: { "content-type": "image/png" } }),
    revokeObjectURL: (url) => revoked.push(url),
  });
  assert.deepEqual(await retrying.load(902), { kind: "failed" });
  assert.deepEqual(await retrying.load(902), { kind: "ready", previewUrl: "blob:retried" });

  let aborted = false;
  const aborting = createCheckoutPhotoPreviewManager({
    createObjectURL: () => "blob:must-not-exist",
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        aborted = true;
        reject(new DOMException("Aborted", "AbortError"));
      }, { once: true });
    }),
    revokeObjectURL: (url) => revoked.push(url),
  });
  const obsolete = aborting.load(903);
  aborting.release(903);
  assert.deepEqual(await obsolete, { kind: "aborted" });
  assert.equal(aborted, true);
  retrying.dispose();
  assert.equal(revoked.includes("blob:retried"), true);
});
