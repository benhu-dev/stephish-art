import assert from "node:assert/strict";
import test from "node:test";

import {
  createPostcardTemplateCatalogHandler,
  createTemplateMediaHandler,
  postcardTemplateStorefrontEndpoints,
} from "../../src/server/templates/postcardTemplateEndpoints.ts";
import {
  PostcardTemplateCatalogError,
  readAvailablePostcardTemplates,
  readAvailableTemplateMedia,
} from "../../src/server/templates/postcardTemplateService.ts";

const createRequest = (overrides = {}) => ({
  payload: {
    logger: { error() {} },
  },
  routeParams: {},
  url: "https://example.test/api/storefront/postcard-templates",
  ...overrides,
});

test("catalog reads only available templates and returns a minimal contract", async () => {
  let query;
  const request = createRequest({
    payload: {
      find: async (value) => {
        query = value;
        return {
          docs: [
            {
              available: true,
              createdAt: "private",
              description: "  A city garden portrait.  ",
              id: 7,
              name: "  Central Park  ",
              previewMedia: {
                alt: "  Illustrated Central Park postcard template  ",
                filename: "private.png",
                height: 1200,
                id: 9,
                prefix: "template-media",
                width: 900,
              },
              sortOrder: 10,
            },
          ],
        };
      },
    },
  });

  assert.deepEqual(await readAvailablePostcardTemplates(request), {
    templates: [
      {
        description: "A city garden portrait.",
        id: 7,
        name: "Central Park",
        preview: {
          alt: "Illustrated Central Park postcard template",
          height: 1200,
          url: "/api/storefront/template-media/9",
          width: 900,
        },
      },
    ],
  });
  assert.equal(query.collection, "postcard-templates");
  assert.equal(query.overrideAccess, true);
  assert.deepEqual(query.where, { available: { equals: true } });
  assert.deepEqual(query.sort, ["sortOrder", "name", "id"]);
  assert.deepEqual(Object.keys(query.select).sort(), [
    "description",
    "name",
    "previewMedia",
    "sortOrder",
  ]);
});

test("catalog handler rejects query authority and keeps safe public headers", async () => {
  const readCatalog = async () => ({ templates: [] });
  const handler = createPostcardTemplateCatalogHandler(readCatalog);
  const invalid = await handler(
    createRequest({ url: "https://example.test/api/storefront/postcard-templates?available=false" }),
  );
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), {
    error: { code: "INVALID_CATALOG_REQUEST" },
  });
  assert.equal(invalid.headers.get("cache-control"), "no-store");

  const valid = await handler(createRequest());
  assert.equal(valid.status, 200);
  assert.equal(valid.headers.get("x-content-type-options"), "nosniff");
  assert.match(valid.headers.get("cache-control"), /^public,/);
});

test("template media is available only through an available template reference", async () => {
  await assert.rejects(
    readAvailableTemplateMedia({
      mediaId: 9,
      request: createRequest({
        payload: {
          find: async () => ({ docs: [] }),
        },
      }),
    }),
    (error) =>
      error instanceof PostcardTemplateCatalogError &&
      error.status === 404 &&
      error.code === "TEMPLATE_MEDIA_NOT_FOUND",
  );

  let objectKey;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  });
  const media = await readAvailableTemplateMedia({
    mediaId: 9,
    openObject: async (key) => {
      objectKey = key;
      return {
        contentLength: 3,
        contentType: "image/png",
        stream,
      };
    },
    request: createRequest({
      payload: {
        find: async () => ({ docs: [{ id: 7 }] }),
        findByID: async () => ({
          filename: "preview.png",
          filesize: 3,
          mimeType: "image/png",
          prefix: "template-media",
        }),
      },
    }),
  });
  assert.equal(objectKey, "template-media/preview.png");
  assert.equal(media.contentLength, 3);
  assert.equal(media.contentType, "image/png");
});

test("media endpoint validates IDs and streams bounded safe image responses", async () => {
  const invalidHandler = createTemplateMediaHandler(async () => {
    throw new Error("must not be called");
  });
  const invalid = await invalidHandler(
    createRequest({
      routeParams: { mediaId: "../9" },
      url: "https://example.test/api/storefront/template-media/../9",
    }),
  );
  assert.equal(invalid.status, 404);

  const handler = createTemplateMediaHandler(async () => ({
    contentLength: 3,
    contentType: "image/png",
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    }),
  }));
  const response = await handler(
    createRequest({
      routeParams: { mediaId: "9" },
      url: "https://example.test/api/storefront/template-media/9",
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("content-length"), "3");
  assert.equal(response.headers.get("content-disposition"), "inline; filename=template-preview");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2, 3]));
});

test("Payload registers the narrow public catalog routes", () => {
  assert.deepEqual(
    postcardTemplateStorefrontEndpoints.map(({ method, path }) => ({ method, path })),
    [
      { method: "get", path: "/storefront/postcard-templates" },
      { method: "get", path: "/storefront/template-media/:mediaId" },
    ],
  );
});
