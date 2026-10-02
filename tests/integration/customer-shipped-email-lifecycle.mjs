import nextEnvironment from "@next/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createLocalReq, getPayload } from "payload";

import { issueCheckoutIntentCredential } from "../../src/server/checkout-intents/checkoutIntentCredentials.ts";
import { readEmailDeliveryEnvironment } from "../../src/server/email/emailDeliveryEnvironment.ts";
import { createEmailOutboxRepository } from "../../src/server/email/emailOutboxRepository.ts";
import { processEmailOutbox } from "../../src/server/email/emailOutboxProcessor.ts";
import { deliverEmailOutbox } from "../../src/server/email/emailOutboxService.ts";
import { EmailProviderError } from "../../src/server/email/resendEmailGateway.ts";
import { transitionOrderFulfillment } from "../../src/server/orders/orderFulfillmentService.ts";

const { loadEnvConfig } = nextEnvironment;
const { Client } = pg;
const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const runRealResend = process.argv.includes("--real-resend");
assert.deepEqual(
  process.argv.slice(2).filter((value) => value !== "--real-resend"),
  [],
);
const runId = `unit-2-20-1-${randomUUID()}`;
const compactId = runId.replaceAll("-", "");

let payload;
let database;
let baseline;
let completed = false;
let cleanupFailed = false;
let realEmailSent = false;
let stage = "INITIALIZE";
let serial = 0;
const orderIds = new Set();
const customerIds = new Set();
const intentIds = new Set();
const uploadIds = new Set();

const nextValue = (prefix) => `${prefix}_${compactId}_${++serial}`;

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

const readShipmentJobs = async (orderId) => (
  await database.query(
    `SELECT id, kind, status, attempts::int, next_attempt_at, sent_at,
      provider_message_id, last_error_code
    FROM public.email_outbox
    WHERE order_id = $1 AND kind = 'customer_shipped'
    ORDER BY id`,
    [orderId],
  )
).rows;

const createFixture = async (customerEmail) => {
  const now = new Date();
  const issued = issueCheckoutIntentCredential(now);
  stage = "FIXTURE_INTENT";
  const intent = await payload.create({
    collection: "checkout-intents",
    data: {
      ...issued.createData,
      amountCents: 900,
      artistNote: "PRIVATE_SYNTHETIC_ARTIST_NOTE",
      shippingAmountCents: 100,
      status: "draft",
      totalAmountCents: 1_000,
    },
    depth: 0,
    overrideAccess: true,
  });
  intentIds.add(Number(intent.id));

  stage = "FIXTURE_CUSTOMER";
  const customer = await payload.create({
    collection: "customers",
    data: {
      email: customerEmail,
      fullName: "Synthetic Shipment Customer",
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
      amountCents: 1_000,
      artistNote: "PRIVATE_SYNTHETIC_ARTIST_NOTE",
      checkoutIntent: intent.id,
      contactEmail: customerEmail,
      currency: "usd",
      customer: customer.id,
      orderStatus: "ready_to_ship",
      paidAt: now.toISOString(),
      paymentStatus: "paid",
      refundedAmountCents: 0,
      refundState: "none",
      shippingAddress: {
        city: "Brooklyn",
        country: "US",
        line1: "1 Synthetic Way",
        postalCode: "11201",
        recipientName: "Synthetic Shipment Customer",
        state: "NY",
      },
      stripeCheckoutSessionId: nextValue("cs_test"),
      stripePaymentIntentId: nextValue("pi_test"),
    },
    depth: 0,
    overrideAccess: true,
  });
  const orderId = Number(order.id);
  orderIds.add(orderId);

  stage = "FIXTURE_UPLOAD_ROW";
  const upload = await database.query(
    `INSERT INTO public.order_uploads
      (checkout_intent_id, order_id, position, filename, mime_type, filesize,
        width, height)
    VALUES ($1, $2, 1, $3, 'image/png', 68, 1, 1)
    RETURNING id`,
    [intent.id, order.id, `shipment-${compactId}-${serial}.png`],
  );
  uploadIds.add(Number(upload.rows[0].id));
  return {
    customerId: Number(customer.id),
    customerEmail,
    orderId,
  };
};

const mockConfiguration = {
  apiKey: "not-used",
  artistOrderEmail: "artist@example.invalid",
  enabled: true,
  from: "orders@example.invalid",
  replyTo: "reply@example.invalid",
};

try {
  loadEnvConfig(projectRoot);
  const { default: config } = await import("../../src/payload.config.ts");
  payload = await getPayload({ config });
  database = new Client({ connectionString: process.env.DATABASE_URL });
  await database.connect();
  baseline = await counts();
  console.log(`START_COUNTS=${JSON.stringify(baseline)}`);

  stage = "MOCK_FIXTURE";
  const fixture = await createFixture(`${nextValue("shipment")}@example.invalid`);
  await database.query(
    "UPDATE public.customers SET email = $2, updated_at = now() WHERE id = $1",
    [fixture.customerId, `${nextValue("changed")}@example.invalid`],
  );
  assert.deepEqual(await readShipmentJobs(fixture.orderId), []);

  stage = "CONCURRENT_SHIPMENT_AND_PROVIDER_FAILURE";
  const providerKeys = [];
  const deliveredMessages = [];
  let immediateCalls = 0;
  const shippedAt = new Date("2027-07-15T16:00:00.000Z");
  const immediateDelivery = async (orderId, request) => {
    immediateCalls += 1;
    assert.equal(request.transactionID, undefined);
    const committedOrder = (
      await database.query(
        "SELECT order_status, tracking_carrier, tracking_number, shipped_at FROM public.orders WHERE id = $1",
        [orderId],
      )
    ).rows[0];
    assert.equal(committedOrder.order_status, "shipped");
    assert.equal(committedOrder.tracking_carrier, "ups");
    assert.equal(committedOrder.tracking_number, "1Z999AA10123456784");
    assert.equal(committedOrder.shipped_at.toISOString(), shippedAt.toISOString());
    assert.equal((await readShipmentJobs(orderId)).length, 1);

    const summary = await processEmailOutbox({
      configuration: mockConfiguration,
      gateway: {
        async send(message, idempotencyKey) {
          providerKeys.push(idempotencyKey);
          deliveredMessages.push(message);
          throw new EmailProviderError("provider_unavailable", true);
        },
      },
      kind: "customer_shipped",
      now: shippedAt,
      orderId,
      repository: createEmailOutboxRepository(request),
    });
    assert.equal(summary.retried, 1);
  };
  const input = {
    expectedCurrentState: "ready_to_ship",
    requestedNextState: "shipped",
    tracking: { carrier: "ups", trackingNumber: "1Z999AA10123456784" },
  };
  const concurrent = await Promise.all([
    transitionOrderFulfillment({
      attemptOrderEmailDelivery: immediateDelivery,
      input,
      now: shippedAt,
      orderId: fixture.orderId,
      request: await createLocalReq({}, payload),
    }),
    transitionOrderFulfillment({
      attemptOrderEmailDelivery: immediateDelivery,
      input,
      now: shippedAt,
      orderId: fixture.orderId,
      request: await createLocalReq({}, payload),
    }),
  ]);
  assert.equal(concurrent.filter(({ idempotent }) => idempotent).length, 1);
  assert.equal(immediateCalls, 1);
  let jobs = await readShipmentJobs(fixture.orderId);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].status, "pending");
  assert.equal(jobs[0].attempts, 1);
  assert.equal(deliveredMessages[0].to, fixture.customerEmail);
  assert.match(deliveredMessages[0].text, /1Z999AA10123456784/);
  assert.match(deliveredMessages[0].text, /www\.ups\.com/);
  assert.doesNotMatch(
    `${deliveredMessages[0].text}${deliveredMessages[0].html}`,
    /PRIVATE_SYNTHETIC_ARTIST_NOTE|stripe|storage|upload|checkout intent/i,
  );

  stage = "WORKER_RETRY";
  const retry = await processEmailOutbox({
    configuration: mockConfiguration,
    gateway: {
      async send(message, idempotencyKey) {
        providerKeys.push(idempotencyKey);
        deliveredMessages.push(message);
        return { providerMessageId: "synthetic-shipment-provider-id" };
      },
    },
    kind: "customer_shipped",
    now: new Date(shippedAt.getTime() + 2 * 60_000),
    orderId: fixture.orderId,
    repository: createEmailOutboxRepository(await createLocalReq({}, payload)),
  });
  assert.equal(retry.sent, 1);
  assert.equal(providerKeys.length, 2);
  assert.equal(providerKeys[0], providerKeys[1]);
  jobs = await readShipmentJobs(fixture.orderId);
  assert.equal(jobs[0].status, "sent");

  stage = "REPLAY_DELIVERED_AND_UNIQUE_INDEX";
  const replay = await transitionOrderFulfillment({
    attemptOrderEmailDelivery: async () => { throw new Error("must not run"); },
    input,
    now: shippedAt,
    orderId: fixture.orderId,
    request: await createLocalReq({}, payload),
  });
  assert.equal(replay.idempotent, true);
  await transitionOrderFulfillment({
    attemptOrderEmailDelivery: async () => { throw new Error("must not run"); },
    input: {
      expectedCurrentState: "shipped",
      requestedNextState: "delivered",
    },
    orderId: fixture.orderId,
    request: await createLocalReq({}, payload),
  });
  assert.equal((await readShipmentJobs(fixture.orderId)).length, 1);
  await assert.rejects(
    database.query(
      `INSERT INTO public.email_outbox (order_id, kind, status, attempts)
      VALUES ($1, 'customer_shipped', 'pending', 0)`,
      [fixture.orderId],
    ),
    (error) => error?.code === "23505",
  );

  stage = "ENQUEUE_ROLLBACK";
  const rollbackFixture = await createFixture(
    `${nextValue("rollback")}@example.invalid`,
  );
  await assert.rejects(
    transitionOrderFulfillment({
      attemptOrderEmailDelivery: async () => {
        throw new Error("must not run");
      },
      input: {
        expectedCurrentState: "ready_to_ship",
        requestedNextState: "shipped",
      },
      orderId: rollbackFixture.orderId,
      probe: {
        afterEnqueue: () => {
          throw new Error("synthetic enqueue rollback");
        },
      },
      request: await createLocalReq({}, payload),
    }),
    /synthetic enqueue rollback/,
  );
  assert.equal(
    (
      await database.query(
        "SELECT order_status FROM public.orders WHERE id = $1",
        [rollbackFixture.orderId],
      )
    ).rows[0].order_status,
    "ready_to_ship",
  );
  assert.deepEqual(await readShipmentJobs(rollbackFixture.orderId), []);

  if (runRealResend) {
    stage = "REAL_RESEND";
    const environment = readEmailDeliveryEnvironment();
    assert.equal(environment.enabled, true);
    const realFixture = await createFixture(environment.replyTo);
    let summaries = 0;
    await transitionOrderFulfillment({
      attemptOrderEmailDelivery: async (orderId, request) => {
        const summary = await deliverEmailOutbox({
          kind: "customer_shipped",
          orderId,
          request,
        });
        assert.deepEqual(summary, {
          failed: 0,
          retried: 0,
          scanned: 1,
          sent: 1,
          skipped: 0,
        });
        summaries += 1;
      },
      input: {
        expectedCurrentState: "ready_to_ship",
        requestedNextState: "shipped",
        tracking: {
          carrier: "usps",
          trackingNumber: "9400111899223856928499",
        },
      },
      orderId: realFixture.orderId,
      request: await createLocalReq({}, payload),
    });
    assert.equal(summaries, 1);
    assert.equal((await readShipmentJobs(realFixture.orderId))[0].status, "sent");
    realEmailSent = true;
  }

  completed = true;
} catch {
  console.error(`CUSTOMER_SHIPPED_LIFECYCLE_FAILURE_STAGE=${stage}`);
  console.error("CUSTOMER_SHIPPED_LIFECYCLE_FAILURE=REDACTED");
  process.exitCode = 1;
} finally {
  try {
    if (database) {
      for (const orderId of orderIds) {
        await database.query("DELETE FROM public.email_outbox WHERE order_id = $1", [orderId]);
      }
      for (const uploadId of uploadIds) {
        await database.query("DELETE FROM public.order_uploads WHERE id = $1", [uploadId]);
      }
      for (const orderId of orderIds) {
        await database.query("DELETE FROM public.orders WHERE id = $1", [orderId]);
      }
      for (const intentId of intentIds) {
        await database.query("DELETE FROM public.checkout_intents WHERE id = $1", [intentId]);
      }
      for (const customerId of customerIds) {
        await database.query("DELETE FROM public.customers WHERE id = $1", [customerId]);
      }
    }
  } catch {
    cleanupFailed = true;
  }

  let finalCounts;
  try {
    finalCounts = database ? await counts() : undefined;
    assert.deepEqual(finalCounts, baseline);
  } catch {
    cleanupFailed = true;
  }
  await database?.end().catch(() => { cleanupFailed = true; });
  await Promise.race([
    payload?.destroy().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);

  if (completed && !cleanupFailed && !process.exitCode) {
    console.log("CUSTOMER_SHIPPED_EMAIL_LIFECYCLE=PASS");
    console.log("TRANSACTION_CONCURRENCY_AND_RETRY=PASS");
    console.log(`REAL_RESEND_ACCEPTED=${realEmailSent ? 1 : 0}`);
    console.log(`FINAL_COUNTS=${JSON.stringify(finalCounts)}`);
  } else if (cleanupFailed) {
    console.log("CUSTOMER_SHIPPED_LIFECYCLE_CLEANUP=FAIL");
    process.exitCode = 1;
  }
  process.exit(process.exitCode ?? 0);
}
