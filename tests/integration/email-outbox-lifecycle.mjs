import nextEnvironment from "@next/env";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createLocalReq, getPayload } from "payload";

import { readEmailDeliveryEnvironment } from "../../src/server/email/emailDeliveryEnvironment.ts";
import { createEmailOutboxRepository } from "../../src/server/email/emailOutboxRepository.ts";
import { processEmailOutbox } from "../../src/server/email/emailOutboxProcessor.ts";
import { deliverEmailOutbox } from "../../src/server/email/emailOutboxService.ts";
import { EmailProviderError } from "../../src/server/email/resendEmailGateway.ts";
import { fulfillPaidStripeSession } from "../../src/server/stripe/stripeWebhookFulfillment.ts";

const { loadEnvConfig } = nextEnvironment;
loadEnvConfig(fileURLToPath(new URL("../../", import.meta.url)), true, {
  error() {},
  info() {},
});

const realResend = process.argv.includes("--real-resend");
assert.deepEqual(
  process.argv.slice(2).filter((value) => value !== "--real-resend"),
  [],
);
const runId = randomUUID();
const compactId = runId.replaceAll("-", "");
const database = new pg.Client({ connectionString: process.env.DATABASE_URL });
let payload;
let intentId;
let orderId;
let customerId;
let uploadId;
let eventId;
let baseline;
let stage = "initialize";
let completed = false;
let cleanupFailed = false;
let observedStatuses = {};

const counts = async () => (await database.query(
  `SELECT
    (SELECT count(*)::integer FROM public.customers) AS customers,
    (SELECT count(*)::integer FROM public.checkout_intents) AS checkout_intents,
    (SELECT count(*)::integer FROM public.orders) AS orders,
    (SELECT count(*)::integer FROM public.order_uploads) AS order_uploads,
    (SELECT count(*)::integer FROM public.email_outbox) AS email_outbox,
    (SELECT count(*)::integer FROM public.stripe_events) AS stripe_events`,
)).rows[0];

const enabledTestConfiguration = (environment) => ({
  apiKey: "not-used",
  artistOrderEmail: environment.artistOrderEmail,
  enabled: true,
  from: environment.from,
  replyTo: environment.replyTo,
});

try {
  stage = "connect";
  await database.connect();
  const { default: config } = await import("../../src/payload.config.ts");
  payload = await getPayload({ config });
  baseline = await counts();

  stage = "fixture_intent";
  const now = new Date();
  const attemptId = randomUUID();
  const sessionId = `cs_test_email_${compactId}`;
  const paymentIntentId = `pi_email_${compactId}`;
  const sessionExpiresAt = new Date(
    Math.floor((now.getTime() + 30 * 60_000) / 1_000) * 1_000,
  );
  const intent = await payload.create({
    collection: "checkout-intents",
    data: {
      accessTokenHash: createHash("sha256").update(runId).digest("hex"),
      amountCents: 2_500,
      artistNote: "Synthetic email delivery test note.",
      checkoutAttemptId: attemptId,
      checkoutStartedAt: now.toISOString(),
      deleteAfter: new Date(now.getTime() + 48 * 60 * 60_000).toISOString(),
      expiresAt: new Date(now.getTime() + 24 * 60 * 60_000).toISOString(),
      shippingAmountCents: 125,
      status: "checkout_created",
      stripeCheckoutSessionExpiresAt: sessionExpiresAt.toISOString(),
      stripeCheckoutSessionId: sessionId,
      totalAmountCents: 2_625,
    },
    depth: 0,
    overrideAccess: true,
  });
  intentId = Number(intent.id);
  uploadId = Number((await database.query(
    `INSERT INTO public.order_uploads
      (checkout_intent_id, position, filename, mime_type, filesize, width, height)
    VALUES ($1, 1, $2, 'image/png', 68, 1, 1)
    RETURNING id`,
    [intentId, `email-test-${compactId}.png`],
  )).rows[0].id);

  stage = "fulfillment";
  const environment = readEmailDeliveryEnvironment();
  assert.equal(environment.enabled, true);
  const fulfillmentRequest = await createLocalReq({}, payload);
  let immediateCalls = 0;
  let immediateSummary;
  eventId = `evt_email_${compactId}`;
  const disposition = await fulfillPaidStripeSession({
    attemptOrderEmailDelivery: async (createdOrderId, request) => {
      immediateCalls += 1;
      assert.equal(request.transactionID, undefined);
      if (!realResend) throw new Error("SYNTHETIC_PROVIDER_FAILURE");
      immediateSummary = await deliverEmailOutbox({ orderId: createdOrderId, request });
    },
    event: {
      createdAt: now.toISOString(),
      id: eventId,
      type: "checkout.session.completed",
    },
    now,
    request: fulfillmentRequest,
    session: {
      amountSubtotal: 2_500,
      amountTotal: 2_625,
      attemptId,
      customerEmail: realResend ? environment.replyTo : `customer-${compactId}@example.invalid`,
      customerName: "Synthetic Email Customer",
      eventCreatedAt: now.toISOString(),
      expiresAtEpochSeconds: Math.floor(sessionExpiresAt.getTime() / 1_000),
      intentId,
      paymentIntentId,
      sessionId,
      shippingAddress: {
        city: "Test City",
        country: "US",
        line1: "1 Synthetic Way",
        postalCode: "00000",
        recipientName: "Synthetic Email Customer",
        state: "CA",
      },
      shippingAmount: 125,
      stripeCustomerId: `cus_email_${compactId}`,
    },
  });
  if (disposition !== "processed") {
    const decision = (await database.query(
      "SELECT code FROM public.stripe_events WHERE stripe_event_id = $1",
      [eventId],
    )).rows[0];
    stage = `fulfillment_${decision?.code ?? disposition}`;
  }
  assert.equal(disposition, "processed");
  assert.equal(immediateCalls, 1);
  const orderRow = (await database.query(
    "SELECT id, customer_id, payment_status FROM public.orders WHERE checkout_intent_id = $1",
    [intentId],
  )).rows[0];
  assert.equal(orderRow.payment_status, "paid");
  orderId = Number(orderRow.id);
  customerId = Number(orderRow.customer_id);

  const readJobs = () => database.query(
    `SELECT id, kind, status, attempts::integer, locked_at, next_attempt_at,
      sent_at, provider_message_id, last_error_code
    FROM public.email_outbox WHERE order_id = $1 ORDER BY kind`,
    [orderId],
  );
  let jobs = (await readJobs()).rows;
  assert.equal(jobs.length, 2);

  if (realResend) {
    stage = "real_provider_status";
    assert.deepEqual(immediateSummary, {
      failed: 0,
      retried: 0,
      scanned: 2,
      sent: 2,
      skipped: 0,
    });
    assert.ok(jobs.every((job) => job.status === "sent" && job.provider_message_id));
    observedStatuses = { accepted: 2 };
  } else {
    stage = "paid_order_preserved";
    assert.ok(jobs.every((job) => job.status === "pending" && Number(job.attempts) === 0));

    stage = "concurrent_claims";
    const sentMessages = [];
    const gateway = {
      async send(message, idempotencyKey) {
        sentMessages.push({ idempotencyKey, subject: message.subject, to: message.to });
        return { providerMessageId: `synthetic-provider-${sentMessages.length}` };
      },
    };
    const configuration = enabledTestConfiguration(environment);
    const summaries = await Promise.all([
      processEmailOutbox({
        configuration,
        gateway,
        orderId,
        repository: createEmailOutboxRepository(await createLocalReq({}, payload)),
      }),
      processEmailOutbox({
        configuration,
        gateway,
        orderId,
        repository: createEmailOutboxRepository(await createLocalReq({}, payload)),
      }),
    ]);
    assert.equal(summaries.reduce((sum, value) => sum + value.sent, 0), 2);
    assert.equal(sentMessages.length, 2);
    assert.equal(new Set(sentMessages.map(({ idempotencyKey }) => idempotencyKey)).size, 2);
    assert.deepEqual(
      new Set(sentMessages.map(({ to }) => to)),
      new Set([`customer-${compactId}@example.invalid`, environment.artistOrderEmail]),
    );

    stage = "sent_replay";
    const replay = await processEmailOutbox({
      configuration,
      gateway,
      orderId,
      repository: createEmailOutboxRepository(await createLocalReq({}, payload)),
    });
    assert.equal(replay.scanned, 0);
    assert.equal(sentMessages.length, 2);

    stage = "stale_lease";
    const customerJob = jobs.find(({ kind }) => kind === "customer_order_confirmation");
    await database.query(
      `UPDATE public.email_outbox SET status = 'processing', attempts = 1,
        locked_at = now() - interval '11 minutes', sent_at = NULL,
        provider_message_id = NULL WHERE id = $1`,
      [customerJob.id],
    );
    const stale = await processEmailOutbox({
      configuration,
      gateway,
      orderId,
      repository: createEmailOutboxRepository(await createLocalReq({}, payload)),
    });
    assert.equal(stale.sent, 1);
    jobs = (await readJobs()).rows;
    assert.equal(Number(jobs.find(({ id }) => id === customerJob.id).attempts), 2);

    stage = "retry_and_terminal";
    const artistJob = jobs.find(({ kind }) => kind === "artist_new_order");
    await database.query(
      `UPDATE public.email_outbox SET status = 'pending', attempts = 0,
        locked_at = NULL, next_attempt_at = NULL, sent_at = NULL,
        provider_message_id = NULL WHERE id = $1`,
      [artistJob.id],
    );
    const failingGateway = {
      async send() {
        throw new EmailProviderError("provider_unavailable", true);
      },
    };
    const retry = await processEmailOutbox({
      configuration,
      gateway: failingGateway,
      orderId,
      repository: createEmailOutboxRepository(await createLocalReq({}, payload)),
    });
    assert.equal(retry.retried, 1);
    await database.query(
      "UPDATE public.email_outbox SET attempts = 4, next_attempt_at = now() - interval '1 minute' WHERE id = $1",
      [artistJob.id],
    );
    const terminal = await processEmailOutbox({
      configuration,
      gateway: failingGateway,
      orderId,
      repository: createEmailOutboxRepository(await createLocalReq({}, payload)),
    });
    assert.equal(terminal.failed, 1);
    const terminalRow = (await readJobs()).rows.find(({ id }) => id === artistJob.id);
    assert.equal(terminalRow.status, "failed");
    assert.equal(Number(terminalRow.attempts), 5);
    assert.equal(terminalRow.last_error_code, "provider_unavailable");
  }

  completed = true;
} catch (error) {
  console.error(`EMAIL_OUTBOX_LIFECYCLE_FAILURE_STAGE=${stage}`);
  console.error(`EMAIL_OUTBOX_LIFECYCLE_ERROR=${error instanceof Error ? error.name : "UNKNOWN"}`);
  if (error instanceof Error && error.stack) {
    console.error(`EMAIL_OUTBOX_LIFECYCLE_LOCATION=${error.stack.split("\n").filter((line) => line.includes("email-outbox-lifecycle")).slice(0, 2).join(" | ")}`);
  }
  process.exitCode = 1;
} finally {
  stage = "cleanup";
  try {
    if (orderId) await database.query("DELETE FROM public.email_outbox WHERE order_id = $1", [orderId]);
    if (eventId) await database.query("DELETE FROM public.stripe_events WHERE stripe_event_id = $1", [eventId]);
    if (uploadId) await database.query("DELETE FROM public.order_uploads WHERE id = $1", [uploadId]);
    if (orderId) await database.query("DELETE FROM public.orders WHERE id = $1", [orderId]);
    if (intentId) await database.query("DELETE FROM public.checkout_intents WHERE id = $1", [intentId]);
    if (customerId) await database.query("DELETE FROM public.customers WHERE id = $1", [customerId]);
    if (baseline) assert.deepEqual(await counts(), baseline);
  } catch {
    cleanupFailed = true;
  }
  await database.end().catch(() => { cleanupFailed = true; });
  await Promise.race([
    payload?.destroy().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);

  if (completed && !cleanupFailed && !process.exitCode) {
    if (realResend) {
      console.log("REAL_RESEND_ACCEPTED=2");
      console.log(`REAL_RESEND_STATUS_COUNTS=${JSON.stringify(observedStatuses)}`);
    } else {
      console.log("EMAIL_OUTBOX_DATABASE_LIFECYCLE=PASS");
      console.log("EMAIL_OUTBOX_CONCURRENT_CLAIMS=PASS");
      console.log("EMAIL_OUTBOX_STALE_RETRY_TERMINAL=PASS");
      console.log("EMAIL_FAILURE_PRESERVES_PAID_ORDER=PASS");
    }
    console.log("EMAIL_OUTBOX_SYNTHETIC_CLEANUP=PASS");
  } else {
    if (cleanupFailed) console.error("EMAIL_OUTBOX_SYNTHETIC_CLEANUP=FAIL");
    process.exitCode = 1;
  }
  process.exit(process.exitCode ?? 0);
}
