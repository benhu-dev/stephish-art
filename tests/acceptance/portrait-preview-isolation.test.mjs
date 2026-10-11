import assert from "node:assert/strict";
import test from "node:test";
import { hashCheckoutIntentToken } from "../../src/server/checkout-intents/checkoutIntentCredentials.ts";
import { createOrResumeCheckoutIntent } from "../../src/server/storefront/checkoutIntentService.ts";
import { reserveCheckoutAttempt } from "../../src/server/storefront/checkoutSessionReservation.ts";

const credential = { intentId: 9, rawToken: "synthetic-unit-3-5-token" };
const expiresAt = new Date(Date.now() + 86400000).toISOString();
const document = {
  id: 9,
  status: "draft",
  amountCents: 2000,
  accessTokenHash: hashCheckoutIntentToken(credential.rawToken),
  expiresAt,
  deleteAfter: expiresAt,
};

test("legacy amount update rejects a portrait draft before persisting", async () => {
  let writes = 0;
  const request = {
    payload: {
      db: transactionHarness(true).request.payload.db,
      findByID: async () => document,
      count: async (q) => {
        assert.equal(q.req.transactionID, "unit-3-5");
        assert.equal(q.collection, "checkout-portraits");
        assert.equal(q.where.intent.equals, 9);
        return { totalDocs: 1 };
      },
      update: async () => {
        writes++;
      },
    },
  };
  await assert.rejects(
    createOrResumeCheckoutIntent({
      amountCents: 999,
      credential,
      minimumAmountCents: 500,
      request,
    }),
    (e) => e.status === 409 && e.code === "PORTRAIT_CHECKOUT_NOT_READY",
  );
  assert.equal(writes, 0);
});

test("legacy amount update still accepts a legacy draft", async () => {
  const request = {
    payload: {
      db: transactionHarness(false).request.payload.db,
      findByID: async () => document,
      count: async () => ({ totalDocs: 0 }),
      update: async ({ data }) => ({ ...document, ...data }),
      find: async () => ({ docs: [] }),
    },
  };
  const result = await createOrResumeCheckoutIntent({
    amountCents: 2100,
    credential,
    minimumAmountCents: 500,
    request,
  });
  assert.equal(result.response.amountCents, 2100);
  assert.equal(request.transactionID, undefined);
});

test("legacy amount checks status again after acquiring the shared Intent lock", async () => {
  const h = transactionHarness(false);
  h.request.payload.findByID = async () => document;
  h.request.payload.db.sessions["unit-3-5"].db.execute = async () => ({
    rows: [
      {
        id: 9,
        status: "checkout_pending",
        amount_cents: 2000,
        access_token_hash: document.accessTokenHash,
        expires_at: expiresAt,
        delete_after: expiresAt,
      },
    ],
  });
  await assert.rejects(
    createOrResumeCheckoutIntent({
      amountCents: 2100,
      credential,
      minimumAmountCents: 500,
      request: h.request,
    }),
    (e) => e.status === 409 && e.code === "CHECKOUT_ALREADY_STARTED",
  );
  assert.equal(h.counts().writes, 0);
  assert.equal(h.counts().rollback, 1);
});

function transactionHarness(portraits) {
  let calls = 0;
  let rollback = 0;
  let writes = 0;
  const db = { sessions: {}, beginTransaction: async () => "unit-3-5" };
  db.sessions["unit-3-5"] = {
    resolve: async () => {},
    reject: async () => {
      rollback++;
    },
    db: {
      execute: async () => {
        calls++;
        if (calls === 1)
          return {
            rows: [
              {
                id: 9,
                status: "draft",
                amount_cents: 2000,
                access_token_hash: document.accessTokenHash,
                expires_at: expiresAt,
                delete_after: expiresAt,
              },
            ],
          };
        if (calls === 2) return { rows: portraits ? [{ id: 10 }] : [] };
        return {
          rows: [
            {
              position: 1,
              filename: "synthetic.png",
              mime_type: "image/png",
              filesize: 100,
            },
          ],
        };
      },
    },
  };
  return {
    request: {
      payload: {
        db,
        findGlobal: async () => ({
          minimumAmountCents: 500,
          shippingFeeCents: 1000,
        }),
        update: async () => {
          writes++;
        },
      },
    },
    counts: () => ({ calls, rollback, writes }),
  };
}

test("legacy payment reservation rolls back portrait carts before payment mutation", async () => {
  const h = transactionHarness(true);
  await assert.rejects(
    reserveCheckoutAttempt(h.request, credential, new Date()),
    (e) => e.status === 409 && e.code === "PORTRAIT_CHECKOUT_NOT_READY",
  );
  assert.deepEqual(h.counts(), { calls: 2, rollback: 1, writes: 0 });
});

test("legacy payment reservation remains operational without portrait items", async () => {
  const h = transactionHarness(false);
  const r = await reserveCheckoutAttempt(h.request, credential, new Date());
  assert.equal(r.amountCents, 2000);
  assert.equal(r.shippingAmountCents, 1000);
  assert.equal(r.createdAttempt, true);
});
