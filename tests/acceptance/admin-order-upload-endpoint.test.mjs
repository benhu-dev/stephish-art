import assert from "node:assert/strict";
import test from "node:test";

import {
  adminOrderUploadEndpoints,
  createBoundedUploadStream,
  createAdminOrderUploadHandler,
} from "../../src/server/orders/adminOrderUploadEndpoint.ts";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const requestFor = ({
  authenticated = true,
  docs,
  orderId = "41",
  uploadId = "73",
} = {}) => {
  const request = new Request(
    `https://shop.example/api/admin/orders/${orderId}/uploads/${uploadId}/preview`,
  );
  request.user = authenticated ? { collection: "users", id: 1 } : null;
  request.routeParams = { orderId, uploadId };
  request.payload = {
    find: async (args) => {
      assert.equal(args.collection, "order-uploads");
      assert.equal(args.overrideAccess, false);
      assert.equal(args.req, request);
      assert.deepEqual(args.where, {
        and: [
          { id: { equals: 73 } },
          { order: { equals: 41 } },
        ],
      });
      return { docs: docs ?? [{
        filename: "private-object-key.png",
        filesize: png.length,
        mimeType: "image/png",
        position: 2,
      }] };
    },
    logger: { error: () => {} },
  };
  return request;
};

const streamingObject = ({ bytes = png, contentLength = bytes.length } = {}) => ({
  contentLength,
  contentType: "image/png",
  stream: new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  }),
});

test("admin image endpoints have only the approved GET routes", () => {
  assert.deepEqual(
    adminOrderUploadEndpoints.map(({ method, path }) => ({ method, path })),
    [
      {
        method: "get",
        path: "/admin/orders/:orderId/uploads/:uploadId/preview",
      },
      {
        method: "get",
        path: "/admin/orders/:orderId/uploads/:uploadId/download",
      },
    ],
  );
});

test("preview and download stream exact bytes with generated names and private headers", async () => {
  const opened = [];
  const openOrderUploadObject = async (filename, signal) => {
    opened.push({ filename, signal });
    return streamingObject();
  };

  for (const [mode, disposition] of [
    ["preview", 'inline; filename="reference-2.png"'],
    ["download", 'attachment; filename="reference-2.png"'],
  ]) {
    const response = await createAdminOrderUploadHandler({
      mode,
      openOrderUploadObject,
    })(requestFor());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.equal(response.headers.get("content-length"), String(png.length));
    assert.equal(response.headers.get("content-disposition"), disposition);
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
    assert.equal(response.headers.get("location"), null);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
    assert.doesNotMatch(
      JSON.stringify(Object.fromEntries(response.headers)),
      /private-object-key|order-uploads|supabase|signed|credential/i,
    );
  }
  assert.equal(opened.length, 2);
  assert.equal(opened.every(({ filename }) => filename === "private-object-key.png"), true);
});

test("anonymous, guessed, missing, deleted, and cross-order requests fail generically", async () => {
  let opens = 0;
  const handler = createAdminOrderUploadHandler({
    mode: "preview",
    openOrderUploadObject: async () => {
      opens += 1;
      return streamingObject();
    },
  });

  const anonymous = await handler(requestFor({ authenticated: false }));
  assert.equal(anonymous.status, 401);
  assert.deepEqual(await anonymous.json(), { error: { code: "UNAUTHORIZED" } });

  for (const request of [
    requestFor({ docs: [] }),
    requestFor({ orderId: "999" }),
    requestFor({ uploadId: "999" }),
    requestFor({ uploadId: "deleted" }),
  ]) {
    const response = await handler(request);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: { code: "UPLOAD_NOT_FOUND" } });
  }
  assert.equal(opens, 0);
});

test("metadata mismatch and oversized streams fail closed without private metadata", async () => {
  for (const openOrderUploadObject of [
    async () => ({ ...streamingObject(), contentType: "text/html" }),
    async () => streamingObject({ contentLength: png.length + 1 }),
  ]) {
    const response = await createAdminOrderUploadHandler({
      mode: "preview",
      openOrderUploadObject,
    })(requestFor());
    assert.equal(response.status, 404);
    const text = await response.text();
    assert.deepEqual(JSON.parse(text), { error: { code: "UPLOAD_NOT_FOUND" } });
    assert.doesNotMatch(text, /private-object-key|supabase|bucket/i);
  }
});

test("the web stream stays incremental and rejects extra bytes", async () => {
  let pulls = 0;
  const source = new ReadableStream({
    pull(controller) {
      pulls += 1;
      controller.enqueue(new Uint8Array([pulls]));
      if (pulls === 3) controller.close();
    },
  });
  const bounded = createBoundedUploadStream(source, 2);
  assert.equal(pulls, 0);
  const reader = bounded.getReader();
  assert.deepEqual(await reader.read(), { done: false, value: new Uint8Array([1]) });
  assert.equal(pulls <= 2, true);
  assert.deepEqual(await reader.read(), { done: false, value: new Uint8Array([2]) });
  await assert.rejects(reader.read(), /UPLOAD_STREAM/);
});
