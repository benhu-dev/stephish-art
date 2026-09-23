import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import nextEnvironment from "@next/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { getPayload } from "payload";

import { deletePhoto, uploadPhoto } from "../../src/features/checkout/checkoutPhotoClient.ts";
import { parseCheckoutIntentCookie } from "../../src/server/storefront/checkoutIntentCookie.ts";

const { loadEnvConfig } = nextEnvironment;
loadEnvConfig(fileURLToPath(new URL("../../", import.meta.url)), true, { error() {}, info() {} });

const baseURL = process.argv[2] ?? "http://127.0.0.1:3000";
const origin = new URL(baseURL).origin;
const runId = `unit-2-12-3-${randomUUID()}`;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const database = new pg.Client({ connectionString: process.env.DATABASE_URL });
const storage = new S3Client({
  credentials: {
    accessKeyId: process.env.SUPABASE_STORAGE_ACCESS_KEY_ID,
    secretAccessKey: process.env.SUPABASE_STORAGE_SECRET_ACCESS_KEY,
  },
  endpoint: process.env.SUPABASE_STORAGE_ENDPOINT,
  forcePathStyle: true,
  region: process.env.SUPABASE_STORAGE_REGION,
});

let baselineObjects;
let baselineRows;
let connected = false;
let failed = false;
let payload;
let stage = "PREFLIGHT";
const syntheticIntentIds = new Set();

const rowCounts = async () => (await database.query(
  "SELECT (SELECT count(*)::int FROM public.checkout_intents) AS checkout_intents, " +
    "(SELECT count(*)::int FROM public.order_uploads) AS order_uploads, " +
    "(SELECT count(*)::int FROM public.customers) AS customers, " +
    "(SELECT count(*)::int FROM public.orders) AS orders, " +
    "(SELECT count(*)::int FROM public.stripe_events) AS stripe_events, " +
    "(SELECT count(*)::int FROM public.users) AS users",
)).rows[0];

const objectKeys = async () => {
  const keys = [];
  let continuationToken;
  do {
    const page = await storage.send(new ListObjectsV2Command({
      Bucket: process.env.SUPABASE_STORAGE_BUCKET,
      ContinuationToken: continuationToken,
    }));
    keys.push(...(page.Contents ?? []).map(({ Key }) => Key));
    continuationToken = page.NextContinuationToken;
  } while (continuationToken);
  return keys.sort();
};

const request = (path, cookie, init = {}) => fetch(new URL(path, baseURL), {
  ...init,
  cache: "no-store",
  headers: {
    ...init.headers,
    origin,
    ...(cookie ? { cookie } : {}),
  },
});

const createIntent = async () => {
  const response = await request("/api/storefront/checkout-intents", undefined, {
    body: JSON.stringify({ amountCents: 973 }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(response.status, 201);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie);
  const parsed = parseCheckoutIntentCookie(cookie);
  assert.equal(parsed.kind, "valid");
  syntheticIntentIds.add(parsed.credential.intentId);
  return { cookie, intentId: parsed.credential.intentId };
};

try {
  await database.connect();
  connected = true;
  const { default: config } = await import("../../src/payload.config.ts");
  payload = await getPayload({ config });
  baselineRows = await rowCounts();
  baselineObjects = await objectKeys();
  console.log(`START_COUNTS=${JSON.stringify({ ...baselineRows, storageObjects: baselineObjects.length })}`);

  stage = "CREATE_SYNTHETIC_INTENTS";
  const owner = await createIntent();
  const other = await createIntent();

  stage = "UPLOAD_UNIQUE_SYNTHETIC_IMAGE";
  const uploaded = await uploadPhoto(
    new File([png], `${runId}.png`, { type: "image/png" }),
    1,
    { fetchImpl: (path, init) => request(path, owner.cookie, init) },
  );
  assert.equal(uploaded.kind, "confirmed");
  assert.equal(uploaded.state.uploads.length, 1);
  const uploadId = uploaded.state.uploads[0].id;
  const uploadRow = (await database.query(
    "SELECT filename FROM public.order_uploads WHERE id = $1 AND checkout_intent_id = $2",
    [uploadId, owner.intentId],
  )).rows[0];
  assert.equal(typeof uploadRow?.filename, "string");
  const afterUploadObjects = await objectKeys();
  assert.equal(afterUploadObjects.length, baselineObjects.length + 1);
  assert.equal(afterUploadObjects.includes(uploadRow.filename), true);

  const previewPath = `/api/storefront/checkout-intents/current/uploads/${uploadId}/preview`;
  stage = "OWNER_PREVIEW";
  const ownerPreview = await request(previewPath, owner.cookie);
  assert.equal(ownerPreview.status, 200);
  assert.equal(ownerPreview.redirected, false);
  assert.equal(new URL(ownerPreview.url).origin, origin);
  assert.equal(ownerPreview.headers.get("content-type"), "image/png");
  assert.equal(ownerPreview.headers.get("content-length"), String(png.length));
  assert.equal(ownerPreview.headers.get("content-disposition"), "inline");
  assert.equal(ownerPreview.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(ownerPreview.headers.get("pragma"), "no-cache");
  assert.equal(ownerPreview.headers.get("x-content-type-options"), "nosniff");
  assert.equal(ownerPreview.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(ownerPreview.headers.has("access-control-allow-origin"), false);
  assert.deepEqual(Buffer.from(await ownerPreview.arrayBuffer()), png);
  assert.doesNotMatch(
    `${ownerPreview.url}${JSON.stringify(Object.fromEntries(ownerPreview.headers))}`,
    /supabase|signed|order-uploads|access[_-]?key|secret/i,
  );
  console.log("PASS_OWNER_EXACT_PRIVATE_PREVIEW");

  stage = "DENY_OTHER_BROWSER";
  const otherPreview = await request(
    `${previewPath}?intentId=${owner.intentId}`,
    other.cookie,
    { headers: { "x-checkout-intent-id": String(owner.intentId) } },
  );
  assert.equal(otherPreview.status, 404);
  assert.deepEqual(await otherPreview.json(), { error: { code: "UPLOAD_NOT_FOUND" } });
  const missingCredential = await request(previewPath, undefined);
  assert.equal(missingCredential.status, 401);
  assert.deepEqual(await missingCredential.json(), { error: { code: "UNAUTHORIZED" } });
  const guessed = await request(
    "/api/storefront/checkout-intents/current/uploads/2147483000/preview",
    owner.cookie,
  );
  assert.equal(guessed.status, 404);
  assert.deepEqual(await guessed.json(), { error: { code: "UPLOAD_NOT_FOUND" } });
  console.log("PASS_CROSS_INTENT_AND_GUESSED_IDS_DENIED");

  stage = "DELETE_AND_REVOKE_PREVIEW";
  assert.deepEqual(
    await deletePhoto(uploadId, { fetchImpl: (path, init) => request(path, owner.cookie, init) }),
    { kind: "deleted" },
  );
  const deletedPreview = await request(previewPath, owner.cookie);
  assert.equal(deletedPreview.status, 404);
  assert.deepEqual(await deletedPreview.json(), { error: { code: "UPLOAD_NOT_FOUND" } });
  assert.deepEqual(await objectKeys(), baselineObjects);
  console.log("PASS_DELETED_UPLOAD_PREVIEW_REVOKED");
} catch {
  failed = true;
  console.error(`PREVIEW_LIFECYCLE_FAILED_AT=${stage}`);
} finally {
  stage = "CLEANUP_SYNTHETIC_ONLY";
  try {
    if (payload) {
      for (const intentId of syntheticIntentIds) {
        const uploads = await payload.find({
          collection: "order-uploads",
          depth: 0,
          limit: 3,
          overrideAccess: true,
          pagination: false,
          where: { checkoutIntent: { equals: intentId } },
        });
        for (const upload of uploads.docs) {
          await payload.delete({
            collection: "order-uploads",
            id: upload.id,
            overrideAccess: true,
          });
        }
        await payload.delete({
          collection: "checkout-intents",
          id: intentId,
          overrideAccess: true,
        });
      }
    }
  } catch {
    failed = true;
    console.error("SYNTHETIC_CLEANUP_FAILED");
  }

  try {
    if (baselineRows && baselineObjects) {
      const finalRows = await rowCounts();
      const finalObjects = await objectKeys();
      console.log(`FINAL_COUNTS=${JSON.stringify({ ...finalRows, storageObjects: finalObjects.length })}`);
      assert.deepEqual(finalRows, baselineRows);
      assert.deepEqual(finalObjects, baselineObjects);
      console.log("PASS_BASELINE_RESTORED_EXACTLY");
    }
  } catch {
    failed = true;
    console.error("BASELINE_RESTORATION_FAILED");
  }

  if (connected) await database.end().catch(() => { failed = true; });
  storage.destroy();
  await Promise.race([
    payload?.destroy().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  process.exit(failed ? 1 : 0);
}
