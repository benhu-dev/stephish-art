import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import {
  parsePortraitUploadForm,
  parsePortraitUploadUpdate,
} from "../../src/server/cart/portraitUploadRequest.ts";
import { StorefrontApiError } from "../../src/server/storefront/storefrontApiError.ts";

const subjectId = "26613a1d-6cc0-4778-9508-a6cb60af9a32";

const encodedMultipartRequest = async ({ extra = false } = {}) => {
  const png = await sharp({
    create: {
      background: { alpha: 1, b: 0, g: 0, r: 0 },
      channels: 4,
      height: 2,
      width: 2,
    },
  })
    .png()
    .toBuffer();
  const form = new FormData();
  form.append("file", new Blob([png], { type: "image/png" }), "reference.png");
  form.append(
    "_payload",
    JSON.stringify({ position: 1, subjectIds: [subjectId] }),
  );
  if (extra) form.append("amountCents", "1");
  const encoded = new Request("https://shop.example/upload", {
    body: form,
    method: "POST",
  });
  const body = Buffer.from(await encoded.arrayBuffer());
  const request = new Request(encoded.url, {
    body,
    headers: {
      "content-length": String(body.length),
      "content-type": encoded.headers.get("content-type"),
    },
    method: "POST",
  });
  request.payload = {
    config: {},
    logger: { error: () => {} },
  };
  return request;
};

test("portrait multipart parsing accepts exactly one file and one narrow payload", async () => {
  const parsed = await parsePortraitUploadForm(await encodedMultipartRequest());
  assert.equal(parsed.position, 1);
  assert.deepEqual(parsed.subjectIds, [subjectId]);
  assert.equal(parsed.file.mimetype, "image/png");
  assert.equal(parsed.file.size, parsed.file.data.length);
});

test("portrait multipart parsing rejects extra fields and transfer encoding", async () => {
  await assert.rejects(
    parsePortraitUploadForm(await encodedMultipartRequest({ extra: true })),
    (error) =>
      error instanceof StorefrontApiError &&
      error.code === "INVALID_MULTIPART_FIELDS",
  );
  const transfer = await encodedMultipartRequest();
  transfer.headers.set("transfer-encoding", "chunked");
  await assert.rejects(
    parsePortraitUploadForm(transfer),
    (error) =>
      error instanceof StorefrontApiError && error.code === "REQUEST_TOO_LARGE",
  );
});

test("mapping update parsing rejects unexpected fields", async () => {
  const valid = new Request("https://shop.example/update", {
    body: JSON.stringify({ position: 1, subjectIds: [subjectId] }),
    headers: { "content-type": "application/json" },
    method: "PUT",
  });
  assert.deepEqual(await parsePortraitUploadUpdate(valid), {
    position: 1,
    subjectIds: [subjectId],
  });

  const invalid = new Request("https://shop.example/update", {
    body: JSON.stringify({ filename: "private.jpg", position: 1, subjectIds: [subjectId] }),
    headers: { "content-type": "application/json" },
    method: "PUT",
  });
  await assert.rejects(
    parsePortraitUploadUpdate(invalid),
    (error) =>
      error instanceof StorefrontApiError && error.code === "INVALID_REQUEST",
  );
});
