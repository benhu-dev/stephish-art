import assert from "node:assert/strict";
import test from "node:test";

import {
  abandonCurrentCheckout,
  readCurrentCheckoutState,
} from "../../src/features/checkout/checkoutRecoveryClient.ts";

const safeState = (status) => ({
  amountCents: 900,
  artistNote: "",
  expiresAt: "2026-09-26T20:00:00.000Z",
  limits: {
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    maxFileBytes: 15 * 1024 * 1024,
    maxFiles: 3,
    maxTotalBytes: 30 * 1024 * 1024,
    minimumAmountCents: 500,
  },
  ...(status === "draft" ? {} : { shippingAmountCents: 100, totalAmountCents: 1000 }),
  status,
  uploads: [],
});

test("abandon uses the exact protected empty-object contract", async () => {
  const calls = [];
  const result = await abandonCurrentCheckout({
    fetchImpl: async (...args) => {
      calls.push(args);
      return new Response(null, { status: 204 });
    },
  });
  assert.deepEqual(result, { kind: "abandoned" });
  assert.equal(calls[0][0], "/api/storefront/checkout-intents/current/abandon");
  assert.deepEqual(calls[0][1], {
    body: JSON.stringify({}),
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    },
    method: "POST",
  });
});

test("current checkout hydration distinguishes draft, recovery, and fresh state", async () => {
  for (const status of ["checkout_pending", "checkout_created"]) {
    assert.deepEqual(await readCurrentCheckoutState({
      fetchImpl: async () => Response.json(safeState(status), { status: 200 }),
    }), { kind: "recovery" });
  }
  const draft = await readCurrentCheckoutState({
    fetchImpl: async () => Response.json(safeState("draft"), { status: 200 }),
  });
  assert.equal(draft.kind, "draft");
  assert.equal(draft.state.amountCents, 900);
  for (const status of [401, 410]) {
    assert.deepEqual(await readCurrentCheckoutState({
      fetchImpl: async () => Response.json({}, { status }),
    }), { kind: "fresh" });
  }
});

test("malformed hydration and private fields never enter recovery state", async () => {
  for (const body of [
    { ...safeState("checkout_created"), stripeSessionId: "cs_test_private" },
    { ...safeState("checkout_created"), totalAmountCents: 999 },
  ]) {
    assert.deepEqual(await readCurrentCheckoutState({
      fetchImpl: async () => Response.json(body, { status: 200 }),
    }), { kind: "failed" });
  }
  assert.deepEqual(await readCurrentCheckoutState({
    fetchImpl: async () => Response.json(safeState("completed"), { status: 200 }),
  }), { kind: "processing" });
});

test("abandon failure kinds are safe, explicit, and retryable", async () => {
  for (const [status, kind] of [[409, "processing"], [401, "fresh"], [410, "fresh"], [503, "failed"]]) {
    const result = await abandonCurrentCheckout({
      fetchImpl: async () => Response.json({ error: { code: "PRIVATE_DETAIL" } }, { status }),
    });
    assert.equal(result.kind, kind);
    assert.equal(JSON.stringify(result).includes("PRIVATE_DETAIL"), false);
  }
});
