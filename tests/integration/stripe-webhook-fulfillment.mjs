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
import { handleStripeWebhookRequest } from "../../src/server/stripe/stripeWebhookEndpoint.ts";
import { processStripeWebhookEvent } from "../../src/server/stripe/stripeWebhookService.ts";

const { loadEnvConfig } = nextEnvironment;
const { Client } = pg;
const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const baseURL = process.argv[2] ?? "http://127.0.0.1:3000";
const testRun = `unit-2-8-${randomUUID()}`;
const signingSecret = "whsec_unit_2_8_deterministic_fixture";
const signingStripe = new Stripe("sk_test_unit_2_8_deterministic_fixture");
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

let payload;
let database;
let storage;
let baselineCounts;
let baselineObjects;
let stage = "INITIALIZE";
let completed = false;
let cleanupFailed = false;
let serial = 0;
const intentIDs = new Set();
const uploadIDs = new Set();
const objectKeys = new Set();
const eventIDs = new Set();
const customerIDs = new Set();

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
  ).Contents ?? [];

const nextValue = (prefix) => `${prefix}_${testRun.replaceAll("-", "")}_${++serial}`;
const nextEventId = () => {
  const id = nextValue("evt");
  eventIDs.add(id);
  return id;
};

const createRequest = () => createLocalReq({}, payload);

const createFixture = async ({ upload = true } = {}) => {
  const createdAt = new Date(Date.now() - 60_000);
  const sessionExpiresAt = new Date(
    Math.floor((Date.now() + 60 * 60 * 1000) / 1000) * 1000,
  );
  const intentExpiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const issued = issueCheckoutIntentCredential(createdAt);
  const attemptId = randomUUID();
  const sessionId = nextValue("cs_test");
  const document = await payload.create({
    collection: "checkout-intents",
    data: {
      ...issued.createData,
      amountCents: 800,
      checkoutAttemptId: attemptId,
      checkoutStartedAt: createdAt.toISOString(),
      expiresAt: intentExpiresAt.toISOString(),
      shippingAmountCents: 100,
      status: "checkout_created",
      stripeCheckoutSessionExpiresAt: sessionExpiresAt.toISOString(),
      stripeCheckoutSessionId: sessionId,
      totalAmountCents: 900,
    },
    depth: 0,
    overrideAccess: true,
  });
  const intentId = Number(document.id);
  intentIDs.add(intentId);

  let uploadDocument;
  if (upload) {
    uploadDocument = await payload.create({
      collection: "order-uploads",
      data: { checkoutIntent: intentId, position: 1 },
      depth: 0,
      file: {
        data: png,
        mimetype: "image/png",
        name: `${nextValue("upload")}.png`,
        size: png.length,
      },
      overrideAccess: true,
    });
    uploadIDs.add(Number(uploadDocument.id));
    if (uploadDocument.filename) objectKeys.add(uploadDocument.filename);
  }

  const customerToken = nextValue("customer");
  const customerEmail = `${customerToken}@example.invalid`;
  const customerName = `Customer ${serial}`;
  const stripeCustomerId = nextValue("cus_test");
  const paymentIntentId = nextValue("pi_test");
  const session = {
    amount_subtotal: 800,
    amount_total: 900,
    client_reference_id: String(intentId),
    collected_information: {
      shipping_details: {
        address: {
          city: "Brooklyn",
          country: "US",
          line1: "1 Test Way",
          line2: "Apt 2",
          postal_code: "11201",
          state: "NY",
        },
        name: customerName,
      },
    },
    currency: "usd",
    customer: stripeCustomerId,
    customer_details: {
      email: customerEmail.toUpperCase(),
      name: customerName,
    },
    expires_at: Math.floor(sessionExpiresAt.getTime() / 1000),
    id: sessionId,
    livemode: false,
    metadata: {
      checkoutAttemptId: attemptId,
      checkoutIntentId: String(intentId),
    },
    mode: "payment",
    object: "checkout.session",
    payment_intent: paymentIntentId,
    payment_status: "paid",
    total_details: {
      amount_discount: 0,
      amount_shipping: 100,
      amount_tax: 0,
    },
  };

  return {
    attemptId,
    customerEmail,
    customerName,
    intentId,
    paymentIntentId,
    session,
    sessionId,
    stripeCustomerId,
    uploadDocument,
  };
};

const eventFor = ({
  eventId = nextEventId(),
  eventSession,
  type = "checkout.session.completed",
}) => ({
  created: 1_800_000_000 + serial,
  data: { object: structuredClone(eventSession) },
  id: eventId,
  livemode: false,
  object: "event",
  type,
});

const deliver = async ({ event, probe, retrievedSession }) => {
  const body = JSON.stringify(event);
  const signature = signingStripe.webhooks.generateTestHeaderString({
    payload: body,
    secret: signingSecret,
  });
  const gateway = {
    retrieveSession: async () => structuredClone(retrievedSession),
    verifyEvent: (rawBody, header) =>
      signingStripe.webhooks.constructEvent(rawBody, header, signingSecret),
  };
  return handleStripeWebhookRequest(
    new Request(`${baseURL}/api/webhooks/stripe`, {
      body,
      headers: { "stripe-signature": signature },
      method: "POST",
    }),
    {
      processEvent: (verified) =>
        processStripeWebhookEvent({
          event: verified,
          gateway,
          getRequest: createRequest,
          now: new Date("2027-01-15T00:00:00.000Z"),
          probe,
        }),
      verifyEvent: gateway.verifyEvent,
    },
  );
};

const rowsForIntent = async (intentId) => {
  const intent = await database.query(
      "SELECT status, amount_cents::int, shipping_amount_cents::int, total_amount_cents::int " +
        "FROM public.checkout_intents WHERE id = $1",
      [intentId],
    );
  const orders = await database.query(
      "SELECT id, customer_id, contact_email, amount_cents::int, currency, " +
        "stripe_checkout_session_id, stripe_payment_intent_id, paid_at, " +
        "order_status, payment_status, shipping_address_recipient_name, " +
        "shipping_address_line1, shipping_address_line2, shipping_address_city, " +
        "shipping_address_state, shipping_address_postal_code, shipping_address_country " +
      "FROM public.orders WHERE checkout_intent_id = $1 ORDER BY id",
      [intentId],
    );
  const uploads = await database.query(
      "SELECT id, checkout_intent_id, order_id, position, filename, mime_type, filesize::int " +
        "FROM public.order_uploads WHERE checkout_intent_id = $1 ORDER BY position",
      [intentId],
    );
  const events = await database.query(
      "SELECT stripe_event_id, event_type, disposition, checkout_intent_id, " +
        "stripe_created_at, code " +
        "FROM public.stripe_events WHERE checkout_intent_id = $1 ORDER BY id",
      [intentId],
    );
  return {
    events: events.rows,
    intent: intent.rows[0],
    orders: orders.rows,
    uploads: uploads.rows,
  };
};

const assertExactFulfillment = async (fixture) => {
  const state = await rowsForIntent(fixture.intentId);
  stage = "SNAPSHOT_INTENT_STATUS";
  if (state.intent.status !== "completed") {
    stage = `PAID_REJECTED_${state.events[0]?.code ?? "NO_LEDGER"}`;
  }
  assert.equal(state.intent.status, "completed");
  stage = "SNAPSHOT_INTENT_SUBTOTAL";
  assert.equal(state.intent.amount_cents, 800);
  stage = "SNAPSHOT_INTENT_SHIPPING";
  assert.equal(state.intent.shipping_amount_cents, 100);
  stage = "SNAPSHOT_INTENT_TOTAL";
  assert.equal(state.intent.total_amount_cents, 900);
  stage = "SNAPSHOT_ORDER_COUNT";
  assert.equal(state.orders.length, 1);
  const order = state.orders[0];
  stage = "SNAPSHOT_ORDER_PAYMENT";
  assert.equal(order.contact_email, fixture.customerEmail);
  assert.equal(order.amount_cents, 900);
  assert.equal(order.currency, "usd");
  assert.equal(order.stripe_checkout_session_id, fixture.sessionId);
  assert.equal(order.stripe_payment_intent_id, fixture.paymentIntentId);
  const processedEvent = state.events.find(
    ({ disposition, code }) => disposition === "processed" && code === null,
  );
  assert.ok(processedEvent);
  assert.equal(
    new Date(order.paid_at).toISOString(),
    new Date(processedEvent.stripe_created_at).toISOString(),
  );
  assert.equal(order.order_status, "new");
  assert.equal(order.payment_status, "paid");
  stage = "SNAPSHOT_ORDER_SHIPPING";
  assert.equal(order.shipping_address_recipient_name, fixture.customerName);
  assert.equal(order.shipping_address_line1, "1 Test Way");
  assert.equal(order.shipping_address_line2, "Apt 2");
  assert.equal(order.shipping_address_city, "Brooklyn");
  assert.equal(order.shipping_address_state, "NY");
  assert.equal(order.shipping_address_postal_code, "11201");
  assert.equal(order.shipping_address_country, "US");
  stage = "SNAPSHOT_UPLOAD_ASSOCIATION";
  assert.equal(state.uploads.length, 1);
  assert.equal(state.uploads[0].order_id, order.id);
  assert.equal(state.uploads[0].checkout_intent_id, fixture.intentId);

  stage = "SNAPSHOT_CUSTOMER";
  const customer = (
    await database.query(
      "SELECT id, full_name, email, stripe_customer_id FROM public.customers WHERE id = $1",
      [order.customer_id],
    )
  ).rows[0];
  assert.equal(customer.full_name, fixture.customerName);
  assert.equal(customer.email, fixture.customerEmail);
  assert.equal(customer.stripe_customer_id, fixture.stripeCustomerId);
  customerIDs.add(Number(customer.id));
  return { order, state };
};

const assertRejected = async (fixture, code) => {
  const state = await rowsForIntent(fixture.intentId);
  assert.equal(state.intent.status, "checkout_created");
  assert.equal(state.orders.length, 0);
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0].disposition, "rejected");
  assert.equal(state.events[0].code, code);
  if (state.uploads[0]) assert.equal(state.uploads[0].order_id, null);
};

const cloneSession = (fixture) => structuredClone(fixture.session);

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
  baselineCounts = await countRows();
  baselineObjects = (await listObjects()).map(({ Key }) => Key).sort();
  assert.deepEqual(baselineCounts, {
    checkout_intents: 0,
    customers: 0,
    order_uploads: 0,
    orders: 0,
    stripe_events: 0,
  });
  assert.deepEqual(baselineObjects, []);

  stage = "SIGNED_UNRELATED";
  let unrelatedRequestCount = 0;
  const unrelatedEvent = {
    created: 1_800_000_000,
    data: { object: { id: "prod_test_fixture", object: "product" } },
    id: nextEventId(),
    livemode: false,
    object: "event",
    type: "product.created",
  };
  const unrelatedBody = JSON.stringify(unrelatedEvent);
  const unrelatedSignature = signingStripe.webhooks.generateTestHeaderString({
    payload: unrelatedBody,
    secret: signingSecret,
  });
  const unrelatedResponse = await handleStripeWebhookRequest(
    new Request(`${baseURL}/api/webhooks/stripe`, {
      body: unrelatedBody,
      headers: { "stripe-signature": unrelatedSignature },
      method: "POST",
    }),
    {
      processEvent: (event) =>
        processStripeWebhookEvent({
          event,
          gateway: {
            retrieveSession: async () => {
              throw new Error("UNEXPECTED_RETRIEVAL");
            },
            verifyEvent: () => event,
          },
          getRequest: async () => {
            unrelatedRequestCount += 1;
            return createRequest();
          },
        }),
      verifyEvent: (body, signature) =>
        signingStripe.webhooks.constructEvent(body, signature, signingSecret),
    },
  );
  assert.equal(unrelatedResponse.status, 200);
  assert.equal(unrelatedRequestCount, 0);

  const noMetadata = await createFixture();
  const noMetadataSession = cloneSession(noMetadata);
  noMetadataSession.metadata = {};
  noMetadataSession.client_reference_id = null;
  const noMetadataEvent = eventFor({ eventSession: noMetadataSession });
  const noMetadataResponse = await deliver({
    event: noMetadataEvent,
    retrievedSession: noMetadataSession,
  });
  assert.equal(noMetadataResponse.status, 200);
  assert.equal((await rowsForIntent(noMetadata.intentId)).events.length, 0);

  stage = "PAID_AND_DUPLICATE";
  const paid = await createFixture();
  const paidEvent = eventFor({ eventSession: paid.session });
  stage = "PAID_DELIVERY_STATUS";
  assert.equal(
    (await deliver({ event: paidEvent, retrievedSession: paid.session })).status,
    200,
  );
  stage = "PAID_EXACT_SNAPSHOT";
  await assertExactFulfillment(paid);
  stage = "DUPLICATE_DELIVERY_STATUS";
  assert.equal(
    (await deliver({ event: paidEvent, retrievedSession: paid.session })).status,
    200,
  );
  stage = "DUPLICATE_COUNTS";
  let paidState = await rowsForIntent(paid.intentId);
  assert.equal(paidState.orders.length, 1);
  assert.equal(paidState.events.length, 1);

  stage = "UNPAID_THEN_ASYNC_SUCCESS";
  const delayed = await createFixture();
  const unpaidSession = cloneSession(delayed);
  unpaidSession.payment_status = "unpaid";
  const unpaidEvent = eventFor({ eventSession: unpaidSession });
  assert.equal(
    (await deliver({ event: unpaidEvent, retrievedSession: unpaidSession })).status,
    200,
  );
  let delayedState = await rowsForIntent(delayed.intentId);
  assert.equal(delayedState.intent.status, "checkout_created");
  assert.equal(delayedState.orders.length, 0);
  assert.equal(delayedState.events[0].code, "session_unpaid");
  const asyncSuccess = eventFor({
    eventSession: delayed.session,
    type: "checkout.session.async_payment_succeeded",
  });
  assert.equal(
    (await deliver({ event: asyncSuccess, retrievedSession: delayed.session })).status,
    200,
  );
  await assertExactFulfillment(delayed);

  stage = "CONCURRENT_DELIVERY";
  const concurrent = await createFixture();
  const concurrentEvent = eventFor({ eventSession: concurrent.session });
  const concurrentResponses = await Promise.all([
    deliver({ event: concurrentEvent, retrievedSession: concurrent.session }),
    deliver({ event: concurrentEvent, retrievedSession: concurrent.session }),
  ]);
  assert.deepEqual(
    concurrentResponses.map(({ status }) => status),
    [200, 200],
  );
  const concurrentResult = await assertExactFulfillment(concurrent);
  assert.equal(concurrentResult.state.events.length, 1);

  stage = "REVERSED_SUCCESS_ORDER";
  const reversed = await createFixture();
  const reversedAsync = eventFor({
    eventSession: reversed.session,
    type: "checkout.session.async_payment_succeeded",
  });
  const reversedComplete = eventFor({ eventSession: reversed.session });
  assert.equal(
    (await deliver({ event: reversedAsync, retrievedSession: reversed.session })).status,
    200,
  );
  assert.equal(
    (await deliver({ event: reversedComplete, retrievedSession: reversed.session })).status,
    200,
  );
  const reversedResult = await assertExactFulfillment(reversed);
  assert.equal(reversedResult.state.events.length, 2);
  assert.equal(reversedResult.state.events[1].code, "already_fulfilled");

  stage = "CUSTOMER_REUSE";
  const reusable = await createFixture();
  const existingCustomer = await payload.create({
    collection: "customers",
    data: {
      email: reusable.customerEmail,
      fullName: reusable.customerName,
    },
    depth: 0,
    overrideAccess: true,
  });
  customerIDs.add(Number(existingCustomer.id));
  assert.equal(
    (await deliver({
      event: eventFor({ eventSession: reusable.session }),
      retrievedSession: reusable.session,
    })).status,
    200,
  );
  const reusableResult = await assertExactFulfillment(reusable);
  assert.equal(reusableResult.order.customer_id, Number(existingCustomer.id));

  const exactReuse = await createFixture();
  exactReuse.customerEmail = reusable.customerEmail;
  exactReuse.customerName = reusable.customerName;
  exactReuse.stripeCustomerId = reusable.stripeCustomerId;
  exactReuse.session.customer = reusable.stripeCustomerId;
  exactReuse.session.customer_details.email = reusable.customerEmail;
  exactReuse.session.customer_details.name = reusable.customerName;
  exactReuse.session.collected_information.shipping_details.name = reusable.customerName;
  assert.equal(
    (await deliver({
      event: eventFor({ eventSession: exactReuse.session }),
      retrievedSession: exactReuse.session,
    })).status,
    200,
  );
  const exactReuseResult = await assertExactFulfillment(exactReuse);
  assert.equal(exactReuseResult.order.customer_id, Number(existingCustomer.id));
  assert.equal(
    Number(
      (
        await database.query(
          "SELECT count(*)::int AS count FROM public.customers WHERE email = $1",
          [reusable.customerEmail],
        )
      ).rows[0].count,
    ),
    1,
  );

  stage = "IDENTITY_CONFLICT";
  const identityConflict = await createFixture();
  identityConflict.customerEmail = reusable.customerEmail;
  identityConflict.session.customer_details.email = reusable.customerEmail;
  assert.equal(
    (await deliver({
      event: eventFor({ eventSession: identityConflict.session }),
      retrievedSession: identityConflict.session,
    })).status,
    200,
  );
  await assertRejected(identityConflict, "identity_conflict");

  stage = "MISMATCH_MATRIX";
  const mismatchCases = [
    [
      "amount_mismatch",
      (fixture, eventSession, retrieved) => {
        eventSession.amount_subtotal = 801;
        eventSession.amount_total = 901;
        retrieved.amount_subtotal = 801;
        retrieved.amount_total = 901;
      },
    ],
    [
      "currency_mismatch",
      (_fixture, eventSession, retrieved) => {
        eventSession.currency = "eur";
        retrieved.currency = "eur";
      },
    ],
    [
      "session_mismatch",
      (_fixture, _eventSession, retrieved) => {
        retrieved.id = nextValue("cs_test_other");
      },
    ],
    [
      "payment_mismatch",
      (_fixture, eventSession) => {
        eventSession.payment_intent = nextValue("pi_test_other");
      },
    ],
    [
      "reconciliation_mismatch",
      (_fixture, eventSession, retrieved) => {
        const otherAttempt = randomUUID();
        eventSession.metadata.checkoutAttemptId = otherAttempt;
        retrieved.metadata.checkoutAttemptId = otherAttempt;
      },
    ],
    [
      "invalid_shipping",
      (_fixture, eventSession, retrieved) => {
        eventSession.collected_information.shipping_details.address.country = "CA";
        retrieved.collected_information.shipping_details.address.country = "CA";
      },
    ],
  ];
  for (const [expectedCode, mutate] of mismatchCases) {
    const fixture = await createFixture();
    const eventSession = cloneSession(fixture);
    const retrieved = cloneSession(fixture);
    mutate(fixture, eventSession, retrieved);
    assert.equal(
      (await deliver({
        event: eventFor({ eventSession }),
        retrievedSession: retrieved,
      })).status,
      200,
    );
    await assertRejected(fixture, expectedCode);
  }

  const missingUpload = await createFixture({ upload: false });
  assert.equal(
    (await deliver({
      event: eventFor({ eventSession: missingUpload.session }),
      retrievedSession: missingUpload.session,
    })).status,
    200,
  );
  await assertRejected(missingUpload, "invalid_uploads");

  const ownership = await createFixture({ upload: false });
  const otherOwner = await createFixture();
  assert.notEqual(ownership.intentId, otherOwner.intentId);
  assert.equal(
    (await deliver({
      event: eventFor({ eventSession: ownership.session }),
      retrievedSession: ownership.session,
    })).status,
    200,
  );
  await assertRejected(ownership, "invalid_uploads");

  stage = "ROLLBACK_MATRIX";
  for (const probeName of [
    "afterCustomer",
    "afterOrder",
    "afterUploads",
    "afterIntent",
    "afterLedger",
  ]) {
    const fixture = await createFixture();
    const response = await deliver({
      event: eventFor({ eventSession: fixture.session }),
      probe: { [probeName]: () => { throw new Error("INJECTED_FAILURE"); } },
      retrievedSession: fixture.session,
    });
    assert.equal(response.status, 500);
    const state = await rowsForIntent(fixture.intentId);
    assert.equal(state.intent.status, "checkout_created");
    assert.equal(state.orders.length, 0);
    assert.equal(state.events.length, 0);
    assert.equal(state.uploads[0].order_id, null);
    assert.equal(
      Number(
        (
          await database.query(
            "SELECT count(*)::int AS count FROM public.customers WHERE email = $1",
            [fixture.customerEmail],
          )
        ).rows[0].count,
      ),
      0,
    );
  }

  stage = "FAILURE_AND_EXPIRY";
  for (const [type, expectedCode] of [
    ["checkout.session.async_payment_failed", "async_payment_failed"],
    ["checkout.session.expired", "session_expired"],
  ]) {
    const fixture = await createFixture();
    const response = await deliver({
      event: eventFor({ eventSession: fixture.session, type }),
      retrievedSession: fixture.session,
    });
    assert.equal(response.status, 200);
    const state = await rowsForIntent(fixture.intentId);
    assert.equal(state.intent.status, "expired");
    assert.equal(state.orders.length, 0);
    assert.equal(state.events[0].code, expectedCode);
  }

  const lateExpiry = eventFor({
    eventSession: paid.session,
    type: "checkout.session.expired",
  });
  assert.equal(
    (await deliver({ event: lateExpiry, retrievedSession: paid.session })).status,
    200,
  );
  paidState = await rowsForIntent(paid.intentId);
  assert.equal(paidState.intent.status, "completed");
  assert.equal(paidState.orders.length, 1);
  assert.equal(paidState.events.at(-1).code, "already_fulfilled");

  stage = "ACCESS_AND_PRIVACY";
  for (const [path, init] of [
    ["/api/stripe-events", undefined],
    ["/api/stripe-events", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }],
    ["/api/stripe-events/1", { method: "PATCH", headers: { "content-type": "application/json" }, body: "{}" }],
    ["/api/stripe-events/1", { method: "DELETE" }],
  ]) {
    const response = await fetch(`${baseURL}${path}`, init);
    assert.equal([401, 403].includes(response.status), true);
  }
  for (const path of ["/api/graphql", "/api/graphql-playground"]) {
    assert.equal((await fetch(`${baseURL}${path}`)).status, 404);
  }
  const storageResponse = await fetch(
    `${baseURL}/api/order-uploads/file/unit-2-8-private-probe.png`,
  );
  assert.equal([401, 403].includes(storageResponse.status), true);

  const ledgerColumns = (
    await database.query(
      "SELECT column_name FROM information_schema.columns " +
        "WHERE table_schema = 'public' AND table_name = 'stripe_events' ORDER BY column_name",
    )
  ).rows.map(({ column_name }) => column_name);
  for (const forbidden of [
    "payload",
    "signature",
    "secret",
    "email",
    "address",
    "customer",
    "card",
  ]) {
    assert.equal(ledgerColumns.some((column) => column.includes(forbidden)), false);
  }
  const ledgerText = JSON.stringify(
    (
      await database.query(
        "SELECT stripe_event_id, event_type, disposition, checkout_intent_id, " +
          "stripe_created_at, processed_at, code FROM public.stripe_events",
      )
    ).rows,
  );
  assert.equal(ledgerText.includes("@example.invalid"), false);
  assert.equal(ledgerText.includes("1 Test Way"), false);
  assert.equal(ledgerText.includes(signingSecret), false);

  const rls = (
    await database.query(
      "SELECT relrowsecurity, relforcerowsecurity FROM pg_class " +
        "WHERE oid = 'public.stripe_events'::regclass",
    )
  ).rows[0];
  assert.equal(rls.relrowsecurity, true);
  assert.equal(rls.relforcerowsecurity, false);
  assert.equal(
    Number(
      (
        await database.query(
          "SELECT count(*)::int AS count FROM pg_policies " +
            "WHERE schemaname = 'public' AND tablename = 'stripe_events'",
        )
      ).rows[0].count,
    ),
    0,
  );

  completed = true;
} catch {
  console.error(`STRIPE_WEBHOOK_FULFILLMENT_FAILURE_STAGE=${stage}`);
  console.error("STRIPE_WEBHOOK_FULFILLMENT_FAILURE=REDACTED");
  process.exitCode = 1;
} finally {
  if (payload && database) {
    try {
      const eventRows = await database.query(
        "SELECT id FROM public.stripe_events WHERE stripe_event_id = ANY($1::text[])",
        [[...eventIDs]],
      );
      for (const { id } of eventRows.rows) {
        await payload.delete({
          collection: "stripe-events",
          id,
          overrideAccess: true,
        });
      }
      const orderRows = await database.query(
        "SELECT id FROM public.orders WHERE checkout_intent_id = ANY($1::int[])",
        [[...intentIDs]],
      );
      for (const { id } of orderRows.rows) {
        await payload.delete({ collection: "orders", id, overrideAccess: true });
      }
      for (const uploadId of uploadIDs) {
        try {
          await payload.delete({
            collection: "order-uploads",
            id: uploadId,
            overrideAccess: true,
          });
        } catch {}
      }
      for (const intentId of intentIDs) {
        try {
          await payload.delete({
            collection: "checkout-intents",
            id: intentId,
            overrideAccess: true,
          });
        } catch {}
      }
      const customerRows = await database.query(
        "SELECT id FROM public.customers WHERE email LIKE $1",
        [`%${testRun}%`],
      );
      for (const { id } of customerRows.rows) customerIDs.add(Number(id));
      for (const customerId of customerIDs) {
        try {
          await payload.delete({
            collection: "customers",
            id: customerId,
            overrideAccess: true,
          });
        } catch {}
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
    console.log("STRIPE_WEBHOOK_FULFILLMENT_RESULT=PASS");
    console.log("SIGNED_UNRELATED_AND_UNSUPPORTED=PASS");
    console.log("PAID_SNAPSHOTS_AND_CUSTOMER_REUSE=PASS");
    console.log("DUPLICATE_CONCURRENT_AND_REVERSED_ORDER=PASS");
    console.log("MISMATCH_AND_IDENTITY_DENIAL=PASS");
    console.log("TRANSACTION_ROLLBACK_MATRIX=PASS");
    console.log("ASYNC_FAILURE_AND_EXPIRY=PASS");
    console.log("ANONYMOUS_API_GRAPHQL_STORAGE=DENIED");
    console.log("LEDGER_PRIVACY_AND_RLS=PASS");
    console.log(`FINAL_CHECKOUT_INTENT_COUNT=${finalCounts.checkout_intents}`);
    console.log(`FINAL_ORDER_UPLOAD_COUNT=${finalCounts.order_uploads}`);
    console.log(`FINAL_BUCKET_OBJECT_COUNT=${finalObjects.length}`);
    console.log(`FINAL_CUSTOMER_COUNT=${finalCounts.customers}`);
    console.log(`FINAL_ORDER_COUNT=${finalCounts.orders}`);
    console.log(`FINAL_STRIPE_EVENT_COUNT=${finalCounts.stripe_events}`);
  } else if (cleanupFailed) {
    console.log("STRIPE_WEBHOOK_FULFILLMENT_CLEANUP=FAIL");
    process.exitCode = 1;
  }

  process.exit(process.exitCode ?? 0);
}
