import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import nextEnvironment from "@next/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { getPayload } from "payload";

import { issueCheckoutIntentCredential } from "../../src/server/checkout-intents/checkoutIntentCredentials.ts";

const { loadEnvConfig } = nextEnvironment;
const { Client } = pg;
const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const baseURL = process.argv[2] ?? "http://127.0.0.1:3000";
const runID = randomUUID().replaceAll("-", "");

let database;
let payload;
let storage;
let stage = "INITIALIZE";
let completed = false;
let cleanupFailed = false;
let baselineCounts;
let baselineObjects;
const customerIDs = new Set();
const intentIDs = new Set();
const orderIDs = new Set();

const countRows = async () =>
  (
    await database.query(
      "SELECT " +
        "(SELECT count(*)::int FROM public.checkout_intents) AS checkout_intents, " +
        "(SELECT count(*)::int FROM public.order_uploads) AS order_uploads, " +
        "(SELECT count(*)::int FROM public.customers) AS customers, " +
        "(SELECT count(*)::int FROM public.orders) AS orders, " +
        "(SELECT count(*)::int FROM public.stripe_events) AS stripe_events",
    )
  ).rows[0];

const listObjects = async () =>
  (
    await storage.send(
      new ListObjectsV2Command({
        Bucket: process.env.SUPABASE_STORAGE_BUCKET,
        MaxKeys: 1000,
      }),
    )
  ).Contents?.map(({ Key }) => Key).sort() ?? [];

const createIntent = async (status, options = {}) => {
  const needsReservation = [
    "checkout_pending",
    "checkout_created",
    "completed",
  ].includes(status);
  const needsSession = ["checkout_created", "completed"].includes(status);
  const sessionID = needsSession ? `cs_test_status_${randomUUID()}` : null;
  const now = new Date();
  const issued = issueCheckoutIntentCredential(
    options.expiredCredential
      ? new Date(Date.now() - 25 * 60 * 60 * 1000)
      : now,
  );
  const document = await payload.create({
    collection: "checkout-intents",
    data: {
      ...issued.createData,
      amountCents: 800,
      ...(needsReservation || options.withSnapshots
        ? { shippingAmountCents: 100, totalAmountCents: 900 }
        : {}),
      ...(needsReservation
        ? {
            checkoutAttemptId: randomUUID(),
            checkoutStartedAt: now.toISOString(),
          }
        : {}),
      ...(needsSession
        ? {
            stripeCheckoutSessionExpiresAt: new Date(
              now.getTime() + 60 * 60 * 1000,
            ).toISOString(),
            stripeCheckoutSessionId: sessionID,
          }
        : {}),
      status,
    },
    depth: 0,
    overrideAccess: true,
  });
  const id = Number(document.id);
  intentIDs.add(id);
  return {
    cookie: `stephish_checkout_intent=v1.${id}.${issued.rawToken}`,
    id,
    sessionID,
  };
};

const statusRequest = async (cookie, suffix = "", headers = {}) => {
  const response = await fetch(
    `${baseURL}/api/storefront/checkout-intents/current/status${suffix}`,
    {
      headers: {
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
    },
  );
  return { body: await response.json(), response };
};

loadEnvConfig(projectRoot, true, { error() {}, info() {} });

try {
  stage = "CONNECT";
  const { default: config } = await import("../../src/payload.config.ts");
  payload = await getPayload({ config });
  database = new Client({ connectionString: process.env.DATABASE_URL });
  await database.connect();
  storage = new S3Client({
    credentials: {
      accessKeyId: process.env.SUPABASE_STORAGE_ACCESS_KEY_ID,
      secretAccessKey: process.env.SUPABASE_STORAGE_SECRET_ACCESS_KEY,
    },
    endpoint: process.env.SUPABASE_STORAGE_ENDPOINT,
    forcePathStyle: true,
    region: process.env.SUPABASE_STORAGE_REGION,
  });
  baselineCounts = await countRows();
  baselineObjects = await listObjects();

  stage = "CREATE_FIXTURES";
  stage = "CREATE_DRAFT";
  const draft = await createIntent("draft");
  stage = "CREATE_PENDING";
  const pending = await createIntent("checkout_pending");
  stage = "CREATE_CREATED";
  const created = await createIntent("checkout_created", { withSnapshots: true });
  stage = "CREATE_EXPIRED";
  const expired = await createIntent("expired");
  stage = "CREATE_COMPLETED";
  const completedIntent = await createIntent("completed");
  stage = "CREATE_MISSING_ORDER";
  const missingOrder = await createIntent("completed");
  stage = "CREATE_EXPIRED_CREDENTIAL";
  const expiredCredential = await createIntent("draft", {
    expiredCredential: true,
  });
  stage = "CREATE_CROSS_INTENT";
  const crossIntent = await createIntent("draft");

  stage = "CREATE_CUSTOMER";
  const customer = await payload.create({
    collection: "customers",
    data: {
      email: `unit-2-9-${runID}@example.invalid`,
      fullName: "Unit 2.9 Fixture",
      stripeCustomerId: `cus_status_${runID}`,
    },
    depth: 0,
    overrideAccess: true,
  });
  customerIDs.add(Number(customer.id));
  stage = "CREATE_ORDER";
  const order = await payload.create({
    collection: "orders",
    data: {
      amountCents: 900,
      checkoutIntent: completedIntent.id,
      contactEmail: `unit-2-9-${runID}@example.invalid`,
      currency: "usd",
      customer: customer.id,
      orderStatus: "new",
      paidAt: new Date().toISOString(),
      paymentStatus: "paid",
      shippingAddress: {
        city: "Testville",
        country: "US",
        line1: "1 Fixture Way",
        postalCode: "00000",
        recipientName: "Unit Fixture",
        state: "CA",
      },
      stripeCheckoutSessionId: completedIntent.sessionID,
      stripePaymentIntentId: `pi_status_${runID}`,
    },
    depth: 0,
    overrideAccess: true,
  });
  orderIDs.add(Number(order.id));

  stage = "STATE_MAPPING";
  const fixturesPresent = await countRows();
  const expectedStates = [
    [draft.cookie, { state: "not_started" }],
    [pending.cookie, { state: "processing" }],
    [created.cookie, { state: "processing" }],
    [expired.cookie, { state: "expired" }],
  ];
  for (const [credential, expected] of expectedStates) {
    const result = await statusRequest(credential);
    assert.equal(result.response.status, 200);
    assert.equal(result.response.headers.get("cache-control"), "no-store");
    assert.deepEqual(result.body, expected);
  }

  stage = "CONFIRMED_RESPONSE";
  const confirmed = await statusRequest(
    completedIntent.cookie,
    "?session_id=cs_test_forged&order_id=999999",
    { "x-stripe-session-id": "cs_test_forged" },
  );
  assert.equal(confirmed.response.status, 200);
  assert.deepEqual(confirmed.body, {
    currency: "usd",
    shippingAmountCents: 100,
    state: "confirmed",
    subtotalAmountCents: 800,
    totalAmountCents: 900,
  });
  const safeBody = JSON.stringify(confirmed.body).toLowerCase();
  for (const forbidden of [
    runID,
    "stripe",
    "email",
    "address",
    "upload",
    "session",
    "paymentintent",
    "customer",
  ]) {
    assert.equal(safeBody.includes(forbidden.toLowerCase()), false);
  }

  stage = "GENERIC_DENIALS";
  const genericDenials = [
    await statusRequest(null),
    await statusRequest("stephish_checkout_intent=malformed"),
    await statusRequest(
      `stephish_checkout_intent=v1.${draft.id}.${"Z".repeat(43)}`,
    ),
    await statusRequest(expiredCredential.cookie),
    await statusRequest(
      `stephish_checkout_intent=v1.${crossIntent.id}.${draft.cookie.split(".").at(-1)}`,
    ),
    await statusRequest(`stephish_checkout_intent=v1.2147483647.${"Z".repeat(43)}`),
  ];
  for (const result of genericDenials) {
    assert.equal(result.response.status, 401);
    assert.equal(result.response.headers.get("cache-control"), "no-store");
    assert.deepEqual(result.body, { error: { code: "UNAUTHORIZED" } });
  }

  stage = "INCONSISTENT_ORDER";
  const inconsistent = await statusRequest(missingOrder.cookie);
  assert.equal(inconsistent.response.status, 503);
  assert.deepEqual(inconsistent.body, {
    error: { code: "STATUS_UNAVAILABLE" },
  });
  assert.deepEqual(await countRows(), fixturesPresent);
  assert.deepEqual(await listObjects(), baselineObjects);
  completed = true;
} catch {
  console.error(`CHECKOUT_STATUS_LIFECYCLE_FAILURE_STAGE=${stage}`);
  console.error("CHECKOUT_STATUS_LIFECYCLE_FAILURE=REDACTED");
  process.exitCode = 1;
} finally {
  if (payload) {
    try {
      for (const id of orderIDs) {
        await payload.delete({ collection: "orders", id, overrideAccess: true });
      }
      for (const id of customerIDs) {
        await payload.delete({ collection: "customers", id, overrideAccess: true });
      }
      for (const id of intentIDs) {
        await payload.delete({
          collection: "checkout-intents",
          id,
          overrideAccess: true,
        });
      }
    } catch {
      cleanupFailed = true;
    }
  }

  let finalCounts;
  let finalObjects;
  try {
    finalCounts = database ? await countRows() : undefined;
    finalObjects = storage ? await listObjects() : undefined;
    assert.deepEqual(finalCounts, baselineCounts);
    assert.deepEqual(finalObjects, baselineObjects);
  } catch {
    cleanupFailed = true;
  }

  await database?.end().catch(() => {});
  storage?.destroy();
  await Promise.race([
    payload?.destroy().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);

  if (completed && !cleanupFailed && !process.exitCode) {
    console.log("CHECKOUT_STATUS_LIFECYCLE_RESULT=PASS");
    console.log("COOKIE_AND_IDENTIFIER_AUTHORITY=PASS");
    console.log("READ_ONLY_AND_DATA_MINIMIZATION=PASS");
    console.log(`FINAL_CHECKOUT_INTENT_COUNT=${finalCounts.checkout_intents}`);
    console.log(`FINAL_ORDER_UPLOAD_COUNT=${finalCounts.order_uploads}`);
    console.log(`FINAL_BUCKET_OBJECT_COUNT=${finalObjects.length}`);
    console.log(`FINAL_CUSTOMER_COUNT=${finalCounts.customers}`);
    console.log(`FINAL_ORDER_COUNT=${finalCounts.orders}`);
    console.log(`FINAL_STRIPE_EVENT_COUNT=${finalCounts.stripe_events}`);
  } else if (cleanupFailed) {
    console.log("CHECKOUT_STATUS_LIFECYCLE_CLEANUP=FAIL");
    process.exitCode = 1;
  }
  process.exit(process.exitCode ?? 0);
}
