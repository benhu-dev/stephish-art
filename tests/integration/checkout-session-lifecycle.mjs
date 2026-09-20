import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import nextEnvironment from "@next/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createLocalReq, getPayload } from "payload";
import Stripe from "stripe";

import { issueCheckoutIntentCredential } from "../../src/server/checkout-intents/checkoutIntentCredentials.ts";
import {
  createOrResumeStripeCheckoutSession,
} from "../../src/server/storefront/checkoutSessionService.ts";
import {
  serializeCheckoutIntentCookie,
} from "../../src/server/storefront/checkoutIntentCookie.ts";
import { createOrResumeCheckoutIntent } from "../../src/server/storefront/checkoutIntentService.ts";
import { deleteCheckoutIntentFile } from "../../src/server/storefront/orderUploadService.ts";
import { StorefrontApiError } from "../../src/server/storefront/storefrontApiError.ts";
import { stripeCheckoutIdempotencyKey } from "../../src/server/stripe/stripeCheckoutGateway.ts";

const { loadEnvConfig } = nextEnvironment;
const { Client } = pg;
const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const baseURL = process.argv[2] ?? "http://127.0.0.1:3000";
const requestOrigin = new URL(baseURL).origin;
const testRun = `unit-2-7-${randomUUID()}`;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

let payload;
let database;
let storage;
let stripe;
let checkoutSettingsBefore;
let stage = "INITIALIZE";
let completed = false;
let cleanupFailed = false;
const intentIDs = new Set();
const objectKeys = new Set();
const stripeSessionIDs = new Set();

const countRows = async () =>
  (
    await database.query(
      "SELECT " +
        "(SELECT count(*)::int FROM public.checkout_intents) AS checkout_intents, " +
        "(SELECT count(*)::int FROM public.order_uploads) AS order_uploads, " +
        "(SELECT count(*)::int FROM public.customers) AS customers, " +
        "(SELECT count(*)::int FROM public.orders) AS orders",
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
  ).Contents ?? [];

const readIntent = async (intentId) =>
  (
    await database.query(
      "SELECT id, status, amount_cents::int, checkout_attempt_id, " +
        "shipping_amount_cents::int, total_amount_cents::int, " +
        "stripe_checkout_session_id, stripe_checkout_session_expires_at " +
        "FROM public.checkout_intents WHERE id = $1",
      [intentId],
    )
  ).rows[0];

const createRequest = () => createLocalReq({}, payload);

const createFixture = async ({
  amountCents = 800,
  expiresInMs = 23 * 60 * 60 * 1000,
  upload = true,
} = {}) => {
  const createdAt = new Date();
  const issued = issueCheckoutIntentCredential(createdAt);
  const expiresAt = new Date(createdAt.getTime() + expiresInMs);
  const document = await payload.create({
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
  const intentId = Number(document.id);
  intentIDs.add(intentId);
  const credential = { intentId, rawToken: issued.rawToken };
  let uploadDocument;
  if (upload) {
    uploadDocument = await payload.create({
      collection: "order-uploads",
      data: { checkoutIntent: intentId, position: 1 },
      depth: 0,
      file: {
        data: png,
        mimetype: "image/png",
        name: `${testRun}-${intentId}.png`,
        size: png.length,
      },
      overrideAccess: true,
    });
    if (uploadDocument.filename) objectKeys.add(uploadDocument.filename);
  }
  return {
    cookie: serializeCheckoutIntentCookie(credential, expiresAt, true).split(
      ";",
      1,
    )[0],
    credential,
    intentId,
    uploadDocument,
  };
};

const expectApiError = async (operation, status, code) => {
  await assert.rejects(operation, (error) => {
    assert.equal(error instanceof StorefrontApiError, true);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    return true;
  });
};

class IdempotentStripeDouble {
  constructor() {
    this.createInputs = [];
    this.sessions = new Map();
    this.failAfterCreateOnce = false;
  }

  async createSession(input) {
    this.createInputs.push(structuredClone(input));
    const key = stripeCheckoutIdempotencyKey(input.attemptId);
    let session = this.sessions.get(key);
    if (!session) {
      const id = `cs_test_${randomUUID().replaceAll("-", "")}`;
      session = {
        expiresAt: new Date(input.expiresAtEpochSeconds * 1000).toISOString(),
        expiresAtEpochSeconds: input.expiresAtEpochSeconds,
        id,
        status: "open",
        url: `https://checkout.stripe.com/c/pay/${id}`,
      };
      this.sessions.set(key, session);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
    if (this.failAfterCreateOnce) {
      this.failAfterCreateOnce = false;
      throw new Error("SYNTHETIC_STRIPE_TIMEOUT");
    }
    return structuredClone(session);
  }

  async retrieveSession(id) {
    const session = [...this.sessions.values()].find(
      (candidate) => candidate.id === id,
    );
    assert.ok(session);
    return structuredClone(session);
  }

  setStatus(id, status) {
    const session = [...this.sessions.values()].find(
      (candidate) => candidate.id === id,
    );
    assert.ok(session);
    session.status = status;
    if (status !== "open") session.url = null;
  }
}

const gatewayWithoutTransaction = (request, double) => ({
  createSession: async (input) => {
    assert.equal(request.transactionID, undefined);
    return double.createSession(input);
  },
  retrieveSession: async (id) => {
    assert.equal(request.transactionID, undefined);
    return double.retrieveSession(id);
  },
});

const postCheckout = (fixture, body = "{}", path = "/api/storefront/checkout-intents/current/checkout-session", headers = {}) =>
  fetch(new URL(path, baseURL), {
    body,
    headers: {
      "content-type": "application/json",
      cookie: fixture?.cookie ?? "",
      origin: requestOrigin,
      ...headers,
    },
    method: "POST",
  });

const assertNoStore = (response) =>
  assert.equal(response.headers.get("cache-control"), "no-store");

loadEnvConfig(projectRoot, true, { error() {}, info() {} });

try {
  stage = "CONNECT";
  assert.equal(process.env.STRIPE_SECRET_KEY.startsWith("sk_test_"), true);
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
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { maxNetworkRetries: 0 });

  stage = "BASELINE";
  assert.deepEqual(await countRows(), {
    checkout_intents: 0,
    customers: 0,
    order_uploads: 0,
    orders: 0,
  });
  assert.equal((await listObjects()).length, 0);
  checkoutSettingsBefore = (
    await database.query("SELECT * FROM public.checkout_settings ORDER BY id")
  ).rows[0];
  assert.ok(checkoutSettingsBefore);
  await payload.updateGlobal({
    data: { minimumAmountCents: 700, shippingFeeCents: 125 },
    overrideAccess: true,
    slug: "checkout-settings",
  });

  stage = "DETERMINISTIC_DENIALS";
  const missingUpload = await createFixture({ upload: false });
  stage = "DENIAL_MISSING_UPLOAD";
  await expectApiError(
    async () =>
      createOrResumeStripeCheckoutSession({
        credential: missingUpload.credential,
        gateway: new IdempotentStripeDouble(),
        request: await createRequest(),
      }),
    422,
    "VALID_UPLOAD_REQUIRED",
  );
  const belowMinimum = await createFixture({ amountCents: 699 });
  stage = "DENIAL_BELOW_MINIMUM";
  await expectApiError(
    async () =>
      createOrResumeStripeCheckoutSession({
        credential: belowMinimum.credential,
        gateway: new IdempotentStripeDouble(),
        request: await createRequest(),
      }),
    422,
    "AMOUNT_BELOW_MINIMUM",
  );
  const expiring = await createFixture({ expiresInMs: 29 * 60 * 1000 });
  stage = "DENIAL_EXPIRING_INTENT";
  await expectApiError(
    async () =>
      createOrResumeStripeCheckoutSession({
        credential: expiring.credential,
        gateway: new IdempotentStripeDouble(),
        request: await createRequest(),
      }),
    410,
    "INTENT_EXPIRED",
  );
  assert.equal((await readIntent(expiring.intentId)).status, "expired");

  stage = "CONCURRENCY_AND_IMMUTABILITY";
  const concurrent = await createFixture({ amountCents: 725 });
  const concurrentDouble = new IdempotentStripeDouble();
  const firstRequest = await createRequest();
  const secondRequest = await createRequest();
  const concurrentResults = await Promise.all([
    createOrResumeStripeCheckoutSession({
      credential: concurrent.credential,
      gateway: gatewayWithoutTransaction(firstRequest, concurrentDouble),
      request: firstRequest,
    }),
    createOrResumeStripeCheckoutSession({
      credential: concurrent.credential,
      gateway: gatewayWithoutTransaction(secondRequest, concurrentDouble),
      request: secondRequest,
    }),
  ]);
  assert.equal(concurrentDouble.sessions.size, 1);
  assert.deepEqual(
    concurrentResults.map(({ created }) => created).sort(),
    [false, true],
  );
  assert.equal(
    new Set(concurrentDouble.createInputs.map(({ attemptId }) => attemptId)).size,
    1,
  );
  const concurrentRow = await readIntent(concurrent.intentId);
  assert.equal(concurrentRow.status, "checkout_created");
  assert.equal(concurrentRow.amount_cents, 725);
  assert.equal(concurrentRow.shipping_amount_cents, 125);
  assert.equal(concurrentRow.total_amount_cents, 850);
  await expectApiError(
    async () =>
      createOrResumeCheckoutIntent({
        amountCents: 500,
        credential: concurrent.credential,
        minimumAmountCents: 500,
        request: await createRequest(),
      }),
    409,
    "CHECKOUT_ALREADY_STARTED",
  );
  await expectApiError(
    async () =>
      deleteCheckoutIntentFile({
        credential: concurrent.credential,
        request: await createRequest(),
        uploadId: Number(concurrent.uploadDocument.id),
      }),
    409,
    "INTENT_NOT_DRAFT",
  );
  assert.equal((await readIntent(concurrent.intentId)).amount_cents, 725);

  stage = "TIMEOUT_RECOVERY";
  const timedOut = await createFixture();
  const timeoutDouble = new IdempotentStripeDouble();
  timeoutDouble.failAfterCreateOnce = true;
  await expectApiError(
    async () =>
      createOrResumeStripeCheckoutSession({
        credential: timedOut.credential,
        gateway: timeoutDouble,
        request: await createRequest(),
      }),
    503,
    "CHECKOUT_UNAVAILABLE",
  );
  const pendingAfterTimeout = await readIntent(timedOut.intentId);
  assert.equal(pendingAfterTimeout.status, "checkout_pending");
  const timeoutRecovery = await createOrResumeStripeCheckoutSession({
    credential: timedOut.credential,
    gateway: timeoutDouble,
    request: await createRequest(),
  });
  assert.equal(timeoutRecovery.created, false);
  assert.equal(timeoutDouble.sessions.size, 1);
  assert.equal(
    new Set(timeoutDouble.createInputs.map(({ attemptId }) => attemptId)).size,
    1,
  );

  stage = "FINALIZATION_RECOVERY";
  const finalization = await createFixture();
  const finalizationDouble = new IdempotentStripeDouble();
  await expectApiError(
    async () =>
      createOrResumeStripeCheckoutSession({
        credential: finalization.credential,
        gateway: finalizationDouble,
        request: await createRequest(),
        testProbe: {
          afterFinalizationPersistence: () => {
            throw new Error("SYNTHETIC_FINALIZATION_FAILURE");
          },
        },
      }),
    500,
    "CHECKOUT_FINALIZATION_FAILED",
  );
  assert.equal((await readIntent(finalization.intentId)).status, "checkout_pending");
  const finalized = await createOrResumeStripeCheckoutSession({
    credential: finalization.credential,
    gateway: finalizationDouble,
    request: await createRequest(),
  });
  assert.equal(finalized.created, false);
  assert.equal(finalizationDouble.sessions.size, 1);
  assert.equal(
    new Set(
      finalizationDouble.createInputs.map(({ attemptId }) => attemptId),
    ).size,
    1,
  );
  const finalizedRow = await readIntent(finalization.intentId);
  finalizationDouble.setStatus(finalizedRow.stripe_checkout_session_id, "complete");
  await expectApiError(
    async () =>
      createOrResumeStripeCheckoutSession({
        credential: finalization.credential,
        gateway: finalizationDouble,
        request: await createRequest(),
      }),
    409,
    "CHECKOUT_PROCESSING",
  );

  stage = "HTTP_DENIALS";
  const httpMissingUpload = await createFixture({ upload: false });
  for (const response of [
    await fetch(
      new URL(
        "/api/storefront/checkout-intents/current/checkout-session",
        baseURL,
      ),
      {
        body: "{}",
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ),
    await postCheckout(httpMissingUpload, "{}", undefined, {
      origin: "https://elsewhere.invalid",
    }),
  ]) {
    assert.equal(response.status, 403);
    assertNoStore(response);
  }
  for (const [body, contentType, expected] of [
    ["not-json", "application/json", 400],
    [JSON.stringify({ returnUrl: "https://attacker.invalid" }), "application/json", 400],
    ["{}", "text/plain", 415],
  ]) {
    const response = await postCheckout(httpMissingUpload, body, undefined, {
      "content-type": contentType,
    });
    assert.equal(response.status, expected);
    assertNoStore(response);
  }
  const queryResponse = await postCheckout(
    httpMissingUpload,
    "{}",
    "/api/storefront/checkout-intents/current/checkout-session?success_url=https://attacker.invalid",
  );
  assert.equal(queryResponse.status, 400);
  const invalidCookieResponse = await postCheckout(
    { cookie: "stephish_checkout_intent=invalid" },
  );
  assert.equal(invalidCookieResponse.status, 401);
  assert.match(invalidCookieResponse.headers.get("set-cookie"), /Max-Age=0/);
  const missingCookieResponse = await postCheckout(undefined);
  assert.equal(missingCookieResponse.status, 401);
  const fileBody = new FormData();
  fileBody.append("file", new Blob([png], { type: "image/png" }), "fixture.png");
  const fileResponse = await fetch(
    new URL(
      "/api/storefront/checkout-intents/current/checkout-session",
      baseURL,
    ),
    {
      body: fileBody,
      headers: { cookie: httpMissingUpload.cookie, origin: requestOrigin },
      method: "POST",
    },
  );
  assert.equal(fileResponse.status, 415);
  const missingUploadResponse = await postCheckout(httpMissingUpload);
  assert.equal(missingUploadResponse.status, 422);
  assertNoStore(missingUploadResponse);

  stage = "REAL_STRIPE_TEST_SESSION";
  const realFixture = await createFixture({ amountCents: 875 });
  const objectKey = realFixture.uploadDocument.filename;
  const unsignedURL =
    `${process.env.SUPABASE_STORAGE_ENDPOINT.replace(/\/$/, "")}/` +
    `${encodeURIComponent(process.env.SUPABASE_STORAGE_BUCKET)}/` +
    encodeURIComponent(objectKey);
  assert.equal((await fetch(unsignedURL)).status, 403);
  const realResponse = await postCheckout(realFixture);
  assert.equal(realResponse.status, 201);
  assertNoStore(realResponse);
  const realBody = await realResponse.json();
  assert.deepEqual(Object.keys(realBody).sort(), ["checkoutUrl", "expiresAt"]);
  assert.match(realBody.checkoutUrl, /^https:\/\/checkout\.stripe\.com\//);
  const realRow = await readIntent(realFixture.intentId);
  assert.equal(realRow.status, "checkout_created");
  assert.equal(realRow.shipping_amount_cents, 125);
  assert.equal(realRow.total_amount_cents, 1000);
  stripeSessionIDs.add(realRow.stripe_checkout_session_id);
  const reusedResponse = await postCheckout(realFixture);
  assert.equal(reusedResponse.status, 200);
  assert.deepEqual(await reusedResponse.json(), realBody);
  const realSession = await stripe.checkout.sessions.retrieve(
    realRow.stripe_checkout_session_id,
  );
  assert.equal(realSession.livemode, false);
  assert.equal(realSession.status, "open");
  assert.equal(realSession.mode, "payment");
  assert.equal(realSession.currency, "usd");
  assert.equal(realSession.customer_creation, "always");
  assert.equal(realSession.customer, null);
  assert.deepEqual(realSession.payment_method_types, ["card"]);
  assert.deepEqual(realSession.shipping_address_collection, {
    allowed_countries: ["US"],
  });
  assert.equal(realSession.automatic_tax.enabled, false);
  assert.equal(realSession.allow_promotion_codes, null);
  assert.equal(realSession.invoice_creation.enabled, false);
  assert.equal(realSession.amount_subtotal, 875);
  assert.equal(realSession.amount_total, 1000);
  assert.ok(
    realSession.expires_at <=
      Math.floor(new Date(realBody.expiresAt).getTime() / 1000),
  );
  assert.deepEqual(Object.keys(realSession.metadata).sort(), [
    "checkoutAttemptId",
    "checkoutIntentId",
  ]);
  const lineItems = await stripe.checkout.sessions.listLineItems(
    realRow.stripe_checkout_session_id,
    { limit: 10 },
  );
  assert.equal(lineItems.data.length, 1);
  assert.equal(lineItems.data[0].amount_subtotal, 875);
  assert.equal(lineItems.data[0].currency, "usd");
  assert.equal(lineItems.data[0].quantity, 1);

  const currentResponse = await fetch(
    new URL("/api/storefront/checkout-intents/current", baseURL),
    { headers: { cookie: realFixture.cookie } },
  );
  const currentBody = await currentResponse.json();
  assert.equal(currentBody.shippingAmountCents, 125);
  assert.equal(currentBody.totalAmountCents, 1000);
  assert.equal(/stripe|attempt/i.test(JSON.stringify(currentBody)), false);
  const intentCountBeforeResume = (await countRows()).checkout_intents;
  const blockedResume = await fetch(
    new URL("/api/storefront/checkout-intents", baseURL),
    {
      body: JSON.stringify({ amountCents: 900 }),
      headers: {
        "content-type": "application/json",
        cookie: realFixture.cookie,
        origin: requestOrigin,
      },
      method: "POST",
    },
  );
  assert.equal(blockedResume.status, 409);
  assert.equal((await countRows()).checkout_intents, intentCountBeforeResume);
  assert.equal((await readIntent(realFixture.intentId)).amount_cents, 875);

  const successPageResponse = await fetch(
    new URL("/checkout/success?session_id=untrusted", baseURL),
  );
  assert.equal(successPageResponse.status, 200);
  assert.equal((await successPageResponse.text()).includes("untrusted"), false);
  assert.deepEqual(await countRows(), {
    checkout_intents: intentIDs.size,
    customers: 0,
    order_uploads: intentIDs.size - 2,
    orders: 0,
  });

  await stripe.checkout.sessions.expire(realRow.stripe_checkout_session_id);
  const expiredResponse = await postCheckout(realFixture);
  assert.equal(expiredResponse.status, 410);
  assert.match(expiredResponse.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal((await readIntent(realFixture.intentId)).status, "expired");

  stage = "ACCESS_DENIALS";
  for (const path of ["/api/checkout-intents", "/api/order-uploads"]) {
    const response = await fetch(new URL(path, baseURL));
    assert.ok(response.status === 401 || response.status === 403);
  }
  const graphQLResponse = await fetch(new URL("/api/graphql", baseURL), {
    body: JSON.stringify({ query: "{ __typename }" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.ok(graphQLResponse.status >= 400);
  assert.equal((await countRows()).customers, 0);
  assert.equal((await countRows()).orders, 0);

  completed = true;
} catch {
  console.log("CHECKOUT_SESSION_LIFECYCLE_RESULT=FAIL");
  console.log(`CHECKOUT_SESSION_LIFECYCLE_STAGE=${stage}`);
  process.exitCode = 1;
} finally {
  stage = "CLEANUP";
  if (stripe) {
    for (const sessionId of stripeSessionIDs) {
      try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (session.status === "open") {
          await stripe.checkout.sessions.expire(sessionId);
        }
      } catch {
        cleanupFailed = true;
      }
    }
  }

  if (payload) {
    for (const intentId of intentIDs) {
      try {
        const uploads = await payload.find({
          collection: "order-uploads",
          depth: 0,
          limit: 10,
          overrideAccess: true,
          pagination: false,
          where: { checkoutIntent: { equals: intentId } },
        });
        for (const upload of uploads.docs) {
          if (upload.filename) objectKeys.add(upload.filename);
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
      } catch {
        cleanupFailed = true;
      }
    }
  }

  if (storage) {
    for (const key of objectKeys) {
      try {
        const remaining = await listObjects();
        if (remaining.some(({ Key }) => Key === key)) {
          await storage.send(
            new DeleteObjectCommand({
              Bucket: process.env.SUPABASE_STORAGE_BUCKET,
              Key: key,
            }),
          );
        }
      } catch {
        cleanupFailed = true;
      }
    }
  }

  if (database && checkoutSettingsBefore) {
    try {
      await database.query(
        "UPDATE public.checkout_settings SET minimum_amount_cents = $1, " +
          "shipping_fee_cents = $2, updated_at = $3, created_at = $4 WHERE id = $5",
        [
          checkoutSettingsBefore.minimum_amount_cents,
          checkoutSettingsBefore.shipping_fee_cents,
          checkoutSettingsBefore.updated_at,
          checkoutSettingsBefore.created_at,
          checkoutSettingsBefore.id,
        ],
      );
    } catch {
      cleanupFailed = true;
    }
  }

  let finalCounts;
  let finalObjectCount;
  try {
    finalCounts = database ? await countRows() : undefined;
    finalObjectCount = storage ? (await listObjects()).length : undefined;
    assert.deepEqual(finalCounts, {
      checkout_intents: 0,
      customers: 0,
      order_uploads: 0,
      orders: 0,
    });
    assert.equal(finalObjectCount, 0);
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
    console.log("CHECKOUT_SESSION_LIFECYCLE_RESULT=PASS");
    console.log("DYNAMIC_MINIMUM_AND_SHIPPING=PASS");
    console.log("STRICT_ENDPOINT_SECURITY=PASS");
    console.log("TWO_PHASE_CONCURRENCY=PASS");
    console.log("TIMEOUT_AND_FINALIZATION_RECOVERY=PASS");
    console.log("STRIPE_TEST_SESSION_CREATED_AND_EXPIRED=PASS");
    console.log("CUSTOMERS_AND_ORDERS_CREATED=0");
    console.log(`FINAL_CHECKOUT_INTENT_COUNT=${finalCounts.checkout_intents}`);
    console.log(`FINAL_ORDER_UPLOAD_COUNT=${finalCounts.order_uploads}`);
    console.log(`FINAL_BUCKET_OBJECT_COUNT=${finalObjectCount}`);
    console.log(`FINAL_CUSTOMER_COUNT=${finalCounts.customers}`);
    console.log(`FINAL_ORDER_COUNT=${finalCounts.orders}`);
  } else if (cleanupFailed) {
    console.log("CHECKOUT_SESSION_CLEANUP=FAIL");
    process.exitCode = 1;
  }

  process.exit(process.exitCode ?? 0);
}
