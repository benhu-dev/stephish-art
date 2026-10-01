import assert from "node:assert/strict";
import test from "node:test";

import { retrieveAuthoritativePaymentState } from "../../src/server/stripe/stripeWebhookReconciliation.ts";

const event = ({ livemode = false, type = "refund.updated" } = {}) => ({
  created: 1_800_000_000,
  data: { object: { id: "re_validation", object: "refund" } },
  id: "evt_validation",
  livemode,
  object: "event",
  type,
});

const gateway = (overrides = {}) => ({
  retrieveCharge: async () => ({
    amount: 900,
    amount_refunded: 300,
    currency: "usd",
    id: "ch_validation",
    livemode: false,
    object: "charge",
    paid: true,
    payment_intent: "pi_validation",
  }),
  retrieveDispute: async () => {
    throw new Error("not used");
  },
  retrievePaymentIntent: async () => ({
    amount_received: 900,
    currency: "usd",
    id: "pi_validation",
    latest_charge: "ch_validation",
    livemode: false,
    object: "payment_intent",
    status: "succeeded",
  }),
  retrieveRefund: async () => ({
    amount: 300,
    charge: "ch_validation",
    currency: "usd",
    id: "re_validation",
    object: "refund",
    payment_intent: "pi_validation",
    status: "succeeded",
  }),
  retrieveSession: async () => {
    throw new Error("not used");
  },
  verifyEvent: () => {
    throw new Error("not used");
  },
  ...overrides,
});

test("authoritative refund retrieval follows Refund to Charge to PaymentIntent", async () => {
  const calls = [];
  const base = gateway();
  const tracked = gateway({
    retrieveCharge: async (id) => {
      calls.push(["charge", id]);
      return base.retrieveCharge(id);
    },
    retrievePaymentIntent: async (id) => {
      calls.push(["payment_intent", id]);
      return base.retrievePaymentIntent(id);
    },
    retrieveRefund: async (id) => {
      calls.push(["refund", id]);
      return base.retrieveRefund(id);
    },
  });

  const result = await retrieveAuthoritativePaymentState({
    event: event(),
    gateway: tracked,
  });
  assert.equal(result.kind, "verified");
  assert.deepEqual(result.state, {
    chargeId: "ch_validation",
    currency: "usd",
    disputeId: null,
    disputeStatus: null,
    paymentIntentId: "pi_validation",
    refundedAmountCents: 300,
    totalAmountCents: 900,
  });
  assert.deepEqual(calls, [
    ["refund", "re_validation"],
    ["charge", "ch_validation"],
    ["payment_intent", "pi_validation"],
  ]);
});

test("live-mode and mismatched provider objects are rejected without trusting snapshots", async () => {
  let calls = 0;
  const live = await retrieveAuthoritativePaymentState({
    event: event({ livemode: true }),
    gateway: gateway({ retrieveRefund: async () => { calls += 1; } }),
  });
  assert.equal(live.kind, "rejected");
  assert.equal(calls, 0);

  const mismatch = await retrieveAuthoritativePaymentState({
    event: event(),
    gateway: gateway({
      retrieveRefund: async () => ({
        ...(await gateway().retrieveRefund()),
        id: "re_different",
      }),
    }),
  });
  assert.equal(mismatch.kind, "rejected");
});

test("provider retrieval failures remain retryable instead of becoming database truth", async () => {
  await assert.rejects(
    retrieveAuthoritativePaymentState({
      event: event(),
      gateway: gateway({
        retrieveRefund: async () => {
          throw new Error("provider unavailable");
        },
      }),
    }),
    /provider unavailable/,
  );
});
