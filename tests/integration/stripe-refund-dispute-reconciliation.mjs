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
import { createStripeWebhookGateway } from "../../src/server/stripe/stripeWebhookGateway.ts";
import { processStripeWebhookEvent } from "../../src/server/stripe/stripeWebhookService.ts";

const { loadEnvConfig } = nextEnvironment;
const { Client } = pg;
const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const baseURL = process.argv[2] ?? "http://127.0.0.1:3000";
const skipStripeSandbox = process.argv.includes("--skip-stripe-sandbox");
const testRun = `unit-2-19-${randomUUID()}`;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

let payload;
let database;
let storage;
let stripe;
let baselineCounts;
let baselineObjects;
let completed = false;
let cleanupFailed = false;
let stage = "INITIALIZE";
let serial = 0;
const intentIDs = new Set();
const customerIDs = new Set();
const uploadIDs = new Set();
const objectKeys = new Set();
const eventIDs = new Set();

const nextValue = (prefix) =>
  `${prefix}_${testRun.replaceAll("-", "")}_${++serial}`;

const countRows = async () =>
  (
    await database.query(
      "SELECT " +
        "(SELECT count(*)::int FROM public.checkout_intents) AS checkout_intents, " +
        "(SELECT count(*)::int FROM public.order_uploads) AS order_uploads, " +
        "(SELECT count(*)::int FROM public.customers) AS customers, " +
        "(SELECT count(*)::int FROM public.orders) AS orders, " +
        "(SELECT count(*)::int FROM public.email_outbox) AS email_outbox, " +
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
  ).Contents ?? [];

const createFixture = async ({ amountCents = 900, withRelatedRecords = false, paymentIntentId } = {}) => {
  const now = new Date();
  const issued = issueCheckoutIntentCredential(now);
  const sessionId = nextValue("cs_test");
  const resolvedPaymentIntentId = paymentIntentId ?? nextValue("pi_test");
  const expiresAt = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const sessionExpiresAt = new Date(now.getTime() + 60 * 60 * 1000);
  stage = "FIXTURE_INTENT";
  const intent = await payload.create({
    collection: "checkout-intents",
    data: {
      ...issued.createData,
      amountCents,
      checkoutAttemptId: randomUUID(),
      checkoutStartedAt: new Date(now.getTime() - 60_000).toISOString(),
      expiresAt: expiresAt.toISOString(),
      shippingAmountCents: 0,
      status: "completed",
      stripeCheckoutSessionExpiresAt: sessionExpiresAt.toISOString(),
      stripeCheckoutSessionId: sessionId,
      totalAmountCents: amountCents,
    },
    depth: 0,
    overrideAccess: true,
  });
  intentIDs.add(Number(intent.id));
  stage = "FIXTURE_CUSTOMER";
  const customer = await payload.create({
    collection: "customers",
    data: {
      email: `${nextValue("customer")}@example.invalid`,
      fullName: "Synthetic Reconciliation Fixture",
      stripeCustomerId: nextValue("cus_test"),
    },
    depth: 0,
    overrideAccess: true,
  });
  customerIDs.add(Number(customer.id));
  stage = "FIXTURE_ORDER";
  const order = await payload.create({
    collection: "orders",
    data: {
      amountCents,
      checkoutIntent: intent.id,
      contactEmail: customer.email,
      currency: "usd",
      customer: customer.id,
      orderStatus: "unfulfilled",
      paidAt: now.toISOString(),
      paymentStatus: "paid",
      refundedAmountCents: 0,
      refundState: "none",
      shippingAddress: {
        city: "Brooklyn",
        country: "US",
        line1: "1 Synthetic Way",
        postalCode: "11201",
        recipientName: "Synthetic Reconciliation Fixture",
        state: "NY",
      },
      stripeCheckoutSessionId: sessionId,
      stripePaymentIntentId: resolvedPaymentIntentId,
    },
    depth: 0,
    overrideAccess: true,
  });

  if (withRelatedRecords) {
    stage = "FIXTURE_UPLOAD";
    const upload = await payload.create({
      collection: "order-uploads",
      data: { checkoutIntent: intent.id, order: order.id, position: 1 },
      depth: 0,
      file: {
        data: png,
        mimetype: "image/png",
        name: `${nextValue("upload")}.png`,
        size: png.length,
      },
      overrideAccess: true,
    });
    uploadIDs.add(Number(upload.id));
    if (upload.filename) objectKeys.add(upload.filename);
    for (const kind of [
      "artist_new_order",
      "customer_order_confirmation",
    ]) {
      stage = `FIXTURE_OUTBOX_${kind}`;
      await payload.create({
        collection: "email-outbox",
        data: { attempts: 0, kind, order: order.id, status: "pending" },
        depth: 0,
        overrideAccess: true,
      });
    }
  }

  return {
    amountCents,
    intentId: Number(intent.id),
    orderId: Number(order.id),
    paymentIntentId: resolvedPaymentIntentId,
  };
};

const idsFor = (paymentIntentId) => ({
  chargeId: `ch_${paymentIntentId.slice(3)}`,
  disputeId: `dp_${paymentIntentId.slice(3)}`,
  refundId: `re_${paymentIntentId.slice(3)}`,
});

const mockGateway = ({
  amountCents,
  currency = "usd",
  disputeStatus,
  paymentIntentId,
  refundStatus,
  refundedAmountCents,
}) => {
  const { chargeId, disputeId, refundId } = idsFor(paymentIntentId);
  const charge = {
    amount: amountCents,
    amount_refunded: refundedAmountCents,
    currency,
    id: chargeId,
    livemode: false,
    object: "charge",
    paid: true,
    payment_intent: paymentIntentId,
    status: "succeeded",
  };
  const paymentIntent = {
    amount_received: amountCents,
    currency,
    id: paymentIntentId,
    latest_charge: chargeId,
    livemode: false,
    object: "payment_intent",
    status: "succeeded",
  };
  return {
    retrieveCharge: async () => structuredClone(charge),
    retrieveDispute: async () => ({
      amount: amountCents,
      charge: chargeId,
      currency,
      id: disputeId,
      livemode: false,
      object: "dispute",
      payment_intent: paymentIntentId,
      status: disputeStatus,
    }),
    retrievePaymentIntent: async () => structuredClone(paymentIntent),
    retrieveRefund: async () => ({
      amount: Math.max(1, refundedAmountCents),
      charge: chargeId,
      currency,
      id: refundId,
      object: "refund",
      payment_intent: paymentIntentId,
      status:
        refundStatus ?? (refundedAmountCents > 0 ? "succeeded" : "failed"),
    }),
    retrieveSession: async () => {
      throw new Error("unexpected checkout session retrieval");
    },
    verifyEvent: () => {
      throw new Error("not used by this focused service test");
    },
  };
};

const eventFor = ({
  created = 1_800_000_000 + serial,
  eventId = nextValue("evt"),
  gateway,
  paymentIntentId,
  type = "refund.updated",
}) => {
  eventIDs.add(eventId);
  const ids = idsFor(paymentIntentId);
  const object = type.startsWith("charge.dispute.")
    ? { id: ids.disputeId, object: "dispute" }
    : type === "charge.refunded"
      ? { id: ids.chargeId, object: "charge" }
      : { id: ids.refundId, object: "refund" };
  return {
    created,
    data: { object },
    gateway,
    id: eventId,
    livemode: false,
    object: "event",
    type,
  };
};

const deliver = async ({ event, gateway = event.gateway, probe } = {}) => {
  let requestCreated = false;
  const wrappedGateway = Object.fromEntries(
    Object.entries(gateway).map(([name, operation]) => [
      name,
      async (...args) => {
        assert.equal(requestCreated, false, "provider retrieval entered a DB request");
        return operation(...args);
      },
    ]),
  );
  const outcome = await processStripeWebhookEvent({
    event,
    gateway: wrappedGateway,
    getRequest: async () => {
      requestCreated = true;
      return createLocalReq({}, payload);
    },
    now: new Date("2027-01-15T00:00:00.000Z"),
    reconciliationProbe: probe,
  });
  assert.equal(requestCreated, true);
  return outcome;
};

const orderState = async (orderId) =>
  (
    await database.query(
      "SELECT payment_status, refunded_amount_cents::int, refund_state, " +
        "stripe_dispute_id, stripe_dispute_status, order_status " +
        "FROM public.orders WHERE id = $1",
      [orderId],
    )
  ).rows[0];

const ledgerRows = async (intentId) =>
  (
    await database.query(
      "SELECT stripe_event_id, event_type, disposition, code " +
        "FROM public.stripe_events WHERE checkout_intent_id = $1 ORDER BY id",
      [intentId],
    )
  ).rows;

loadEnvConfig(projectRoot, true, { error() {}, info() {} });

try {
  stage = "CONNECT";
  assert.equal(process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_"), true);
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
  baselineCounts = await countRows();
  baselineObjects = (await listObjects()).map(({ Key }) => Key).sort();

  stage = "REFUND_LIFECYCLE";
  stage = "REFUND_CREATE_FIXTURE";
  const fixture = await createFixture({ withRelatedRecords: true });
  stage = "REFUND_RELATED_BASELINE";
  const beforeRelated = (
    await database.query(
      "SELECT " +
        "(SELECT count(*)::int FROM public.orders WHERE id = $1) orders, " +
        "(SELECT count(*)::int FROM public.order_uploads WHERE order_id = $1) uploads, " +
        "(SELECT count(*)::int FROM public.email_outbox WHERE order_id = $1) outbox",
      [fixture.orderId],
    )
  ).rows[0];

  for (const [refundedAmountCents, type, refundStatus] of [
    [200, "refund.created", "succeeded"],
    [500, "charge.refunded", "succeeded"],
    [500, "refund.failed", "failed"],
    [500, "refund.updated", "pending"],
  ]) {
    stage = `REFUND_DELIVER_${type}_${refundedAmountCents}`;
    const gateway = mockGateway({ ...fixture, refundedAmountCents, refundStatus });
    const event = eventFor({ gateway, paymentIntentId: fixture.paymentIntentId, type });
    assert.equal(await deliver({ event, gateway }), "processed");
  }
  stage = "REFUND_ASSERT_PARTIAL";
  assert.deepEqual(await orderState(fixture.orderId), {
    order_status: "new",
    payment_status: "partially_refunded",
    refund_state: "partial",
    refunded_amount_cents: 500,
    stripe_dispute_id: null,
    stripe_dispute_status: null,
  });

  const duplicateGateway = mockGateway({ ...fixture, refundedAmountCents: 500 });
  stage = "REFUND_DUPLICATE";
  const duplicate = eventFor({
    gateway: duplicateGateway,
    paymentIntentId: fixture.paymentIntentId,
  });
  assert.equal(await deliver({ event: duplicate, gateway: duplicateGateway }), "processed");
  const ledgerCountBeforeReplay = (await ledgerRows(fixture.intentId)).length;
  assert.equal(await deliver({ event: duplicate, gateway: duplicateGateway }), "duplicate");
  assert.equal((await ledgerRows(fixture.intentId)).length, ledgerCountBeforeReplay);

  const fullGateway = mockGateway({ ...fixture, refundedAmountCents: fixture.amountCents });
  stage = "REFUND_FULL";
  assert.equal(
    await deliver({
      event: eventFor({ gateway: fullGateway, paymentIntentId: fixture.paymentIntentId }),
      gateway: fullGateway,
    }),
    "processed",
  );
  assert.equal((await orderState(fixture.orderId)).refund_state, "full");
  assert.equal((await orderState(fixture.orderId)).payment_status, "refunded");

  const regressionGateway = mockGateway({ ...fixture, refundedAmountCents: 300 });
  stage = "REFUND_REGRESSION";
  assert.equal(
    await deliver({
      event: eventFor({ gateway: regressionGateway, paymentIntentId: fixture.paymentIntentId }),
      gateway: regressionGateway,
    }),
    "ignored",
  );
  assert.equal((await orderState(fixture.orderId)).refunded_amount_cents, fixture.amountCents);

  stage = "DISPUTE_LIFECYCLE";
  for (const [created, disputeStatus, type, expectedPaymentStatus] of [
    [1_800_001_000, "needs_response", "charge.dispute.created", "disputed"],
    [1_800_001_100, "under_review", "charge.dispute.updated", "disputed"],
    [1_800_001_200, "won", "charge.dispute.closed", "refunded"],
  ]) {
    const gateway = mockGateway({
      ...fixture,
      disputeStatus,
      refundedAmountCents: fixture.amountCents,
    });
    const event = eventFor({
      created,
      gateway,
      paymentIntentId: fixture.paymentIntentId,
      type,
    });
    assert.equal(await deliver({ event, gateway }), "processed");
    const state = await orderState(fixture.orderId);
    assert.equal(state.stripe_dispute_status, disputeStatus);
    assert.equal(state.payment_status, expectedPaymentStatus);
  }
  const staleGateway = mockGateway({
    ...fixture,
    disputeStatus: "needs_response",
    refundedAmountCents: fixture.amountCents,
  });
  assert.equal(
    await deliver({
      event: eventFor({
        created: 1_800_001_200,
        gateway: staleGateway,
        paymentIntentId: fixture.paymentIntentId,
        type: "charge.dispute.updated",
      }),
      gateway: staleGateway,
    }),
    "ignored",
  );
  assert.equal((await orderState(fixture.orderId)).stripe_dispute_status, "won");

  const lostFixture = await createFixture();
  const lostGateway = mockGateway({
    ...lostFixture,
    disputeStatus: "lost",
    refundedAmountCents: 0,
  });
  assert.equal(
    await deliver({
      event: eventFor({
        created: 1_800_001_300,
        gateway: lostGateway,
        paymentIntentId: lostFixture.paymentIntentId,
        type: "charge.dispute.closed",
      }),
      gateway: lostGateway,
    }),
    "processed",
  );
  assert.equal((await orderState(lostFixture.orderId)).stripe_dispute_status, "lost");
  assert.equal((await orderState(lostFixture.orderId)).payment_status, "disputed");

  const afterRelated = (
    await database.query(
      "SELECT " +
        "(SELECT count(*)::int FROM public.orders WHERE id = $1) orders, " +
        "(SELECT count(*)::int FROM public.order_uploads WHERE order_id = $1) uploads, " +
        "(SELECT count(*)::int FROM public.email_outbox WHERE order_id = $1) outbox",
      [fixture.orderId],
    )
  ).rows[0];
  assert.deepEqual(afterRelated, beforeRelated);
  assert.equal(
    (await listObjects()).some(({ Key }) => objectKeys.has(Key)),
    true,
  );

  stage = "CONCURRENT_AND_OUT_OF_ORDER";
  const concurrentFixture = await createFixture();
  const lowerGateway = mockGateway({ ...concurrentFixture, refundedAmountCents: 400 });
  const higherGateway = mockGateway({ ...concurrentFixture, refundedAmountCents: 600 });
  await Promise.all([
    deliver({
      event: eventFor({ gateway: lowerGateway, paymentIntentId: concurrentFixture.paymentIntentId }),
      gateway: lowerGateway,
    }),
    deliver({
      event: eventFor({ gateway: higherGateway, paymentIntentId: concurrentFixture.paymentIntentId }),
      gateway: higherGateway,
    }),
  ]);
  assert.equal((await orderState(concurrentFixture.orderId)).refunded_amount_cents, 600);

  stage = "REJECTIONS";
  const unknownPaymentIntentId = nextValue("pi_test_unknown");
  const unknownGateway = mockGateway({
    amountCents: 900,
    paymentIntentId: unknownPaymentIntentId,
    refundedAmountCents: 100,
  });
  assert.equal(
    await deliver({
      event: eventFor({ gateway: unknownGateway, paymentIntentId: unknownPaymentIntentId }),
      gateway: unknownGateway,
    }),
    "rejected",
  );
  const mismatchFixture = await createFixture();
  const mismatchGateway = mockGateway({
    ...mismatchFixture,
    amountCents: mismatchFixture.amountCents + 1,
    refundedAmountCents: 100,
  });
  assert.equal(
    await deliver({
      event: eventFor({ gateway: mismatchGateway, paymentIntentId: mismatchFixture.paymentIntentId }),
      gateway: mismatchGateway,
    }),
    "rejected",
  );
  assert.equal((await orderState(mismatchFixture.orderId)).refunded_amount_cents, 0);

  stage = "ROLLBACK";
  const rollbackFixture = await createFixture();
  const rollbackGateway = mockGateway({ ...rollbackFixture, refundedAmountCents: 100 });
  const rollbackEvent = eventFor({
    gateway: rollbackGateway,
    paymentIntentId: rollbackFixture.paymentIntentId,
  });
  await assert.rejects(
    deliver({
      event: rollbackEvent,
      gateway: rollbackGateway,
      probe: { afterOrderUpdate: () => { throw new Error("synthetic rollback"); } },
    }),
  );
  assert.equal((await orderState(rollbackFixture.orderId)).refunded_amount_cents, 0);
  assert.equal(
    Number(
      (
        await database.query(
          "SELECT count(*)::int count FROM public.stripe_events WHERE stripe_event_id = $1",
          [rollbackEvent.id],
        )
      ).rows[0].count,
    ),
    0,
  );

  stage = "ANONYMOUS_ACCESS";
  for (const [path, init] of [
    ["/api/orders", undefined],
    ["/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refundedAmountCents: 1 }) }],
    [`/api/orders/${fixture.orderId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ refundState: "none" }) }],
  ]) {
    const response = await fetch(`${baseURL}${path}`, init);
    assert.equal([401, 403].includes(response.status), true);
  }
  assert.equal((await fetch(`${baseURL}/api/graphql`)).status, 404);

  stage = "STRIPE_SANDBOX_REFUND";
  if (!skipStripeSandbox) {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: 575,
      confirm: true,
      currency: "usd",
      metadata: { acceptance_fixture: testRun },
      payment_method: "pm_card_visa",
      payment_method_types: ["card"],
    });
    assert.equal(paymentIntent.status, "succeeded");
    const liveFixture = await createFixture({
      amountCents: 575,
      paymentIntentId: paymentIntent.id,
    });
    const refund = await stripe.refunds.create({
      amount: 125,
      metadata: { acceptance_fixture: testRun },
      payment_intent: paymentIntent.id,
    });
    assert.equal(refund.status, "succeeded");
    let sandboxEvent;
    for (let attempt = 0; attempt < 10 && !sandboxEvent; attempt += 1) {
      const events = await stripe.events.list({ limit: 100, type: "refund.created" });
      sandboxEvent = events.data.find(
        ({ data }) => data.object?.id === refund.id,
      );
      if (!sandboxEvent) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    assert.ok(sandboxEvent);
    eventIDs.add(sandboxEvent.id);
    const realGateway = createStripeWebhookGateway();
    assert.equal(await deliver({ event: sandboxEvent, gateway: realGateway }), "processed");
    assert.equal((await orderState(liveFixture.orderId)).refunded_amount_cents, 125);
    assert.equal((await orderState(liveFixture.orderId)).refund_state, "partial");
  }

  stage = "LEDGER_PRIVACY";
  const ledgerColumns = (
    await database.query(
      "SELECT column_name FROM information_schema.columns " +
        "WHERE table_schema = 'public' AND table_name = 'stripe_events'",
    )
  ).rows.map(({ column_name }) => column_name);
  for (const forbidden of ["payload", "signature", "email", "address", "customer", "body"]) {
    assert.equal(ledgerColumns.some((column) => column.includes(forbidden)), false);
  }
  const ledgerText = JSON.stringify(
    (
      await database.query(
        "SELECT stripe_event_id, event_type, disposition, checkout_intent_id, code " +
          "FROM public.stripe_events WHERE stripe_event_id = ANY($1::text[])",
        [[...eventIDs]],
      )
    ).rows,
  );
  assert.equal(ledgerText.includes("@example.invalid"), false);
  assert.equal(ledgerText.includes("Synthetic Way"), false);

  completed = true;
} catch (error) {
  console.error(`STRIPE_RECONCILIATION_FAILURE_STAGE=${stage}`);
  console.error(
    `STRIPE_RECONCILIATION_FAILURE_KIND=${error?.constructor?.name ?? "Unknown"}`,
  );
  const fieldPaths = error?.data?.errors
    ?.map(({ path }) => path)
    .filter((path) => typeof path === "string");
  if (fieldPaths?.length) {
    console.error(`STRIPE_RECONCILIATION_FAILURE_FIELDS=${fieldPaths.join(",")}`);
  }
  if (error?.cause?.code) {
    console.error(`STRIPE_RECONCILIATION_FAILURE_DB_CODE=${error.cause.code}`);
  }
  if (error?.cause?.constraint) {
    console.error(
      `STRIPE_RECONCILIATION_FAILURE_CONSTRAINT=${error.cause.constraint}`,
    );
  }
  console.error("STRIPE_RECONCILIATION_FAILURE=REDACTED");
  process.exitCode = 1;
} finally {
  if (payload && database) {
    try {
      const eventRows = await database.query(
        "SELECT id FROM public.stripe_events WHERE stripe_event_id = ANY($1::text[])",
        [[...eventIDs]],
      );
      for (const { id } of eventRows.rows) {
        await payload.delete({ collection: "stripe-events", id, overrideAccess: true });
      }
      const orderRows = await database.query(
        "SELECT id FROM public.orders WHERE checkout_intent_id = ANY($1::int[])",
        [[...intentIDs]],
      );
      for (const { id } of orderRows.rows) {
        const outboxRows = await database.query(
          "SELECT id FROM public.email_outbox WHERE order_id = $1",
          [id],
        );
        for (const { id: outboxId } of outboxRows.rows) {
          await payload.delete({ collection: "email-outbox", id: outboxId, overrideAccess: true });
        }
        await payload.delete({ collection: "orders", id, overrideAccess: true });
      }
      for (const uploadId of uploadIDs) {
        await payload.delete({ collection: "order-uploads", id: uploadId, overrideAccess: true }).catch(() => {});
      }
      for (const intentId of intentIDs) {
        await payload.delete({ collection: "checkout-intents", id: intentId, overrideAccess: true }).catch(() => {});
      }
      for (const customerId of customerIDs) {
        await payload.delete({ collection: "customers", id: customerId, overrideAccess: true }).catch(() => {});
      }
    } catch {
      cleanupFailed = true;
    }
  }
  if (storage) {
    for (const key of objectKeys) {
      try {
        const remaining = await listObjects();
        if (remaining.some(({ Key }) => Key === key)) {
          await storage.send(
            new DeleteObjectCommand({ Bucket: process.env.SUPABASE_STORAGE_BUCKET, Key: key }),
          );
        }
      } catch {
        cleanupFailed = true;
      }
    }
  }

  let finalCounts;
  let finalObjects;
  try {
    finalCounts = database ? await countRows() : undefined;
    finalObjects = storage
      ? (await listObjects()).map(({ Key }) => Key).sort()
      : undefined;
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
    console.log("STRIPE_RECONCILIATION_RESULT=PASS");
    console.log("REFUND_PARTIAL_MULTIPLE_FULL_FAILED_REPLAY=PASS");
    console.log("DISPUTE_CREATED_UPDATED_WON_LOST_STALE=PASS");
    console.log("CONCURRENT_OUT_OF_ORDER_ROLLBACK=PASS");
    console.log("UNKNOWN_MISMATCH_AND_ACCESS_DENIAL=PASS");
    console.log("RELATED_RECORDS_AND_PRIVATE_OBJECT_RETAINED=PASS");
    console.log(
      `STRIPE_SANDBOX_PARTIAL_REFUND=${skipStripeSandbox ? "SKIPPED" : "PASS"}`,
    );
    console.log("SYNTHETIC_DATABASE_AND_STORAGE_CLEANUP=PASS");
    console.log(`FINAL_CHECKOUT_INTENT_COUNT=${finalCounts.checkout_intents}`);
    console.log(`FINAL_ORDER_UPLOAD_COUNT=${finalCounts.order_uploads}`);
    console.log(`FINAL_BUCKET_OBJECT_COUNT=${finalObjects.length}`);
    console.log(`FINAL_CUSTOMER_COUNT=${finalCounts.customers}`);
    console.log(`FINAL_EMAIL_OUTBOX_COUNT=${finalCounts.email_outbox}`);
    console.log(`FINAL_ORDER_COUNT=${finalCounts.orders}`);
    console.log(`FINAL_STRIPE_EVENT_COUNT=${finalCounts.stripe_events}`);
  } else if (cleanupFailed) {
    console.log("STRIPE_RECONCILIATION_CLEANUP=FAIL");
    process.exitCode = 1;
  }
  process.exit(process.exitCode ?? 0);
}
