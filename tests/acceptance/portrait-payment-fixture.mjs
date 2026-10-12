import { randomUUID } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import { hashCheckoutIntentToken } from "../../src/server/checkout-intents/checkoutIntentCredentials.ts";
import { buildPortraitPaymentSnapshot } from "../../src/server/cart/portraitPaymentSnapshot.ts";

export const credential = { intentId: 81, rawToken: "A".repeat(43) };
export const attemptId = "8b1ca2b8-d889-48fa-b8db-0e96cd7a1169";
export const now = new Date();
export const expiry = new Date(now.getTime() + 86400000).toISOString();
export const makeCart = (count = 2, subjects = 2) => {
  const portraits = Array.from({ length: count }, (_, i) => ({
    id: 100 + i,
    intent: 81,
    publicId: randomUUID(),
    position: i + 1,
    amountCents: 2000 + (subjects - 1) * 500,
    artistNote: `Synthetic note ${i + 1}`,
    subjects: Array.from({ length: subjects }, (_, j) => ({
      subjectId: randomUUID(),
      position: j + 1,
      name: `Synthetic subject ${j + 1}`,
      kind: j === 1 ? "pet" : "person",
    })),
    template: {
      id: 301 + i,
      available: true,
      name: `Synthetic design ${i + 1}`,
      description: "Synthetic description",
      previewMedia: { id: 401 + i, alt: "Synthetic artwork" },
    },
  }));
  const uploads = portraits.flatMap((p, i) =>
    p.subjects.map((s, j) => ({
      id: 500 + i * 3 + j,
      checkoutPortrait: p.id,
      checkoutIntent: 81,
      order: null,
      orderPortrait: null,
      position: j + 1,
      subjectIds: [s.subjectId],
      filename: `synthetic-${i}-${j}.png`,
      filesize: 100,
      mimeType: "image/png",
      width: 2,
      height: 2,
    })),
  );
  return { portraits, uploads };
};
export const makeSnapshot = (region = "international", cart = makeCart()) =>
  buildPortraitPaymentSnapshot({ ...cart, region, now });

const dialect = new PgDialect();
export const sqlText = (query) => dialect.sqlToQuery(query).sql;

// Isolated transaction model: staged changes commit only after the Intent lock.
// This checks service behavior without contacting Postgres, Storage or Stripe.
export const makePaymentHarness = ({
  cart = makeCart(),
  snapshot = null,
  status = "draft",
} = {}) => {
  let state = {
    intent: {
      id: 81,
      status,
      amountCents: cart.portraits.reduce((sum, p) => sum + p.amountCents, 0),
      accessTokenHash: hashCheckoutIntentToken(credential.rawToken),
      expiresAt: expiry,
      deleteAfter: expiry,
      checkoutAttemptId: snapshot ? attemptId : null,
      checkoutStartedAt: snapshot ? now.toISOString() : null,
      stripeCheckoutSessionId:
        status === "checkout_created" ? "cs_test_portrait" : null,
      stripeCheckoutSessionExpiresAt:
        status === "checkout_created" ? expiry : null,
      shippingAmountCents: snapshot?.shipping.amountCents ?? null,
      totalAmountCents: snapshot?.totalCents ?? null,
      portraitPaymentSnapshot: snapshot,
      artistNote: null,
    },
    portraits: structuredClone(cart.portraits),
    uploads: structuredClone(cart.uploads),
    orders: [],
    paidPortraits: [],
    events: [],
    customers: [],
    jobs: [],
  };
  const observations = {
    commits: 0,
    rollbacks: 0,
    writes: 0,
    providerCalls: 0,
    queries: [],
  };
  const sessions = {};
  let serial = 0;
  let mutex = Promise.resolve();
  const rowIntent = (s) => ({
    id: s.intent.id,
    status: s.intent.status,
    amount_cents: s.intent.amountCents,
    artist_note: s.intent.artistNote,
    access_token_hash: s.intent.accessTokenHash,
    expires_at: s.intent.expiresAt,
    delete_after: s.intent.deleteAfter,
    checkout_attempt_id: s.intent.checkoutAttemptId,
    checkout_started_at: s.intent.checkoutStartedAt,
    shipping_amount_cents: s.intent.shippingAmountCents,
    total_amount_cents: s.intent.totalAmountCents,
    stripe_checkout_session_id: s.intent.stripeCheckoutSessionId,
    stripe_checkout_session_expires_at: s.intent.stripeCheckoutSessionExpiresAt,
    portrait_payment_snapshot: s.intent.portraitPaymentSnapshot,
  });
  const dataFor = (request) => sessions[request.transactionID]?.state ?? state;
  const request = () => {
    const req = { payload: {} };
    req.payload = {
      logger: { error: () => {} },
      db: {
        sessions,
        beginTransaction: async () => {
          const id = `synthetic-${++serial}`;
          const session = {
            state: null,
            release: null,
            db: {
              execute: async (query) => {
                const { sql, params } = dialect.sqlToQuery(query);
                observations.queries.push(sql);
                if (sql.includes("FROM public.checkout_intents")) {
                  const previous = mutex;
                  mutex = new Promise((resolve) => {
                    session.release = resolve;
                  });
                  await previous;
                  session.state = structuredClone(state);
                  return { rows: [rowIntent(session.state)] };
                }
                const s = session.state;
                if (sql.includes("FROM public.checkout_portraits"))
                  return { rows: s.portraits.map(({ id }) => ({ id })) };
                if (sql.includes("FROM public.order_uploads"))
                  return {
                    rows: s.uploads.map((u) => ({
                      id: u.id,
                      position: u.position,
                      filename: u.filename,
                      mime_type: u.mimeType,
                      filesize: u.filesize,
                      order_id: u.order,
                      checkout_portrait_id: u.checkoutPortrait,
                      order_portrait_id: u.orderPortrait,
                      subject_ids: u.subjectIds,
                      width: u.width,
                      height: u.height,
                    })),
                  };
                if (sql.includes("FROM public.orders"))
                  return {
                    rows: s.orders.map((o) => ({
                      id: o.id,
                      checkout_intent_id: o.checkoutIntent,
                      amount_cents: o.amountCents,
                      artist_note: o.artistNote,
                      currency: o.currency,
                      stripe_checkout_session_id: o.stripeCheckoutSessionId,
                      stripe_payment_intent_id: o.stripePaymentIntentId,
                      portrait_payment_facts: o.portraitPaymentFacts,
                    })),
                  };
                if (sql.includes("FROM public.stripe_events"))
                  return {
                    rows: s.events
                      .filter((e) => e.stripeEventId === params[0])
                      .map((e) => ({
                        id: e.id,
                        disposition: e.disposition,
                        checkout_intent_id: e.checkoutIntent,
                      })),
                  };
                return { rows: [] };
              },
            },
            resolve: async () => {
              state = session.state;
              observations.commits++;
              session.release?.();
            },
            reject: async () => {
              observations.rollbacks++;
              session.release?.();
            },
          };
          sessions[id] = session;
          return id;
        },
      },
      find: async ({ collection }) => {
        const s = dataFor(req);
        const map = {
          "checkout-portraits": s.portraits,
          "order-uploads": s.uploads,
          "order-portraits": s.paidPortraits,
          customers: s.customers,
        };
        return { docs: structuredClone(map[collection] ?? []) };
      },
      update: async ({ collection, id, data }) => {
        observations.writes++;
        const s = dataFor(req);
        const map = {
          "checkout-intents": [s.intent],
          "checkout-portraits": s.portraits,
          "order-uploads": s.uploads,
          customers: s.customers,
          "stripe-events": s.events,
        };
        const doc = map[collection]?.find((d) => d.id === id);
        if (!doc) throw new Error("Unexpected fixture update");
        Object.assign(doc, structuredClone(data));
        return structuredClone(doc);
      },
      create: async ({ collection, data }) => {
        observations.writes++;
        const s = dataFor(req);
        const map = {
          orders: s.orders,
          "order-portraits": s.paidPortraits,
          "stripe-events": s.events,
          customers: s.customers,
          "email-outbox": s.jobs,
        };
        const docs = map[collection];
        if (!docs) throw new Error("Unexpected fixture create");
        const doc = { id: docs.length + 1000, ...structuredClone(data) };
        docs.push(doc);
        return structuredClone(doc);
      },
    };
    return req;
  };
  return { request, state: () => structuredClone(state), observations };
};
