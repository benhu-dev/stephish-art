import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { deletePhoto, readCurrentPhotos, uploadPhoto } from "../../src/features/checkout/checkoutPhotoClient.ts";
import { CheckoutPhotoStep } from "../../src/features/checkout/components/CheckoutPhotoStep.tsx";
import { CheckoutReviewStep } from "../../src/features/checkout/components/CheckoutReviewStep.tsx";

const uploads = (positions) => positions.map((position) => ({
  id: position + 100,
  mimeType: "image/png",
  position,
  sizeBytes: 68,
}));
const state = (positions = []) => ({
  amountCents: 900,
  artistNote: "",
  expiresAt: "2026-09-23T12:00:00.000Z",
  limits: {
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    maxFileBytes: 15 * 1024 * 1024,
    maxFiles: 3,
    maxTotalBytes: 30 * 1024 * 1024,
    minimumAmountCents: 500,
  },
  status: "draft",
  uploads: uploads(positions),
});
const photo = () => new File([new Uint8Array(68)], "private-name.png", { type: "image/png" });

test("one, two, and three uploads use only file and integer position fields", async () => {
  for (const count of [1, 2, 3]) {
    const calls = [];
    for (let position = 1; position <= count; position += 1) {
      const result = await uploadPhoto(photo(), position, {
        fetchImpl: async (url, options) => {
          calls.push({ url, options });
          return Response.json(state(Array.from({ length: position }, (_, index) => index + 1)), { status: 201 });
        },
      });
      assert.equal(result.kind, "confirmed");
      assert.deepEqual(result.state.uploads.map((upload) => upload.position),
        Array.from({ length: position }, (_, index) => index + 1));
    }
    assert.deepEqual(calls.map(({ url }) => url), Array(count).fill("/api/storefront/checkout-intents/current/uploads"));
    for (const [index, { options }] of calls.entries()) {
      assert.equal(options.method, "POST");
      assert.equal(options.credentials, "same-origin");
      assert.equal(options.cache, "no-store");
      assert.equal(options.headers, undefined);
      assert.deepEqual([...options.body.keys()], ["file", "_payload"]);
      assert.deepEqual(JSON.parse(options.body.get("_payload")), { position: index + 1 });
      assert.equal(options.body.get("file").name, "private-name.png");
      const request = new Request("http://localhost/api/upload", { method: "POST", body: options.body });
      assert.match(request.headers.get("content-type"), /^multipart\/form-data; boundary=/);
    }
  }
});

test("GET reconciliation and DELETE use same-origin no-store without private fields", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return options.method === "GET" ? Response.json(state([1]), { status: 200 }) : new Response(null, { status: 204 });
  };
  assert.deepEqual((await readCurrentPhotos({ fetchImpl })).state.uploads, uploads([1]));
  assert.deepEqual(await deletePhoto(101, { fetchImpl }), { kind: "deleted" });
  assert.deepEqual(calls.map(({ url, options }) => [url, options.method, options.credentials, options.cache]), [
    ["/api/storefront/checkout-intents/current", "GET", "same-origin", "no-store"],
    ["/api/storefront/checkout-intents/current/uploads/101", "DELETE", "same-origin", "no-store"],
  ]);
  assert.equal(calls.every(({ options }) => !options.body && !options.headers), true);
});

test("ambiguous replies require reconciliation and malformed success data stays out of client state", async () => {
  assert.deepEqual(await uploadPhoto(photo(), 1, { fetchImpl: async () => { throw Error("private detail"); } }), { kind: "uncertain" });
  assert.deepEqual(await uploadPhoto(photo(), 1, { fetchImpl: async () => Response.json(state([1]), { status: 409 }) }), { kind: "uncertain" });
  assert.deepEqual(await uploadPhoto(photo(), 1, { fetchImpl: async () => Response.json({ ...state([1]), bucket: "private" }, { status: 201 }) }), { kind: "uncertain" });
  assert.deepEqual(await deletePhoto(101, { fetchImpl: async () => new Response(null, { status: 503 }) }), { kind: "uncertain" });
  assert.deepEqual(await deletePhoto(101, { fetchImpl: async () => Response.json({}, { status: 400 }) }), { kind: "failed" });
  assert.deepEqual(await readCurrentPhotos({ fetchImpl: async () => Response.json({ ...state([1]), token: "private" }, { status: 200 }) }), { kind: "unavailable" });
  assert.deepEqual(await deletePhoto(0, { fetchImpl: async () => { throw Error("must not call"); } }), { kind: "failed" });
  for (const status of [401, 410]) {
    assert.deepEqual(await uploadPhoto(photo(), 1, { fetchImpl: async () => Response.json({}, { status }) }), { kind: "unavailable" });
  }
});

test("server previews keep artistic loading and failure fallbacks without internal metadata", () => {
  const entry = { position: 3, server: uploads([3])[0], status: "confirmed" };
  const markup = renderToStaticMarkup(createElement(CheckoutPhotoStep, {
    error: null,
    inputRef: { current: null },
    limits: state().limits,
    note: "",
    onChoose() {},
    onDrop() {},
    onOpenPicker() {},
    onRemove() {},
    onRetryPreview() {},
    pending: false,
    photos: [entry],
    setNote() {},
  }));
  const review = renderToStaticMarkup(createElement(CheckoutReviewStep, {
    amountCents: 900,
    onFinish() {},
    onRetryPreview() {},
    photos: [entry],
  }));
  for (const html of [markup, review]) {
    assert.match(html, /Photo 3/);
    assert.match(html, /PNG/);
    assert.doesNotMatch(html, /103|bucket|storage|token|signed|intentId|https?:\/\//i);
  }

  const failed = { ...entry, serverPreview: { status: "failed" } };
  const failedMarkup = renderToStaticMarkup(createElement(CheckoutPhotoStep, {
    error: null,
    inputRef: { current: null },
    limits: state().limits,
    note: "",
    onChoose() {},
    onDrop() {},
    onOpenPicker() {},
    onRemove() {},
    onRetryPreview() {},
    pending: false,
    photos: [failed],
    setNote() {},
  }));
  assert.match(failedMarkup, /Retry preview/);
  assert.match(failedMarkup, /Photo 3 uploaded/);

  const ready = { ...entry, serverPreview: { previewUrl: "blob:safe-preview", status: "ready" } };
  const readyReview = renderToStaticMarkup(createElement(CheckoutReviewStep, {
    amountCents: 900,
    onFinish() {},
    onRetryPreview() {},
    photos: [ready],
  }));
  assert.match(readyReview, /blob:safe-preview/);
});
