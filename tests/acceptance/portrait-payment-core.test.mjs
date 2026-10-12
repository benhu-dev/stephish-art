import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  buildPortraitPaymentSnapshot,
  validatePortraitPaymentSnapshot,
} from "../../src/server/cart/portraitPaymentSnapshot.ts";
import {
  parsePortraitCheckoutRequest,
  portraitShipping,
  PORTRAIT_SHIPPING_COUNTRIES,
} from "../../src/server/cart/portraitShippingPolicy.ts";
import { buildStripeCheckoutSessionParams } from "../../src/server/stripe/stripeCheckoutGateway.ts";
import { reserveCheckoutAttempt } from "../../src/server/storefront/checkoutSessionReservation.ts";
import { resolveStripeCheckoutSession } from "../../src/server/storefront/checkoutSessionService.ts";
import {
  recordUnpaidStripeSession,
  expireStripeSession,
} from "../../src/server/stripe/stripeWebhookDisposition.ts";
import { fulfillPaidStripeSession } from "../../src/server/stripe/stripeWebhookFulfillment.ts";
import { validateRetrievedPaidSession } from "../../src/server/stripe/stripeWebhookSession.ts";
import {
  portraitCheckoutHandler,
  createPortraitCartEndpoints,
} from "../../src/server/cart/portraitCartEndpoints.ts";
import { serializeCheckoutIntentCookie } from "../../src/server/storefront/checkoutIntentCookie.ts";
import { protectReservedTemplateMedia } from "../../src/server/templates/reservedTemplateMedia.ts";
import {
  credential,
  attemptId,
  now,
  expiry,
  makeCart,
  makeSnapshot,
  makePaymentHarness,
} from "./portrait-payment-fixture.mjs";

const input = { policyAccepted: true, shippingRegion: "international" };
const paidSession = (snapshot, country = "TW") => ({
  intentId: 81,
  attemptId,
  sessionId: "cs_test_portrait",
  expiresAtEpochSeconds: Date.parse(expiry) / 1000,
  amountSubtotal: snapshot.subtotalCents,
  amountTotal: snapshot.totalCents,
  shippingAmount: snapshot.shipping.amountCents,
  portraitCheckoutVersion: "1",
  eventCreatedAt: now.toISOString(),
  customerEmail: "synthetic@example.test",
  customerName: "Synthetic customer",
  stripeCustomerId: "cus_synthetic",
  paymentIntentId: "pi_synthetic",
  shippingAddress: {
    country,
    recipientName: "Synthetic customer",
    city: "Synthetic city",
    line1: "Synthetic street",
  },
});
const event = (id = "evt_synthetic_portrait") => ({
  id,
  type: "checkout.session.completed",
  createdAt: now.toISOString(),
});

test("policy request is exact, consent mandatory, shipping owned by server", () => {
  assert.deepEqual(parsePortraitCheckoutRequest(input), input);
  for (const bad of [
    { ...input, amountCents: 1 },
    { ...input, policyAccepted: false },
    { ...input, shippingRegion: "US" },
    {},
    null,
  ])
    assert.throws(() => parsePortraitCheckoutRequest(bad));
  assert.equal(portraitShipping("us").amountCents, 1000);
  assert.deepEqual(portraitShipping("us").allowedCountries, ["US"]);
  assert.equal(portraitShipping("international").amountCents, 500);
  assert.equal(
    portraitShipping("international").allowedCountries.includes("US"),
    false,
  );
});

test("provisional destinations match concrete installed Stripe address enum except ZZ", async () => {
  const source = await readFile(
    new URL(
      "../../node_modules/stripe/esm/resources/Checkout/Sessions.d.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const block = source.slice(
    source.indexOf(
      "namespace ShippingAddressCollection",
      source.indexOf("interface SessionCreateParams"),
    ),
  );
  const line = block.match(/type AllowedCountry = ([^;]+);/)[1];
  const supported = [...line.matchAll(/'([A-Z]{2})'/g)]
    .map((m) => m[1])
    .filter((c) => c !== "ZZ");
  assert.deepEqual(PORTRAIT_SHIPPING_COUNTRIES, supported);
});

test("up to five portraits and fifteen photos calculate once-per-order shipping", () => {
  const s = makeSnapshot("international", makeCart(5, 3));
  assert.equal(s.subtotalCents, 15000);
  assert.equal(s.totalCents, 15500);
  assert.equal(s.photos.length, 15);
  assert.equal(makeSnapshot("us", makeCart(5, 3)).totalCents, 16000);
  const cart = makeCart();
  const frozen = makeSnapshot("us", cart);
  cart.portraits[0].template.name = "Later catalog edit";
  assert.equal(frozen.portraits[0].templateName, "Synthetic design 1");
});

test("malformed amounts, incomplete coverage, duplicate photos and oversized sets fail closed", () => {
  const original = makeSnapshot();
  for (const mutate of [
    (s) => s.totalCents++,
    (s) => s.portraits[0].amountCents++,
    (s) => s.photos.pop(),
    (s) => (s.photos[1].id = s.photos[0].id),
    (s) => (s.photos[0].filesize = 16 * 1024 * 1024),
    (s) => (s.photos[0].subjectIds = ["not-a-subject"]),
    (s) => s.shipping.allowedCountries.push("US"),
    (s) => (s.portraits = []),
  ]) {
    const bad = structuredClone(original);
    mutate(bad);
    assert.throws(() => validatePortraitPaymentSnapshot(bad));
  }
  const cart = makeCart();
  cart.portraits[0].template.available = false;
  assert.throws(() =>
    buildPortraitPaymentSnapshot({ ...cart, region: "us", now }),
  );
});

test("Stripe sees one line per portrait and one fixed shipping option without private data", () => {
  const s = makeSnapshot();
  const params = buildStripeCheckoutSessionParams({
    portraitSnapshot: s,
    amountCents: s.subtotalCents,
    shippingAmountCents: 500,
    attemptId,
    intentId: 81,
    expiresAtEpochSeconds: Date.parse(expiry) / 1000,
    baseURL: "https://shop.example",
  });
  assert.equal(params.line_items.length, 2);
  assert.deepEqual(
    params.line_items.map((p) => p.price_data.unit_amount),
    [2500, 2500],
  );
  assert.equal(params.shipping_options.length, 1);
  assert.equal(
    params.shipping_options[0].shipping_rate_data.fixed_amount.amount,
    500,
  );
  assert.equal(
    params.shipping_address_collection.allowed_countries.includes("US"),
    false,
  );
  assert.deepEqual(params.payment_method_types, ["card"]);
  assert.equal(params.wallet_options.link.display, "never");
  const serialized = JSON.stringify(params);
  for (const forbidden of [
    "Synthetic subject",
    "Synthetic note",
    "synthetic-0-0.png",
    "subjectIds",
    "previewMedia",
    "https://storage",
  ])
    assert.equal(serialized.includes(forbidden), false);
  assert.throws(() =>
    buildStripeCheckoutSessionParams({
      ...{
        portraitSnapshot: s,
        amountCents: s.subtotalCents,
        shippingAmountCents: 1000,
      },
    }),
  );
});

test("reservation freezes cart/policy before provider work and repeats original attempt", async () => {
  const h = makePaymentHarness();
  const first = await reserveCheckoutAttempt(
    h.request(),
    credential,
    now,
    input,
  );
  assert.equal(first.createdAttempt, true);
  assert.equal(h.state().intent.status, "checkout_pending");
  assert.equal(h.state().portraits[0].reservedPreviewMedia, 401);
  assert.equal(first.portraitSnapshot.totalCents, 5500);
  const second = await reserveCheckoutAttempt(
    h.request(),
    credential,
    now,
    input,
  );
  assert.equal(second.createdAttempt, false);
  assert.equal(second.attemptId, first.attemptId);
  assert.deepEqual(second.portraitSnapshot, first.portraitSnapshot);
  await assert.rejects(
    reserveCheckoutAttempt(h.request(), credential, now, {
      policyAccepted: true,
      shippingRegion: "us",
    }),
    (e) => e.code === "SHIPPING_REGION_LOCKED",
  );
  assert.equal(h.state().intent.totalAmountCents, 5500);
});

test("competing reservations serialize to the same attempt; invalid carts rollback", async () => {
  const h = makePaymentHarness();
  const both = await Promise.all([
    reserveCheckoutAttempt(h.request(), credential, now, input),
    reserveCheckoutAttempt(h.request(), credential, now, input),
  ]);
  assert.equal(both[0].attemptId, both[1].attemptId);
  assert.equal(both.filter((r) => r.createdAttempt).length, 1);
  const cart = makeCart();
  cart.uploads.pop();
  const broken = makePaymentHarness({ cart });
  await assert.rejects(
    reserveCheckoutAttempt(broken.request(), credential, now, input),
  );
  assert.equal(broken.state().intent.status, "draft");
  assert.equal(broken.observations.rollbacks, 1);
});

test("paid webhook creates complete immutable graph and concurrent replay never duplicates", async () => {
  const cart = makeCart(5, 3);
  const snapshot = makeSnapshot("international", cart);
  const h = makePaymentHarness({ cart, snapshot, status: "checkout_created" });
  const session = paidSession(snapshot);
  const results = await Promise.all(
    [1, 2].map(() =>
      fulfillPaidStripeSession({
        request: h.request(),
        session,
        event: event(),
        now,
      }),
    ),
  );
  assert.deepEqual(results.sort(), ["duplicate", "processed"]);
  const state = h.state();
  assert.equal(state.orders.length, 1);
  assert.equal(state.paidPortraits.length, 5);
  assert.equal(state.jobs.length, 2);
  assert.equal(state.events.length, 1);
  assert.equal(state.intent.status, "completed");
  assert.equal(
    state.orders[0].portraitPaymentFacts.shipping.region,
    "international",
  );
  for (const u of state.uploads) {
    assert.equal(u.order, state.orders[0].id);
    assert.equal(
      u.orderPortrait,
      state.paidPortraits.find(
        (p) =>
          p.sourceCheckoutPortraitId ===
          cart.portraits.find((p) => p.id === u.checkoutPortrait).publicId,
      ).id,
    );
  }
  assert.equal(
    await fulfillPaidStripeSession({
      request: h.request(),
      session,
      event: event("evt_synthetic_other"),
      now,
    }),
    "ignored",
  );
  assert.equal(h.state().paidPortraits.length, 5);
});

test("fulfillment rejects wrong country, mismatched upload ownership/mapping before Order writes", async () => {
  for (const bad of ["country", "mapping", "owner", "mixed"]) {
    const cart = makeCart();
    const snapshot = makeSnapshot("international", cart);
    if (bad === "mapping")
      cart.uploads[0].subjectIds = [cart.portraits[1].subjects[0].subjectId];
    if (bad === "owner") cart.uploads[0].checkoutPortrait = 999;
    if (bad === "mixed")
      cart.uploads.push({
        ...cart.uploads[0],
        id: 999,
        checkoutPortrait: null,
      });
    const h = makePaymentHarness({
      cart,
      snapshot,
      status: "checkout_created",
    });
    assert.equal(
      await fulfillPaidStripeSession({
        request: h.request(),
        session: paidSession(snapshot, bad === "country" ? "US" : "TW"),
        event: event(),
        now,
      }),
      "rejected",
    );
    assert.equal(h.state().orders.length, 0);
    assert.equal(h.state().paidPortraits.length, 0);
  }
});

test("failure after portrait/upload/outbox/ledger writes rolls back entire graph", async () => {
  for (const hook of [
    "afterCustomer",
    "afterOrder",
    "afterPortraits",
    "afterUploads",
    "afterIntent",
    "afterFirstOutboxJob",
    "afterLedger",
  ]) {
    const cart = makeCart();
    const matched = makeSnapshot("international", cart);
    const fixture = makePaymentHarness({
      cart,
      snapshot: matched,
      status: "checkout_created",
    });
    const baseline = fixture.state();
    await assert.rejects(
      fulfillPaidStripeSession({
        request: fixture.request(),
        session: paidSession(matched),
        event: event(),
        now,
        probe: {
          [hook]: () => {
            throw new Error("Synthetic rollback");
          },
        },
      }),
    );
    assert.deepEqual(fixture.state(), baseline);
    assert.equal(fixture.observations.rollbacks, 1);
  }
});

test("email delivery failure after commit cannot invalidate a paid portrait Order", async () => {
  const cart = makeCart();
  const snapshot = makeSnapshot("us", cart);
  const h = makePaymentHarness({ cart, snapshot, status: "checkout_created" });
  const req = h.request();
  assert.equal(
    await fulfillPaidStripeSession({
      request: req,
      session: paidSession(snapshot, "US"),
      event: event(),
      now,
      attemptOrderEmailDelivery: async () => {
        assert.equal(req.transactionID, undefined);
        throw new Error("Synthetic email failure");
      },
    }),
    "processed",
  );
  assert.equal(h.state().orders.length, 1);
  assert.equal(h.state().jobs.length, 2);
});

test("portrait endpoint rejects authority injection, cross-origin, query and missing cookie", async () => {
  let calls = 0;
  const create = async ({ portraitCheckout }) => {
    calls++;
    assert.deepEqual(portraitCheckout, input);
    return {
      created: true,
      response: {
        checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_synthetic",
        expiresAt: expiry,
      },
    };
  };
  const request = (
    body = input,
    origin = "http://localhost:3000",
    url = "http://localhost:3000/api/storefront/checkout-intents/current/cart/checkout-session",
    cookie = true,
  ) => {
    const req = new Request(url, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        ...(cookie
          ? {
              cookie: serializeCheckoutIntentCookie(
                credential,
                new Date(expiry),
                false,
              ).split(";")[0],
            }
          : {}),
      },
      body: JSON.stringify(body),
    });
    req.payload = { logger: { error: () => {} } };
    return req;
  };
  const success = await portraitCheckoutHandler(request(), create);
  assert.equal(success.status, 201);
  assert.equal(success.headers.get("cache-control"), "no-store");
  for (const args of [
    [{ ...input, amountCents: 1 }],
    [input, "https://evil.example"],
    [input, "http://localhost:3000", "http://localhost:3000/path?amount=1"],
    [input, "http://localhost:3000", "http://localhost:3000/path", false],
  ]) {
    assert.ok(
      (await portraitCheckoutHandler(request(...args), create)).status >= 400,
    );
  }
  assert.equal(calls, 1);
  const endpoints = createPortraitCartEndpoints(
    async ({ action, credential: c }) => {
      assert.equal(action, "checkoutSession");
      assert.equal(c.intentId, 81);
      return { allowed: false, retryAfterSeconds: 10 };
    },
  );
  const limited = await endpoints
    .find((e) => e.path.endsWith("/cart/checkout-session"))
    .handler(request());
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "10");
});

test("reserved media protection locks before checking references and fails closed without transaction", async () => {
  const calls = [];
  const req = {
    transactionID: "synthetic",
    payload: {
      db: {
        sessions: {
          synthetic: {
            db: {
              execute: async () => {
                calls.push("lock");
              },
            },
          },
        },
      },
      count: async (q) => {
        calls.push("count");
        assert.equal(q.where.reservedPreviewMedia.equals, 401);
        return { totalDocs: 1 };
      },
    },
  };
  await assert.rejects(
    protectReservedTemplateMedia(req, 401),
    (e) => e.status === 409,
  );
  assert.deepEqual(calls, ["lock", "count"]);
  await assert.rejects(
    protectReservedTemplateMedia({ payload: { db: {} } }, 401),
  );
});

test("Stripe retrieval permits international addresses only for matched portrait version", () => {
  const snapshot = makeSnapshot();
  const stripe = {
    object: "checkout.session",
    id: "cs_test_portrait",
    mode: "payment",
    livemode: false,
    status: "complete",
    payment_method_types: ["card"],
    currency: "usd",
    metadata: {
      checkoutIntentId: "81",
      checkoutAttemptId: attemptId,
      portraitCheckoutVersion: "1",
    },
    client_reference_id: "81",
    expires_at: Math.floor(Date.parse(expiry) / 1000),
    amount_subtotal: snapshot.subtotalCents,
    amount_total: snapshot.totalCents,
    total_details: { amount_shipping: 500, amount_discount: 0, amount_tax: 0 },
    payment_status: "paid",
    customer: "cus_synthetic",
    payment_intent: "pi_synthetic",
    customer_details: { email: "synthetic@example.test", name: "Synthetic" },
    collected_information: {
      shipping_details: {
        name: "Synthetic",
        address: { country: "TW", line1: "Synthetic", city: "Synthetic" },
      },
    },
  };
  const validate = (session, eventSession = session) =>
    validateRetrievedPaidSession({
      session,
      eventSession,
      event: { livemode: false, created: Math.floor(now.getTime() / 1000) },
      reconciliation: { intentId: 81, attemptId },
    });
  assert.equal(validate(stripe).kind, "paid");
  const legacy = structuredClone(stripe);
  delete legacy.metadata.portraitCheckoutVersion;
  assert.equal(validate(legacy).code, "invalid_shipping");
  assert.equal(validate(stripe, legacy).code, "session_mismatch");
  const unknown = structuredClone(stripe);
  unknown.collected_information.shipping_details.address.country = "ZZ";
  assert.equal(validate(unknown).code, "invalid_shipping");
  for (const mutation of [
    (s) => (s.status = "open"),
    (s) => (s.payment_method_types = ["card", "paypal"]),
    (s) => (s.total_details.amount_discount = 100),
    (s) => (s.total_details.amount_tax = 100),
  ]) {
    const bad = structuredClone(stripe);
    mutation(bad);
    assert.equal(validate(bad).kind, "rejected");
  }
});

test("uncertain provider creation and finalization rollback reuse exact persisted Stripe parameters", async () => {
  const previousKey = process.env.STRIPE_SECRET_KEY;
  const previousURL = process.env.APP_BASE_URL;
  process.env.STRIPE_SECRET_KEY = "sk_test_synthetic_portrait";
  process.env.APP_BASE_URL = "https://shop.example";
  try {
    for (const mode of ["provider", "finalization"]) {
      const h = makePaymentHarness();
      const calls = [];
      const req = h.request();
      let failed = false;
      const gateway = {
        createSession: async (params) => {
          assert.equal(req.transactionID, undefined);
          calls.push(buildStripeCheckoutSessionParams(params));
          if (mode === "provider" && !failed) {
            failed = true;
            throw new Error("Synthetic uncertain provider");
          }
          return {
            id: "cs_test_portrait",
            status: "open",
            paymentStatus: "unpaid",
            url: "https://checkout.stripe.com/c/pay/cs_test_portrait",
            expiresAtEpochSeconds: params.expiresAtEpochSeconds,
            expiresAt: new Date(
              params.expiresAtEpochSeconds * 1000,
            ).toISOString(),
          };
        },
        retrieveSession: async () => {
          throw new Error("Not expected");
        },
      };
      await assert.rejects(
        resolveStripeCheckoutSession({
          credential,
          portraitCheckout: input,
          request: req,
          gateway,
          now,
          testProbe:
            mode === "finalization"
              ? {
                  afterFinalizationPersistence: () => {
                    throw new Error("Synthetic finalization failure");
                  },
                }
              : {},
        }),
      );
      assert.equal(h.state().intent.status, "checkout_pending");
      const resumed = await resolveStripeCheckoutSession({
        credential,
        portraitCheckout: input,
        request: req,
        gateway,
        now,
      });
      assert.equal(resumed.created, false);
      assert.equal(h.state().intent.status, "checkout_created");
      assert.deepEqual(calls[0], calls[1]);
    }
  } finally {
    if (previousKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previousKey;
    if (previousURL === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = previousURL;
  }
});

test("unpaid and expired portrait events retain uploads and never create paid Orders", async () => {
  const cart = makeCart(5, 3);
  const snapshot = makeSnapshot("international", cart);
  const h = makePaymentHarness({ cart, snapshot, status: "checkout_created" });
  const session = paidSession(snapshot);
  assert.equal(
    await recordUnpaidStripeSession({
      request: h.request(),
      event: event("evt_synthetic_unpaid"),
      now,
      session,
    }),
    "ignored",
  );
  assert.equal(
    await expireStripeSession({
      request: h.request(),
      event: {
        ...event("evt_synthetic_expired"),
        type: "checkout.session.expired",
      },
      now,
      session,
      code: "session_expired",
    }),
    "processed",
  );
  assert.equal(h.state().intent.status, "expired");
  assert.equal(h.state().orders.length, 0);
  assert.equal(h.state().uploads.length, 15);
});
