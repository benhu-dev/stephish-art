import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import nextEnvironment from "@next/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createLocalReq, getPayload } from "payload";

import { issueCheckoutIntentCredential } from "../../src/server/checkout-intents/checkoutIntentCredentials.ts";
import { runCheckoutCleanup } from "../../src/server/checkout-cleanup/checkoutCleanupService.ts";
import { deleteOrderUploadObject } from "../../src/server/storage/orderUploadObjectStorage.ts";

const { loadEnvConfig } = nextEnvironment;
loadEnvConfig(fileURLToPath(new URL("../../", import.meta.url)), true, {
  error() {},
  info() {},
});

const runId = `unit-2-15-${randomUUID()}`;
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

let payload;
let baselineCounts;
let baselineObjects;
let completed = false;
let cleanupFailed = false;
let stage = "INITIALIZE";
const taskIntentIds = new Set();
const taskUploadIds = new Set();
const taskObjectKeys = new Set();

const counts = async () =>
  (
    await database.query(
      "SELECT " +
        "(SELECT count(*)::int FROM public.checkout_intents) AS checkout_intents, " +
        "(SELECT count(*)::int FROM public.order_uploads) AS order_uploads, " +
        "(SELECT count(*)::int FROM public.customers) AS customers, " +
        "(SELECT count(*)::int FROM public.orders) AS orders",
    )
  ).rows[0];

const objectKeys = async () =>
  (
    (
      await storage.send(
        new ListObjectsV2Command({
          Bucket: process.env.SUPABASE_STORAGE_BUCKET,
          MaxKeys: 1000,
        }),
      )
    ).Contents ?? []
  )
    .map(({ Key }) => Key)
    .sort();

const createFixture = async (label, createdAt) => {
  const issued = issueCheckoutIntentCredential(createdAt);
  const intent = await payload.create({
    collection: "checkout-intents",
    data: {
      ...issued.createData,
      amountCents: 900,
      status: "draft",
    },
    depth: 0,
    overrideAccess: true,
  });
  const intentId = Number(intent.id);
  taskIntentIds.add(intentId);
  const upload = await payload.create({
    collection: "order-uploads",
    data: { checkoutIntent: intentId, position: 1 },
    depth: 0,
    file: {
      data: png,
      mimetype: "image/png",
      name: `${runId}-${label}.png`,
      size: png.length,
    },
    overrideAccess: true,
  });
  taskUploadIds.add(Number(upload.id));
  taskObjectKeys.add(upload.filename);
  return {
    deleteAfter: String(intent.deleteAfter),
    id: intentId,
    objectKey: upload.filename,
    status: String(intent.status),
    stripeCheckoutSessionId: null,
    uploadId: Number(upload.id),
  };
};

try {
  stage = "CONNECT";
  await database.connect();
  const { default: config } = await import("../../src/payload.config.ts");
  payload = await getPayload({ config });
  baselineCounts = await counts();
  baselineObjects = await objectKeys();
  console.log(
    `START_COUNTS=${JSON.stringify({
      ...baselineCounts,
      storageObjects: baselineObjects.length,
    })}`,
  );

  stage = "CREATE_SYNTHETIC_FIXTURES";
  const dueFixture = await createFixture(
    "due",
    new Date("2020-01-01T00:00:00.000Z"),
  );
  const futureFixture = await createFixture(
    "future",
    new Date("2030-01-01T00:00:00.000Z"),
  );

  stage = "EXECUTE_ISOLATED_CLEANUP";
  const request = await createLocalReq({}, payload);
  const summary = await runCheckoutCleanup({
    dependencies: {
      gateway: {
        expireSession: async () => assert.fail("unexpected Stripe expiration"),
        retrieveSession: async () => assert.fail("unexpected Stripe retrieval"),
      },
      listCandidates: async () => [dueFixture],
    },
    execute: true,
    now: new Date("2026-09-27T10:00:00.000Z"),
    request,
  });
  assert.deepEqual(summary, {
    eligible: 1,
    intentsDeleted: 1,
    retryableFailures: 0,
    scanned: 1,
    skippedActive: 0,
    skippedProtected: 0,
    storageObjectsDeleted: 1,
    stripeSessionsExpired: 0,
    uploadRowsDeleted: 1,
  });

  stage = "VERIFY_ISOLATION";
  const dueRows = await database.query(
    "SELECT " +
      "(SELECT count(*)::int FROM public.checkout_intents WHERE id = $1) AS intents, " +
      "(SELECT count(*)::int FROM public.order_uploads WHERE id = $2) AS uploads",
    [dueFixture.id, dueFixture.uploadId],
  );
  assert.deepEqual(dueRows.rows[0], { intents: 0, uploads: 0 });
  const futureRows = await database.query(
    "SELECT " +
      "(SELECT count(*)::int FROM public.checkout_intents WHERE id = $1) AS intents, " +
      "(SELECT count(*)::int FROM public.order_uploads WHERE id = $2) AS uploads",
    [futureFixture.id, futureFixture.uploadId],
  );
  assert.deepEqual(futureRows.rows[0], { intents: 1, uploads: 1 });
  const objectsAfter = await objectKeys();
  assert.equal(objectsAfter.includes(dueFixture.objectKey), false);
  assert.equal(objectsAfter.includes(futureFixture.objectKey), true);
  assert.equal((await counts()).customers, baselineCounts.customers);
  assert.equal((await counts()).orders, baselineCounts.orders);
  completed = true;
} catch {
  console.error(`CHECKOUT_CLEANUP_LIFECYCLE_FAILURE_STAGE=${stage}`);
  process.exitCode = 1;
} finally {
  stage = "CLEANUP_TASK_FIXTURES_ONLY";
  try {
    if (payload) {
      for (const uploadId of taskUploadIds) {
        await payload
          .delete({
            collection: "order-uploads",
            id: uploadId,
            overrideAccess: true,
          })
          .catch(() => {});
      }
      for (const intentId of taskIntentIds) {
        await payload
          .delete({
            collection: "checkout-intents",
            id: intentId,
            overrideAccess: true,
          })
          .catch(() => {});
      }
      for (const key of taskObjectKeys) {
        await deleteOrderUploadObject(key);
      }
    }
    const finalCounts = await counts();
    const finalObjects = await objectKeys();
    assert.deepEqual(finalCounts, baselineCounts);
    assert.deepEqual(finalObjects, baselineObjects);
    console.log(
      `FINAL_COUNTS=${JSON.stringify({
        ...finalCounts,
        storageObjects: finalObjects.length,
      })}`,
    );
  } catch {
    cleanupFailed = true;
    console.error("CHECKOUT_CLEANUP_SYNTHETIC_CLEANUP=FAIL");
  }
  await database.end().catch(() => {
    cleanupFailed = true;
  });
  storage.destroy();
  await Promise.race([
    payload?.destroy().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (completed && !cleanupFailed && !process.exitCode) {
    console.log("CHECKOUT_CLEANUP_LIFECYCLE=PASS");
    console.log("SYNTHETIC_DUE_FIXTURE_DELETED=PASS");
    console.log("SYNTHETIC_FUTURE_FIXTURE_PRESERVED=PASS");
    console.log("PREEXISTING_DATA_UNCHANGED=PASS");
  } else {
    process.exitCode = 1;
  }
  process.exit(process.exitCode ?? 0);
}
