import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStripeCheckoutSessionParams,
  stripeCheckoutIdempotencyKey,
  validateStripeCheckoutSession,
} from "../../src/server/stripe/stripeCheckoutGateway.ts";
import { validateStripeCheckoutEnvironment } from "../../src/server/stripe/stripeEnvironment.ts";

const input = {
  amountCents: 725,
  attemptId: "47b76626-4a7a-44a9-8d54-279a5391a4ca",
  baseURL: "https://shop.example",
  expiresAtEpochSeconds: 1_800_000_000,
  intentId: 42,
  shippingAmountCents: 100,
};

test("Stripe Checkout parameters are exact, server-owned, and US-only", () => {
  assert.deepEqual(buildStripeCheckoutSessionParams(input), {
    automatic_tax: { enabled: false },
    cancel_url: "https://shop.example/checkout/cancelled",
    client_reference_id: "42",
    customer_creation: "always",
    expires_at: 1_800_000_000,
    invoice_creation: { enabled: false },
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: { name: "Custom postcard commission" },
          unit_amount: 725,
        },
        quantity: 1,
      },
    ],
    metadata: {
      checkoutAttemptId: input.attemptId,
      checkoutIntentId: "42",
    },
    mode: "payment",
    payment_method_types: ["card"],
    shipping_address_collection: { allowed_countries: ["US"] },
    shipping_options: [
      {
        shipping_rate_data: {
          display_name: "Shipping",
          fixed_amount: { amount: 100, currency: "usd" },
          type: "fixed_amount",
        },
      },
    ],
    success_url: "https://shop.example/checkout/success",
  });

  const serialized = JSON.stringify(buildStripeCheckoutSessionParams(input));
  assert.equal(/promotion|setup_future_usage|email|filename|storage/i.test(serialized), false);
  assert.equal(serialized.includes("{CHECKOUT_SESSION_ID}"), false);
  assert.equal(serialized.includes("session_id"), false);
});

test("Stripe idempotency derives only from the persisted random attempt", () => {
  assert.equal(
    stripeCheckoutIdempotencyKey(input.attemptId),
    `checkout-session:${input.attemptId}`,
  );
  assert.throws(() => stripeCheckoutIdempotencyKey("not-a-uuid"));
});

test("only an open Test-mode Session with a safe hosted URL is reusable", () => {
  assert.deepEqual(
    validateStripeCheckoutSession({
      expires_at: 1_800_000_000,
      id: "cs_test_example",
      livemode: false,
      status: "open",
      url: "https://checkout.stripe.com/c/pay/cs_test_example",
    }),
    {
      expiresAt: "2027-01-15T08:00:00.000Z",
      expiresAtEpochSeconds: 1_800_000_000,
      id: "cs_test_example",
      status: "open",
      url: "https://checkout.stripe.com/c/pay/cs_test_example",
    },
  );
  assert.throws(() =>
    validateStripeCheckoutSession({
      expires_at: 1_800_000_000,
      id: "cs_live_example",
      livemode: true,
      status: "open",
      url: "https://checkout.stripe.com/c/pay/cs_live_example",
    }),
  );
  assert.equal(
    validateStripeCheckoutSession({
      expires_at: 1_800_000_000,
      id: "cs_test_complete",
      livemode: false,
      status: "complete",
      url: null,
    }).status,
    "complete",
  );
});

test("Stripe environment validation is Test-only and canonical", () => {
  assert.deepEqual(
    validateStripeCheckoutEnvironment({
      appBaseURL: "http://127.0.0.1:3000/",
      secretKey: "sk_test_example",
    }),
    {
      baseURL: "http://127.0.0.1:3000",
      secretKey: "sk_test_example",
    },
  );
  for (const appBaseURL of [
    "https://shop.example/path",
    "https://shop.example/?return=unsafe",
    "http://shop.example",
    "javascript:alert(1)",
  ]) {
    assert.throws(() =>
      validateStripeCheckoutEnvironment({
        appBaseURL,
        secretKey: "sk_test_example",
      }),
    );
  }
  assert.throws(() =>
    validateStripeCheckoutEnvironment({
      appBaseURL: "https://shop.example",
      secretKey: "sk_live_forbidden",
    }),
  );
});
