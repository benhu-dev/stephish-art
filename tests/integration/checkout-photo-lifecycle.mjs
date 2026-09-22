import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import nextEnvironment from "@next/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { getPayload } from "payload";

import { uploadPhoto, deletePhoto } from "../../src/features/checkout/checkoutPhotoClient.ts";
import { parseCheckoutIntentCookie } from "../../src/server/storefront/checkoutIntentCookie.ts";

const { loadEnvConfig } = nextEnvironment;
loadEnvConfig(fileURLToPath(new URL("../../", import.meta.url)), true, { error() {}, info() {} });
const baseURL = process.argv[2] ?? "http://127.0.0.1:3000";
const origin = new URL(baseURL).origin;
const runId = `unit-2-12-${randomUUID()}`;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
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
let payload;
let intentId;
let cookie;
let baselineRows;
let baselineObjects;
let stage = "PREFLIGHT";
let failed = false;
let connected = false;

const rowCounts = async () => (await database.query(
  "SELECT (SELECT count(*)::int FROM public.checkout_intents) AS intents, " +
  "(SELECT count(*)::int FROM public.order_uploads) AS uploads, " +
  "(SELECT count(*)::int FROM public.customers) AS customers, " +
  "(SELECT count(*)::int FROM public.orders) AS orders",
)).rows[0];
const objectKeys = async () => {
  const keys = [];
  let token;
  do {
    const page = await storage.send(new ListObjectsV2Command({
      Bucket: process.env.SUPABASE_STORAGE_BUCKET,
      ContinuationToken: token,
    }));
    keys.push(...(page.Contents ?? []).map(({ Key }) => Key));
    token = page.NextContinuationToken;
  } while (token);
  return keys.sort();
};
const uploadsForIntent = async () => (await database.query(
  "SELECT id, position, filename FROM public.order_uploads WHERE checkout_intent_id = $1 ORDER BY position",
  [intentId],
)).rows;
const browserFetch = (input, init) => fetch(new URL(input, baseURL), {
  ...init,
  headers: { ...init?.headers, origin, ...(cookie ? { cookie } : {}) },
});

try {
  await database.connect();
  connected = true;
  const { default: config } = await import("../../src/payload.config.ts");
  payload = await getPayload({ config });
  baselineRows = await rowCounts();
  baselineObjects = await objectKeys();
  const baselineIds = new Set((await database.query("SELECT id FROM public.checkout_intents")).rows.map(({ id }) => Number(id)));
  console.log(`START_COUNTS=${JSON.stringify({ ...baselineRows, storageObjects: baselineObjects.length })}`);

  stage = "CREATE_SYNTHETIC_INTENT";
  const created = await browserFetch("/api/storefront/checkout-intents", {
    method: "POST",
    body: JSON.stringify({ amountCents: 927 }),
    headers: { "content-type": "application/json" },
  });
  assert.equal(created.status, 201);
  cookie = created.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie);
  const credential = parseCheckoutIntentCookie(cookie);
  assert.equal(credential.kind, "valid");
  intentId = credential.credential.intentId;
  assert.equal(baselineIds.has(intentId), false);
  assert.equal((await rowCounts()).intents, baselineRows.intents + 1);

  stage = "UPLOAD_THROUGH_FRONTEND_CONTRACT";
  const file = new File([png], `${runId}.png`, { type: "image/png" });
  const uploaded = await uploadPhoto(file, 1, { fetchImpl: browserFetch });
  assert.equal(uploaded.kind, "confirmed");
  assert.equal(uploaded.state.uploads.length, 1);
  const rows = await uploadsForIntent();
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].position), 1);
  assert.equal(Number(rows[0].id), uploaded.state.uploads[0].id);
  assert.equal((await rowCounts()).uploads, baselineRows.uploads + 1);
  const afterUpload = await objectKeys();
  assert.equal(afterUpload.length, baselineObjects.length + 1);
  assert.equal(afterUpload.includes(rows[0].filename), true);
  console.log("PASS_SYNTHETIC_UPLOAD_DB_AND_PRIVATE_STORAGE");

  stage = "DELETE_THROUGH_FRONTEND_CONTRACT";
  assert.deepEqual(await deletePhoto(Number(rows[0].id), { fetchImpl: browserFetch }), { kind: "deleted" });
  assert.equal((await uploadsForIntent()).length, 0);
  assert.deepEqual(await objectKeys(), baselineObjects);
  console.log("PASS_SYNTHETIC_DELETE_DB_AND_PRIVATE_STORAGE");
} catch {
  failed = true;
  console.error(`LIFECYCLE_FAILED_AT=${stage}`);
} finally {
  stage = "CLEANUP_SYNTHETIC_ONLY";
  try {
    if (intentId && payload) {
      const remaining = await uploadsForIntent();
      for (const row of remaining) {
        await payload.delete({ collection: "order-uploads", id: Number(row.id), overrideAccess: true });
      }
      await payload.delete({ collection: "checkout-intents", id: intentId, overrideAccess: true });
    }
  } catch {
    failed = true;
    console.error("SYNTHETIC_CLEANUP_FAILED");
  }
  try {
    if (baselineRows) {
      const finalRows = await rowCounts();
      const finalObjects = await objectKeys();
      console.log(`FINAL_COUNTS=${JSON.stringify({ ...finalRows, storageObjects: finalObjects.length })}`);
      assert.deepEqual(finalRows, baselineRows, `${stage}: database baseline changed`);
      assert.deepEqual(finalObjects, baselineObjects, `${stage}: private Storage baseline changed`);
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
