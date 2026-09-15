import assert from "node:assert/strict";
import test from "node:test";

import { OrderUploads } from "../../src/collections/OrderUploads.ts";
import {
  getOrderUploadStorageOptions,
  ORDER_UPLOAD_MAX_FILE_SIZE_BYTES,
} from "../../src/server/storage/orderUploadStorage.ts";

const completeEnvironment = {
  SUPABASE_STORAGE_ACCESS_KEY_ID: "acceptance-access-key",
  SUPABASE_STORAGE_BUCKET: "order-uploads",
  SUPABASE_STORAGE_ENDPOINT: "https://storage.example.invalid/storage/v1/s3",
  SUPABASE_STORAGE_REGION: "acceptance-region",
  SUPABASE_STORAGE_SECRET_ACCESS_KEY: "acceptance-secret-key",
};

test("Order Uploads has the exact private upload contract", () => {
  assert.equal(OrderUploads.slug, "order-uploads");
  assert.deepEqual(OrderUploads.fields, []);
  assert.equal(OrderUploads.admin.group, "Orders");
  assert.deepEqual(OrderUploads.admin.defaultColumns, [
    "filename",
    "mimeType",
    "filesize",
    "createdAt",
  ]);
  assert.deepEqual(OrderUploads.upload, {
    disableLocalStorage: true,
    filesRequiredOnCreate: true,
    mimeTypes: ["image/jpeg", "image/png", "image/webp"],
    pasteURL: false,
  });
});

test("Order Uploads storage is fail-closed, server-side, path-style, and signed", () => {
  const options = getOrderUploadStorageOptions(completeEnvironment);

  assert.equal(ORDER_UPLOAD_MAX_FILE_SIZE_BYTES, 15 * 1024 * 1024);
  assert.equal(options.bucket, "order-uploads");
  assert.equal(options.clientUploads, false);
  assert.equal(options.disableLocalStorage, true);
  assert.equal(options.signedDownloads, true);
  assert.deepEqual(options.collections, { "order-uploads": true });
  assert.equal(options.config.endpoint, completeEnvironment.SUPABASE_STORAGE_ENDPOINT);
  assert.equal(options.config.region, completeEnvironment.SUPABASE_STORAGE_REGION);
  assert.equal(options.config.forcePathStyle, true);
  assert.deepEqual(options.config.credentials, {
    accessKeyId: completeEnvironment.SUPABASE_STORAGE_ACCESS_KEY_ID,
    secretAccessKey: completeEnvironment.SUPABASE_STORAGE_SECRET_ACCESS_KEY,
  });
  assert.equal("disablePayloadAccessControl" in options.collections, false);
  assert.equal("generateFileURL" in options, false);
});

test("Order Uploads storage rejects incomplete or unsafe configuration", () => {
  for (const name of Object.keys(completeEnvironment)) {
    assert.throws(
      () => getOrderUploadStorageOptions({ ...completeEnvironment, [name]: "" }),
      new RegExp(name),
    );
  }

  assert.throws(
    () =>
      getOrderUploadStorageOptions({
        ...completeEnvironment,
        SUPABASE_STORAGE_BUCKET: "another-bucket",
      }),
    /approved private bucket/,
  );
  assert.throws(
    () =>
      getOrderUploadStorageOptions({
        ...completeEnvironment,
        SUPABASE_STORAGE_ENDPOINT: "http:\/\/storage.example.invalid",
      }),
    /valid HTTPS URL/,
  );
});

test("Order Uploads denies anonymous access and permits Payload users", async () => {
  const anonymous = { req: { user: null } };
  const authenticated = {
    req: { user: { collection: "users", id: 1 } },
  };

  for (const operation of ["create", "read", "update", "delete"]) {
    const access = OrderUploads.access[operation];

    assert.equal(typeof access, "function");
    assert.equal(await access(anonymous), false);
    assert.equal(await access(authenticated), true);
  }
});
