import assert from "node:assert/strict";
import test from "node:test";

import Stripe from "stripe";

import {
  handleStripeWebhookRequest,
  MAX_STRIPE_WEBHOOK_BODY_BYTES,
} from "../../src/server/stripe/stripeWebhookEndpoint.ts";

const signingSecret = "whsec_unit_2_8_fixture";
const stripe = new Stripe("sk_test_unit_2_8_fixture");
const payload = JSON.stringify({
  created: 1_700_000_000,
  data: { object: { id: "obj_fixture", object: "product" } },
  id: "evt_unit_2_8_fixture",
  livemode: false,
  object: "event",
  type: "product.created",
});

const signatureFor = (body, options = {}) =>
  stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret: signingSecret,
    ...options,
  });

const requestFor = (body, signature = signatureFor(body), headers) =>
  new Request("http://127.0.0.1:3000/api/webhooks/stripe", {
    body,
    headers: headers ?? { "stripe-signature": signature },
    method: "POST",
  });

const dependencies = (processEvent = async () => {}) => ({
  processEvent,
  verifyEvent: (body, signature) =>
    stripe.webhooks.constructEvent(body, signature, signingSecret),
});

test("the exact signed raw body reaches the verified event processor", async () => {
  const exactBody = `${payload}\n`;
  let processed;
  const response = await handleStripeWebhookRequest(
    requestFor(exactBody),
    dependencies(async (event) => {
      processed = event;
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(processed.id, "evt_unit_2_8_fixture");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("missing, malformed, expired, incorrect, duplicate, and mutated signatures are rejected", async () => {
  const missing = await handleStripeWebhookRequest(
    new Request("http://127.0.0.1:3000/api/webhooks/stripe", {
      body: payload,
      method: "POST",
    }),
    dependencies(),
  );
  assert.equal(missing.status, 400);

  const malformed = await handleStripeWebhookRequest(
    requestFor(payload, "not-a-stripe-signature"),
    dependencies(),
  );
  assert.equal(malformed.status, 400);

  const expiredSignature = signatureFor(payload, {
    timestamp: Math.floor(Date.now() / 1000) - 301,
  });
  const expired = await handleStripeWebhookRequest(
    requestFor(payload, expiredSignature),
    dependencies(),
  );
  assert.equal(expired.status, 400);

  const wrongSecret = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: "whsec_wrong_fixture",
  });
  const incorrect = await handleStripeWebhookRequest(
    requestFor(payload, wrongSecret),
    dependencies(),
  );
  assert.equal(incorrect.status, 400);

  const duplicateHeaders = new Headers();
  const validSignature = signatureFor(payload);
  duplicateHeaders.append("stripe-signature", validSignature);
  duplicateHeaders.append("stripe-signature", validSignature);
  const duplicate = await handleStripeWebhookRequest(
    requestFor(payload, validSignature, duplicateHeaders),
    dependencies(),
  );
  assert.equal(duplicate.status, 400);

  const mutated = await handleStripeWebhookRequest(
    requestFor(`${payload} `, validSignature),
    dependencies(),
  );
  assert.equal(mutated.status, 400);
});

test("signed malformed JSON and bodies over one MiB receive generic 400 responses", async () => {
  const malformedBody = "not-json";
  const malformed = await handleStripeWebhookRequest(
    requestFor(malformedBody),
    dependencies(),
  );
  assert.equal(malformed.status, 400);

  const oversizedBody = "x".repeat(MAX_STRIPE_WEBHOOK_BODY_BYTES + 1);
  const oversized = await handleStripeWebhookRequest(
    requestFor(oversizedBody, "not-read-after-limit"),
    dependencies(),
  );
  assert.equal(oversized.status, 400);

  for (const response of [malformed, oversized]) {
    const body = await response.text();
    assert.equal(body.includes(malformedBody), false);
    assert.equal(body.includes("not-read-after-limit"), false);
    assert.equal(body.includes(signingSecret), false);
  }
});

test("processing failures receive a generic 500 so Stripe retries", async () => {
  const response = await handleStripeWebhookRequest(
    requestFor(payload),
    dependencies(async () => {
      throw new Error("private failure details");
    }),
  );

  assert.equal(response.status, 500);
  const body = await response.text();
  assert.equal(body.includes("private failure details"), false);
  assert.equal(body.includes(signingSecret), false);
});
