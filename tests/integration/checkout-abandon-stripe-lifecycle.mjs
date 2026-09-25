import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import nextEnvironment from "@next/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { getPayload } from "payload";
import Stripe from "stripe";

import { issueCheckoutIntentCredential } from "../../src/server/checkout-intents/checkoutIntentCredentials.ts";
import { serializeCheckoutIntentCookie } from "../../src/server/storefront/checkoutIntentCookie.ts";

const { loadEnvConfig } = nextEnvironment;
loadEnvConfig(fileURLToPath(new URL("../../", import.meta.url)), true, { error() {}, info() {} });

const baseURL = process.argv[2] ?? "http://127.0.0.1:3000";
const origin = new URL(baseURL).origin;
const runId = `unit-2-14-1-${randomUUID()}`;
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
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { maxNetworkRetries: 0 });

let payload;
let intentId;
let uploadId;
let objectKey;
let stripeSessionId;
let baselineCounts;
let baselineObjects;
let passed = false;
let cleanupFailed = false;
let stage = "INITIALIZE";

const counts = async () => (await database.query(
  "SELECT " +
    "(SELECT count(*)::int FROM public.checkout_intents) AS checkout_intents, " +
    "(SELECT count(*)::int FROM public.order_uploads) AS order_uploads, " +
    "(SELECT count(*)::int FROM public.customers) AS customers, " +
    "(SELECT count(*)::int FROM public.orders) AS orders",
)).rows[0];

const objectKeys = async () => ((await storage.send(new ListObjectsV2Command({
  Bucket: process.env.SUPABASE_STORAGE_BUCKET,
  MaxKeys: 1000,
}))).Contents ?? []).map(({ Key }) => Key).sort();

try {
  stage = "CONNECT";
  assert.equal(process.env.STRIPE_SECRET_KEY.startsWith("sk_test_"), true);
  await database.connect();
  const { default: config } = await import("../../src/payload.config.ts");
  payload = await getPayload({ config });
  baselineCounts = await counts();
  baselineObjects = await objectKeys();
  console.log(`START_COUNTS=${JSON.stringify({ ...baselineCounts, storageObjects: baselineObjects.length })}`);

  stage = "CREATE_SYNTHETIC_FIXTURE";
  const settings = await payload.findGlobal({ overrideAccess: true, slug: "checkout-settings" });
  const amountCents = Math.max(500, Number(settings.minimumAmountCents)) + 123;
  const issued = issueCheckoutIntentCredential();
  const expiresAt = new Date(Date.now() + 23 * 60 * 60 * 1000);
  const intent = await payload.create({
    collection: "checkout-intents",
    data: {
      ...issued.createData,
      amountCents,
      expiresAt: expiresAt.toISOString(),
      status: "draft",
    },
    depth: 0,
    overrideAccess: true,
  });
  intentId = Number(intent.id);
  const upload = await payload.create({
    collection: "order-uploads",
    data: { checkoutIntent: intentId, position: 1 },
    depth: 0,
    file: { data: png, mimetype: "image/png", name: `${runId}.png`, size: png.length },
    overrideAccess: true,
  });
  uploadId = Number(upload.id);
  objectKey = upload.filename;
  const cookie = serializeCheckoutIntentCookie(
    { intentId, rawToken: issued.rawToken },
    expiresAt,
    true,
  ).split(";", 1)[0];

  stage = "CREATE_ISOLATED_STRIPE_SESSION";
  const sessionResponse = await fetch(new URL(
    "/api/storefront/checkout-intents/current/checkout-session",
    baseURL,
  ), {
    body: "{}",
    headers: { "content-type": "application/json", cookie, origin },
    method: "POST",
  });
  assert.equal(sessionResponse.status, 201);
  const rowBefore = (await database.query(
    "SELECT status, stripe_checkout_session_id FROM public.checkout_intents WHERE id = $1",
    [intentId],
  )).rows[0];
  assert.equal(rowBefore.status, "checkout_created");
  stripeSessionId = rowBefore.stripe_checkout_session_id;
  assert.equal((await stripe.checkout.sessions.retrieve(stripeSessionId)).status, "open");

  stage = "EXPLICIT_ABANDON";
  const abandonResponse = await fetch(new URL(
    "/api/storefront/checkout-intents/current/abandon",
    baseURL,
  ), {
    body: "{}",
    headers: { "content-type": "application/json", cookie, origin },
    method: "POST",
  });
  assert.equal(abandonResponse.status, 204);
  assert.equal(abandonResponse.headers.get("cache-control"), "no-store");
  assert.match(abandonResponse.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal((await stripe.checkout.sessions.retrieve(stripeSessionId)).status, "expired");

  stage = "VERIFY_LOCAL_RETENTION";
  const rowAfter = (await database.query(
    "SELECT status FROM public.checkout_intents WHERE id = $1",
    [intentId],
  )).rows[0];
  assert.equal(rowAfter.status, "expired");
  assert.equal(Number((await database.query(
    "SELECT count(*)::int AS count FROM public.order_uploads WHERE id = $1 AND checkout_intent_id = $2",
    [uploadId, intentId],
  )).rows[0].count), 1);
  assert.equal((await objectKeys()).includes(objectKey), true);
  const afterCounts = await counts();
  assert.equal(afterCounts.checkout_intents, baselineCounts.checkout_intents + 1);
  assert.equal(afterCounts.order_uploads, baselineCounts.order_uploads + 1);
  assert.equal(afterCounts.customers, baselineCounts.customers);
  assert.equal(afterCounts.orders, baselineCounts.orders);
  passed = true;
} catch {
  console.error(`CHECKOUT_ABANDON_STRIPE_FAILURE_STAGE=${stage}`);
  process.exitCode = 1;
} finally {
  stage = "CLEANUP_SYNTHETIC_ONLY";
  try {
    if (stripeSessionId) {
      const session = await stripe.checkout.sessions.retrieve(stripeSessionId);
      if (session.status === "open") await stripe.checkout.sessions.expire(stripeSessionId);
    }
    if (payload && uploadId) {
      await payload.delete({ collection: "order-uploads", id: uploadId, overrideAccess: true });
    }
    if (payload && intentId) {
      await payload.delete({ collection: "checkout-intents", id: intentId, overrideAccess: true });
    }
    const finalCounts = await counts();
    const finalObjects = await objectKeys();
    assert.deepEqual(finalCounts, baselineCounts);
    assert.deepEqual(finalObjects, baselineObjects);
    console.log(`FINAL_COUNTS=${JSON.stringify({ ...finalCounts, storageObjects: finalObjects.length })}`);
  } catch {
    cleanupFailed = true;
    console.error("CHECKOUT_ABANDON_SYNTHETIC_CLEANUP=FAIL");
  }
  await database.end().catch(() => { cleanupFailed = true; });
  storage.destroy();
  await Promise.race([
    payload?.destroy().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (passed && !cleanupFailed && !process.exitCode) {
    console.log("CHECKOUT_ABANDON_STRIPE_LIFECYCLE=PASS");
    console.log("STRIPE_SESSION_EXPIRED_BEFORE_LOCAL_FINALIZATION=PASS");
    console.log("INTENT_AND_UPLOAD_RETENTION_UNTIL_TEST_CLEANUP=PASS");
  } else {
    process.exitCode = 1;
  }
  process.exit(process.exitCode ?? 0);
}
