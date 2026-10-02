import nextEnvironment from "@next/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createLocalReq, getPayload } from "payload";

import { issueCheckoutIntentCredential } from "../../src/server/checkout-intents/checkoutIntentCredentials.ts";
import { transitionOrderFulfillment } from "../../src/server/orders/orderFulfillmentService.ts";

const { loadEnvConfig } = nextEnvironment;
const { Client } = pg;
const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const runId = `unit-2-20-${randomUUID()}`;

let payload;
let database;
let baseline;
let completed = false;
let cleanupFailed = false;
let stage = "INITIALIZE";
let serial = 0;
const orderIds = new Set();
const customerIds = new Set();
const intentIds = new Set();

const nextValue = (prefix) =>
  `${prefix}_${runId.replaceAll("-", "")}_${++serial}`;

const counts = async () => (
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

const orderRow = async (id) => (
  await database.query("SELECT * FROM public.orders WHERE id = $1", [id])
).rows[0];

const immutableSnapshot = (row) => ({
  amount_cents: String(row.amount_cents),
  artist_note: row.artist_note,
  checkout_intent_id: row.checkout_intent_id,
  contact_email: row.contact_email,
  currency: row.currency,
  customer_id: row.customer_id,
  paid_at: row.paid_at.toISOString(),
  payment_status: row.payment_status,
  refund_state: row.refund_state,
  refunded_amount_cents: String(row.refunded_amount_cents),
  shipping_address_city: row.shipping_address_city,
  shipping_address_country: row.shipping_address_country,
  shipping_address_line1: row.shipping_address_line1,
  shipping_address_line2: row.shipping_address_line2,
  shipping_address_postal_code: row.shipping_address_postal_code,
  shipping_address_recipient_name: row.shipping_address_recipient_name,
  shipping_address_state: row.shipping_address_state,
  stripe_checkout_session_id: row.stripe_checkout_session_id,
  stripe_dispute_id: row.stripe_dispute_id,
  stripe_dispute_status: row.stripe_dispute_status,
  stripe_payment_intent_id: row.stripe_payment_intent_id,
});

const createFixture = async () => {
  const now = new Date();
  const issued = issueCheckoutIntentCredential(now);
  stage = "FIXTURE_INTENT";
  const intent = await payload.create({
    collection: "checkout-intents",
    data: {
      ...issued.createData,
      amountCents: 900,
      expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
      status: "draft",
    },
    depth: 0,
    overrideAccess: true,
  });
  intentIds.add(Number(intent.id));
  stage = "FIXTURE_CUSTOMER";
  const customer = await payload.create({
    collection: "customers",
    data: {
      email: `${nextValue("fulfillment")}@example.invalid`,
      fullName: "Synthetic Fulfillment Fixture",
      stripeCustomerId: nextValue("cus_test"),
    },
    depth: 0,
    overrideAccess: true,
  });
  customerIds.add(Number(customer.id));
  stage = "FIXTURE_ORDER";
  const order = await payload.create({
    collection: "orders",
    data: {
      amountCents: 900,
      artistNote: "Synthetic Unit 2.20 fixture",
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
        recipientName: "Synthetic Fulfillment Fixture",
        state: "NY",
      },
      stripeCheckoutSessionId: nextValue("cs_test"),
      stripePaymentIntentId: nextValue("pi_test"),
    },
    depth: 0,
    overrideAccess: true,
  });
  orderIds.add(Number(order.id));
  return Number(order.id);
};

try {
  loadEnvConfig(projectRoot);
  const { default: config } = await import("../../src/payload.config.ts");
  payload = await getPayload({ config });
  database = new Client({ connectionString: process.env.DATABASE_URL });
  await database.connect();
  baseline = await counts();
  console.log(`START_COUNTS=${JSON.stringify(baseline)}`);

  stage = "CREATE_FIXTURES";
  const orderId = await createFixture();
  const rollbackOrderId = await createFixture();
  const fixtureCounts = await counts();
  const before = immutableSnapshot(await orderRow(orderId));

  stage = "CONCURRENT_TRANSITION";
  const input = {
    expectedCurrentState: "unfulfilled",
    requestedNextState: "in_progress",
  };
  const concurrent = await Promise.all([
    transitionOrderFulfillment({
      input,
      orderId,
      request: await createLocalReq({}, payload),
    }),
    transitionOrderFulfillment({
      input,
      orderId,
      request: await createLocalReq({}, payload),
    }),
  ]);
  assert.equal(concurrent.filter(({ idempotent }) => idempotent).length, 1);

  stage = "FORWARD_TRANSITIONS";
  await transitionOrderFulfillment({
    input: {
      expectedCurrentState: "in_progress",
      requestedNextState: "ready_to_ship",
    },
    orderId,
    request: await createLocalReq({}, payload),
  });
  const shipped = await transitionOrderFulfillment({
    input: {
      expectedCurrentState: "ready_to_ship",
      requestedNextState: "shipped",
      tracking: { carrier: "ups", trackingNumber: "1Z999AA10123456784" },
    },
    now: new Date("2026-07-04T16:30:45.123Z"),
    orderId,
    request: await createLocalReq({}, payload),
  });
  assert.equal(shipped.shippedAt, "2026-07-04T16:30:45.123Z");
  const delivered = await transitionOrderFulfillment({
    input: {
      expectedCurrentState: "shipped",
      requestedNextState: "delivered",
    },
    now: new Date("2026-07-06T12:05:06.789Z"),
    orderId,
    request: await createLocalReq({}, payload),
  });
  assert.equal(delivered.deliveredAt, "2026-07-06T12:05:06.789Z");

  const after = await orderRow(orderId);
  assert.equal(after.order_status, "delivered");
  assert.equal(after.tracking_carrier, "ups");
  assert.equal(after.tracking_number, "1Z999AA10123456784");
  assert.equal(after.shipped_at.toISOString(), "2026-07-04T16:30:45.123Z");
  assert.equal(after.delivered_at.toISOString(), "2026-07-06T12:05:06.789Z");
  assert.deepEqual(immutableSnapshot(after), before);

  stage = "ROLLBACK";
  await assert.rejects(
    transitionOrderFulfillment({
      input,
      orderId: rollbackOrderId,
      probe: {
        afterUpdate: () => {
          throw new Error("synthetic rollback");
        },
      },
      request: await createLocalReq({}, payload),
    }),
    /synthetic rollback/,
  );
  assert.equal((await orderRow(rollbackOrderId)).order_status, "unfulfilled");
  assert.deepEqual(await counts(), fixtureCounts);
  completed = true;
} catch {
  console.error(`ORDER_FULFILLMENT_LIFECYCLE_FAILURE_STAGE=${stage}`);
  console.error("ORDER_FULFILLMENT_LIFECYCLE_FAILURE=REDACTED");
  process.exitCode = 1;
} finally {
  if (payload) {
    try {
      for (const id of orderIds) {
        await payload.delete({ collection: "orders", id, overrideAccess: true });
      }
      for (const id of customerIds) {
        await payload.delete({ collection: "customers", id, overrideAccess: true });
      }
      for (const id of intentIds) {
        await payload.delete({ collection: "checkout-intents", id, overrideAccess: true });
      }
    } catch {
      cleanupFailed = true;
    }
  }

  let finalCounts;
  try {
    finalCounts = database ? await counts() : undefined;
    assert.deepEqual(finalCounts, baseline);
  } catch {
    cleanupFailed = true;
  }

  await database?.end().catch(() => {});
  await Promise.race([
    payload?.destroy().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);

  if (completed && !cleanupFailed && !process.exitCode) {
    console.log("ORDER_FULFILLMENT_LIFECYCLE_RESULT=PASS");
    console.log("ROW_LOCK_AND_CONCURRENCY=PASS");
    console.log("ROLLBACK_AND_IMMUTABLE_SNAPSHOTS=PASS");
    console.log(`FINAL_COUNTS=${JSON.stringify(finalCounts)}`);
  } else if (cleanupFailed) {
    console.log("ORDER_FULFILLMENT_LIFECYCLE_CLEANUP=FAIL");
    process.exitCode = 1;
  }
  process.exit(process.exitCode ?? 0);
}
