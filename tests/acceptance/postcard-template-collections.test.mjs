import assert from "node:assert/strict";
import test from "node:test";

import { PostcardTemplates } from "../../src/collections/PostcardTemplates.ts";
import { TemplateMedia } from "../../src/collections/TemplateMedia.ts";
import {
  TEMPLATE_MEDIA_MAX_FILE_SIZE_BYTES,
  TEMPLATE_MEDIA_MIME_TYPES,
} from "../../src/server/templates/templateMediaPolicy.ts";

const fieldMap = (collection) =>
  Object.fromEntries(collection.fields.map((field) => [field.name, field]));

const transparentPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("postcard templates expose the exact artist-managed catalog fields", async () => {
  assert.equal(PostcardTemplates.slug, "postcard-templates");
  assert.deepEqual(PostcardTemplates.defaultSort, ["sortOrder", "name"]);
  assert.deepEqual(PostcardTemplates.admin, {
    defaultColumns: ["name", "available", "sortOrder", "updatedAt"],
    group: "Photo Booth",
    useAsTitle: "name",
  });

  const fields = fieldMap(PostcardTemplates);
  assert.deepEqual(Object.keys(fields), [
    "name",
    "description",
    "previewMedia",
    "sortOrder",
    "available",
  ]);
  assert.equal(fields.name.required, true);
  assert.equal(fields.name.unique, true);
  assert.equal(fields.description.maxLength, 320);
  assert.equal(fields.previewMedia.relationTo, "template-media");
  assert.equal(fields.previewMedia.required, true);
  assert.equal(fields.sortOrder.defaultValue, 100);
  assert.equal(await fields.sortOrder.validate(0), true);
  assert.equal(await fields.sortOrder.validate(10_000), true);
  for (const value of [-1, 10_001, 1.5, "1", Number.NaN]) {
    assert.notEqual(await fields.sortOrder.validate(value), true);
  }
  assert.equal(fields.available.defaultValue, true);
  assert.equal(fields.available.index, true);
  assert.deepEqual(PostcardTemplates.indexes, [
    { fields: ["available", "sortOrder"] },
  ]);
});

test("template collections deny anonymous CRUD and allow Payload users", async () => {
  const anonymous = { req: { user: null } };
  const artist = { req: { user: { collection: "users", id: 1 } } };
  const otherAuthCollection = {
    req: { user: { collection: "customers", id: 1 } },
  };

  for (const collection of [PostcardTemplates, TemplateMedia]) {
    for (const operation of ["create", "read", "update", "delete"]) {
      assert.equal(await collection.access[operation](anonymous), false);
      assert.equal(await collection.access[operation](otherAuthCollection), false);
      assert.equal(await collection.access[operation](artist), true);
    }
  }
});

test("template media requires accessible private raster previews", async () => {
  assert.equal(TemplateMedia.slug, "template-media");
  assert.deepEqual(TemplateMedia.admin.defaultColumns, [
    "alt",
    "filename",
    "filesize",
    "updatedAt",
  ]);
  assert.equal(TemplateMedia.admin.group, "Photo Booth");
  assert.deepEqual(TemplateMedia.upload, {
    disableLocalStorage: true,
    filesRequiredOnCreate: true,
    mimeTypes: [...TEMPLATE_MEDIA_MIME_TYPES],
    pasteURL: false,
  });
  assert.equal(TEMPLATE_MEDIA_MAX_FILE_SIZE_BYTES, 10 * 1024 * 1024);

  const fields = fieldMap(TemplateMedia);
  assert.deepEqual(Object.keys(fields), ["alt"]);
  assert.equal(fields.alt.required, true);
  assert.equal(fields.alt.maxLength, 240);
  assert.equal(
    await fields.alt.hooks.beforeValidate[0]({ value: "  Central Park  " }),
    "Central Park",
  );

  const validate = TemplateMedia.hooks.beforeValidate[0];
  assert.deepEqual(await validate({
    data: { alt: "A template" },
    req: {
      file: {
        data: transparentPng,
        mimetype: "image/png",
        name: "preview.png",
        size: transparentPng.length,
      },
    },
  }), { alt: "A template", prefix: "template-media" });
  await assert.rejects(
    validate({
      req: {
        file: {
          data: Buffer.from("not an image"),
          mimetype: "image/png",
          name: "preview.png",
          size: Buffer.byteLength("not an image"),
        },
      },
    }),
    /valid JPEG, PNG, or WebP raster image/,
  );
});

test("template media deletion is refused while a template references it", async () => {
  const beforeDelete = TemplateMedia.hooks.beforeDelete[0];
  await assert.rejects(
    beforeDelete({
      id: 4,
      req: { payload: { count: async () => ({ totalDocs: 1 }) } },
    }),
    /still used by a postcard template/,
  );
  await beforeDelete({
    id: 4,
    req: { payload: { count: async () => ({ totalDocs: 0 }) } },
  });
});

test("template deletion is refused while an active portrait draft references it", async () => {
  const beforeDelete = PostcardTemplates.hooks.beforeDelete[0];
  await assert.rejects(
    beforeDelete({
      id: 5,
      req: { payload: { count: async () => ({ totalDocs: 1 }) } },
    }),
    /active portrait draft/,
  );
  await beforeDelete({
    id: 5,
    req: { payload: { count: async () => ({ totalDocs: 0 }) } },
  });
});

test("paid portrait preview media cannot be replaced", async () => {
  const beforeChange = TemplateMedia.hooks.beforeChange[0];
  await assert.rejects(
    beforeChange({
      operation: "update",
      originalDoc: { id: 7 },
      req: { payload: { count: async () => ({ totalDocs: 1 }) } },
    }),
    /preserved by a paid portrait/,
  );
  await beforeChange({
    operation: "update",
    originalDoc: { id: 7 },
    req: { payload: { count: async () => ({ totalDocs: 0 }) } },
  });
});
