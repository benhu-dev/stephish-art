import nextEnvironment from "@next/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createLocalReq, getPayload } from "payload";

import { parseCheckoutIntentCookie } from "../../src/server/storefront/checkoutIntentCookie.ts";
import { fulfillPaidStripeSession } from "../../src/server/stripe/stripeWebhookFulfillment.ts";

const { loadEnvConfig } = nextEnvironment;
loadEnvConfig(fileURLToPath(new URL("../../", import.meta.url)), true, { error() {}, info() {} });

const baseURL = process.argv[2] ?? "http://127.0.0.1:3000";
const origin = new URL(baseURL).origin;
const runId = `unit-2-13-${randomUUID()}`;
const database = new pg.Client({ connectionString: process.env.DATABASE_URL });
let payload;
let baselineCounts;
let primaryIntentId;
let expiredIntentId;
let uploadId;
let orderId;
let customerId;
let stripeEventId;
let completed = false;
let cleanupFailed = false;
let stage = "INITIALIZE";

const counts = async () => (await database.query(
  "SELECT (SELECT count(*)::int FROM public.checkout_intents) AS checkout_intents, " +
  "(SELECT count(*)::int FROM public.orders) AS orders",
)).rows[0];

const request = async (path, init = {}) => {
  const response = await fetch(new URL(path, baseURL), init);
  assert.equal(response.headers.get("cache-control"), "no-store");
  return response;
};

const cookieFrom = (response) => {
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie);
  return setCookie.split(";", 1)[0];
};

const intentIdFrom = (cookie) => {
  const parsed = parseCheckoutIntentCookie(cookie);
  assert.equal(parsed.kind, "valid");
  return parsed.credential.intentId;
};

const createIntent = async (amountCents) => {
  const response = await request("/api/storefront/checkout-intents", {
    body: JSON.stringify({ amountCents }),
    headers: { "content-type": "application/json", origin },
    method: "POST",
  });
  assert.equal(response.status, 201);
  const cookie = cookieFrom(response);
  const body = await response.json();
  assert.equal(body.artistNote, "");
  assert.equal(JSON.stringify(body).includes(runId), false);
  return { body, cookie, intentId: intentIdFrom(cookie) };
};

const putNote = (cookie, artistNote, overrides = {}) => {
  const { headers: overrideHeaders, ...rest } = overrides;
  return request("/api/storefront/checkout-intents/current/artist-note", {
    body: JSON.stringify({ artistNote }),
    headers: {
      "content-type": "application/json",
      cookie,
      origin,
      ...(overrideHeaders ?? {}),
    },
    method: "PUT",
    ...rest,
  });
};

const readPersistedNote = async (intentId) => (await database.query(
  "SELECT artist_note FROM public.checkout_intents WHERE id = $1",
  [intentId],
)).rows[0]?.artist_note ?? null;

try {
  stage = "CONNECT";
  await database.connect();
  const { default: config } = await import("../../src/payload.config.ts");
  payload = await getPayload({ config });
  baselineCounts = await counts();
  console.log(`START_COUNTS=${JSON.stringify(baselineCounts)}`);
  const minimumAmountCents = Number((await database.query(
    "SELECT minimum_amount_cents::int FROM public.checkout_settings ORDER BY id LIMIT 1",
  )).rows[0].minimum_amount_cents);

  stage = "CREATE_AND_EXACT_REJECTIONS";
  const primary = await createIntent(Math.max(minimumAmountCents, 1_873));
  primaryIntentId = primary.intentId;
  const unchanged = async (response, expectedStatus) => {
    assert.equal(response.status, expectedStatus);
    assert.equal(await readPersistedNote(primaryIntentId), null);
  };
  await unchanged(await request("/api/storefront/checkout-intents/current/artist-note", {
    body: JSON.stringify({ artistNote: "blocked" }),
    headers: { "content-type": "application/json", cookie: primary.cookie },
    method: "PUT",
  }), 403);
  await unchanged(await putNote(primary.cookie, "blocked", {
    headers: { origin: "https://elsewhere.invalid" },
  }), 403);
  await unchanged(await request("/api/storefront/checkout-intents/current/artist-note", {
    body: "artistNote=blocked",
    headers: { "content-type": "text/plain", cookie: primary.cookie, origin },
    method: "PUT",
  }), 415);
  for (const body of [
    {},
    { artistNote: null },
    { artistNote: 7 },
    { artistNote: "blocked", extra: true },
  ]) {
    await unchanged(await request("/api/storefront/checkout-intents/current/artist-note", {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", cookie: primary.cookie, origin },
      method: "PUT",
    }), 400);
  }
  await unchanged(await request("/api/storefront/checkout-intents/current/artist-note", {
    body: "{",
    headers: { "content-type": "application/json", cookie: primary.cookie, origin },
    method: "PUT",
  }), 400);
  await unchanged(await putNote(primary.cookie, "x".repeat(1_001)), 422);

  stage = "GENERIC_CREDENTIAL_DENIAL";
  const missing = await putNote("", "blocked");
  const malformed = await putNote("stephish_checkout_intent=malformed", "blocked");
  assert.equal(missing.status, 401);
  assert.equal(malformed.status, 401);
  assert.deepEqual(await missing.json(), await malformed.json());
  assert.equal(await readPersistedNote(primaryIntentId), null);

  stage = "NORMALIZE_BOUNDARY_RESTORE_AND_CLEAR";
  let response = await putNote(primary.cookie, `  ${runId} café 🎨\r\n第二行  `);
  assert.equal(response.status, 200);
  const normalized = `${runId} café 🎨\n第二行`;
  assert.deepEqual(await response.json(), { artistNote: normalized });
  assert.equal(await readPersistedNote(primaryIntentId), normalized);
  response = await request("/api/storefront/checkout-intents/current", {
    headers: { cookie: primary.cookie },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).artistNote, normalized);
  response = await request("/api/storefront/checkout-intents", {
    body: JSON.stringify({ amountCents: primary.body.amountCents }),
    headers: { "content-type": "application/json", cookie: primary.cookie, origin },
    method: "POST",
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).artistNote, normalized);
  response = await putNote(primary.cookie, "x".repeat(1_000));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).artistNote.length, 1_000);
  response = await putNote(primary.cookie, " \r\n ");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { artistNote: "" });
  assert.equal(await readPersistedNote(primaryIntentId), null);

  stage = "FINAL_HTML_LIKE_NOTE";
  const finalNote = `<b>${runId}</b>\nline two`;
  response = await putNote(primary.cookie, ` ${finalNote} `);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { artistNote: finalNote });
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.url.includes(runId), false);

  stage = "EXPIRED_DENIAL";
  const expired = await createIntent(Math.max(minimumAmountCents, 1_874));
  expiredIntentId = expired.intentId;
  await database.query(
    "UPDATE public.checkout_intents SET expires_at = now() - interval '1 minute' WHERE id = $1",
    [expiredIntentId],
  );
  response = await putNote(expired.cookie, "blocked");
  assert.equal(response.status, 401);
  assert.equal(await readPersistedNote(expiredIntentId), null);

  stage = "PREPARE_FULFILLMENT";
  const attemptId = randomUUID();
  const sessionId = `cs_test_${runId.replaceAll("-", "")}`;
  const paymentIntentId = `pi_${runId.replaceAll("-", "")}`;
  const stripeCustomerId = `cus_${runId.replaceAll("-", "")}`;
  const sessionExpiresAt = new Date(
    Math.floor((Date.now() + 30 * 60 * 1_000) / 1_000) * 1_000,
  );
  await payload.update({
    collection: "checkout-intents",
    data: {
      checkoutAttemptId: attemptId,
      checkoutStartedAt: new Date().toISOString(),
      shippingAmountCents: 100,
      status: "checkout_created",
      stripeCheckoutSessionExpiresAt: sessionExpiresAt.toISOString(),
      stripeCheckoutSessionId: sessionId,
      totalAmountCents: primary.body.amountCents + 100,
    },
    id: primaryIntentId,
    overrideAccess: true,
  });
  uploadId = Number((await database.query(
    "INSERT INTO public.order_uploads " +
    "(checkout_intent_id, position, filename, mime_type, filesize, width, height) " +
    "VALUES ($1, 1, $2, 'image/png', 68, 1, 1) RETURNING id",
    [primaryIntentId, `${runId}.png`],
  )).rows[0].id);
  response = await putNote(primary.cookie, "must not replace snapshot");
  assert.equal(response.status, 409);
  assert.equal(await readPersistedNote(primaryIntentId), finalNote);

  stage = "FULFILL_FIRST_DELIVERY";
  stripeEventId = `evt_${runId.replaceAll("-", "")}`;
  const event = {
    createdAt: "2027-01-15T00:00:00.000Z",
    id: stripeEventId,
    type: "checkout.session.completed",
  };
  const session = {
    amountSubtotal: primary.body.amountCents,
    amountTotal: primary.body.amountCents + 100,
    attemptId,
    customerEmail: `${runId}@example.invalid`,
    customerName: `Artist note fixture ${runId}`,
    eventCreatedAt: event.createdAt,
    expiresAtEpochSeconds: Math.floor(sessionExpiresAt.getTime() / 1_000),
    intentId: primaryIntentId,
    paymentIntentId,
    sessionId,
    shippingAddress: {
      city: "Test City",
      country: "US",
      line1: "1 Fixture Way",
      postalCode: "00000",
      recipientName: "Synthetic Fixture",
      state: "CA",
    },
    shippingAmount: 100,
    stripeCustomerId,
  };
  const firstDisposition = await fulfillPaidStripeSession({
    event,
    now: new Date("2027-01-15T00:01:00.000Z"),
    probe: {
      afterCustomer: () => { stage = "FULFILL_AFTER_CUSTOMER"; },
      afterIntent: () => { stage = "FULFILL_AFTER_INTENT"; },
      afterLedger: () => { stage = "FULFILL_AFTER_LEDGER"; },
      afterOrder: () => { stage = "FULFILL_AFTER_ORDER"; },
      afterUploads: () => { stage = "FULFILL_AFTER_UPLOADS"; },
    },
    request: await createLocalReq({}, payload),
    session,
  });
  if (firstDisposition !== "processed") {
    const decision = (await database.query(
      "SELECT code FROM public.stripe_events WHERE stripe_event_id = $1",
      [stripeEventId],
    )).rows[0];
    stage = `FULFILL_REJECTED_${decision?.code ?? "NO_CODE"}`;
  }
  assert.equal(firstDisposition, "processed");
  stage = "FULFILL_REPLAY";
  assert.equal(await fulfillPaidStripeSession({
    event,
    now: new Date("2027-01-15T00:02:00.000Z"),
    request: await createLocalReq({}, payload),
    session,
  }), "duplicate");
  stage = "VERIFY_ORDER_SNAPSHOT";
  const orders = (await database.query(
    "SELECT id, customer_id, artist_note FROM public.orders WHERE checkout_intent_id = $1",
    [primaryIntentId],
  )).rows;
  assert.equal(orders.length, 1);
  assert.equal(orders[0].artist_note, finalNote);
  orderId = Number(orders[0].id);
  customerId = Number(orders[0].customer_id);
  assert.equal((await database.query(
    "SELECT count(*)::int AS count FROM public.orders WHERE checkout_intent_id = $1",
    [primaryIntentId],
  )).rows[0].count, 1);
  completed = true;
  console.log("ARTIST_NOTE_ENDPOINT_AND_NORMALIZATION=PASS");
  console.log("ARTIST_NOTE_INVALID_NO_MUTATION=PASS");
  console.log("ARTIST_NOTE_DRAFT_EXPIRY_AUTH=PASS");
  console.log("ARTIST_NOTE_ORDER_SNAPSHOT_REPLAY=PASS");
} catch (error) {
  console.error(`ARTIST_NOTE_LIFECYCLE_FAILURE_STAGE=${stage}`);
  console.error(`ARTIST_NOTE_LIFECYCLE_ERROR_NAME=${error instanceof Error ? error.name : "UNKNOWN"}`);
  const errorCode = typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "NONE";
  console.error(`ARTIST_NOTE_LIFECYCLE_ERROR_CODE=${errorCode}`);
  if (error instanceof Error && error.stack) {
    console.error(`ARTIST_NOTE_LIFECYCLE_ERROR_LOCATION=${error.stack.split("\n").slice(1, 3).join(" | ")}`);
  }
  process.exitCode = 1;
} finally {
  stage = "CLEANUP_SYNTHETIC_ONLY";
  try {
    if (payload) {
      if (stripeEventId) {
        const events = await payload.find({
          collection: "stripe-events",
          depth: 0,
          limit: 2,
          overrideAccess: true,
          pagination: false,
          where: { stripeEventId: { equals: stripeEventId } },
        });
        for (const eventRow of events.docs) {
          await payload.delete({ collection: "stripe-events", id: eventRow.id, overrideAccess: true });
        }
      }
      if (orderId) await payload.delete({ collection: "orders", id: orderId, overrideAccess: true });
      if (uploadId) await database.query("DELETE FROM public.order_uploads WHERE id = $1", [uploadId]);
      for (const intentId of [primaryIntentId, expiredIntentId].filter(Boolean)) {
        const row = (await database.query(
          "SELECT id FROM public.checkout_intents WHERE id = $1",
          [intentId],
        )).rows[0];
        if (row) await payload.delete({ collection: "checkout-intents", id: intentId, overrideAccess: true });
      }
      if (customerId) await payload.delete({ collection: "customers", id: customerId, overrideAccess: true });
    }
  } catch {
    cleanupFailed = true;
  }
  try {
    const finalCounts = await counts();
    console.log(`FINAL_COUNTS=${JSON.stringify(finalCounts)}`);
    assert.deepEqual(finalCounts, baselineCounts);
  } catch {
    cleanupFailed = true;
  }
  await database.end().catch(() => { cleanupFailed = true; });
  await Promise.race([
    payload?.destroy().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (completed && !cleanupFailed && !process.exitCode) {
    console.log("ARTIST_NOTE_LIFECYCLE_RESULT=PASS");
    console.log("ARTIST_NOTE_SYNTHETIC_CLEANUP=PASS");
  } else if (cleanupFailed) {
    console.error("ARTIST_NOTE_SYNTHETIC_CLEANUP=FAIL");
    process.exitCode = 1;
  }
  process.exit(process.exitCode ?? 0);
}
