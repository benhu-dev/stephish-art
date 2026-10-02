import assert from "node:assert/strict";
import test from "node:test";

import {
  FULFILLMENT_STATES,
  OrderFulfillmentError,
} from "../../src/server/orders/orderFulfillmentContract.ts";
import { transitionOrderFulfillment } from "../../src/server/orders/orderFulfillmentService.ts";

const fixedNow = new Date("2026-07-04T16:30:45.123Z");

const orderFor = (overrides = {}) => ({
  amountCents: 900,
  deliveredAt: null,
  id: 17,
  orderStatus: "unfulfilled",
  paidAt: "2026-07-01T12:00:00.000Z",
  paymentStatus: "paid",
  refundedAmountCents: 0,
  refundState: "none",
  shippedAt: null,
  stripeDisputeId: null,
  stripeDisputeStatus: null,
  trackingCarrier: null,
  trackingNumber: null,
  ...overrides,
});

const repositoryFor = (initial, { throwOnEnqueue = false } = {}) => {
  let stored = structuredClone(initial);
  let updates = 0;
  let jobs = [];
  const events = [];
  let queue = Promise.resolve();
  return {
    events,
    get jobs() {
      return structuredClone(jobs);
    },
    get order() {
      return structuredClone(stored);
    },
    get updates() {
      return updates;
    },
    repository: {
      transaction: async (_request, operation) => {
        const previous = queue;
        let release;
        queue = new Promise((resolve) => { release = resolve; });
        await previous;
        const draft = structuredClone(stored);
        const draftJobs = structuredClone(jobs);
        try {
          const result = await operation({
            enqueueShipmentEmail: async (id) => {
              events.push("enqueue");
              if (throwOnEnqueue) throw new Error("synthetic enqueue failure");
              if (!draftJobs.some((job) => job.orderId === id)) {
                draftJobs.push({ kind: "customer_shipped", orderId: id });
              }
            },
            lockOrder: async (id) => id === draft.id ? structuredClone(draft) : null,
            updateOrder: async (id, update) => {
              assert.equal(id, draft.id);
              events.push("update");
              updates += 1;
              Object.assign(draft, update);
            },
          });
          stored = draft;
          jobs = draftJobs;
          events.push("commit");
          return result;
        } finally {
          release();
        }
      },
    },
  };
};

const run = (store, input, options = {}) =>
  transitionOrderFulfillment({
    attemptOrderEmailDelivery: async () => {},
    input,
    now: fixedNow,
    orderId: 17,
    repository: store.repository,
    request: {},
    ...options,
  });

const forward = {
  unfulfilled: "in_progress",
  in_progress: "ready_to_ship",
  ready_to_ship: "shipped",
  shipped: "delivered",
  delivered: null,
};

test("the exact forward matrix succeeds and reverse, skipped, and terminal changes fail", async () => {
  for (const current of FULFILLMENT_STATES) {
    for (const requested of FULFILLMENT_STATES) {
      const store = repositoryFor(orderFor({ orderStatus: current }));
      const input = { expectedCurrentState: current, requestedNextState: requested };
      if (requested === current) {
        assert.equal((await run(store, input)).idempotent, true);
      } else if (forward[current] === requested) {
        assert.equal((await run(store, input)).state, requested);
      } else {
        await assert.rejects(
          run(store, input),
          (error) => error instanceof OrderFulfillmentError && error.code === "INVALID_TRANSITION",
        );
      }
    }
  }
});

test("stale and concurrent transitions yield one update plus an idempotent retry", async () => {
  const store = repositoryFor(orderFor());
  const input = {
    expectedCurrentState: "unfulfilled",
    requestedNextState: "in_progress",
  };
  const results = await Promise.all([run(store, input), run(store, input)]);
  assert.equal(results.filter(({ idempotent }) => idempotent).length, 1);
  assert.equal(store.updates, 1);

  await assert.rejects(
    run(store, {
      expectedCurrentState: "unfulfilled",
      requestedNextState: "ready_to_ship",
    }),
    (error) => error.code === "FULFILLMENT_CONFLICT",
  );
});

test("tracking may be corrected before shipment and is immutable after shipment", async () => {
  const store = repositoryFor(orderFor({
    orderStatus: "ready_to_ship",
    trackingCarrier: "fedex",
    trackingNumber: "123456789012",
  }));
  const input = {
    expectedCurrentState: "ready_to_ship",
    requestedNextState: "shipped",
    tracking: { carrier: "usps", trackingNumber: "9400111899223856928499" },
  };
  const shipped = await run(store, input);
  assert.deepEqual(shipped.tracking, input.tracking);
  assert.equal(shipped.shippedAt, fixedNow.toISOString());
  assert.equal(shipped.deliveredAt, null);
  assert.match(shipped.shippedAt, /Z$/);

  assert.equal((await run(store, input)).idempotent, true);
  await assert.rejects(
    run(store, {
      ...input,
      tracking: { carrier: "fedex", trackingNumber: "123456789012" },
    }),
    (error) => error.code === "FULFILLMENT_CONFLICT",
  );
  await assert.rejects(
    run(store, {
      expectedCurrentState: "shipped",
      requestedNextState: "delivered",
      tracking: { carrier: "fedex", trackingNumber: "123456789012" },
    }),
    (error) => error.code === "FULFILLMENT_CONFLICT",
  );

  const delivered = await run(store, {
    expectedCurrentState: "shipped",
    requestedNextState: "delivered",
  });
  assert.equal(delivered.deliveredAt, fixedNow.toISOString());
  assert.equal(delivered.shippedAt, fixedNow.toISOString());
});

test("first shipment enqueues once transactionally and attempts delivery after commit", async () => {
  const store = repositoryFor(orderFor({ orderStatus: "ready_to_ship" }));
  const delivery = [];
  const input = {
    expectedCurrentState: "ready_to_ship",
    requestedNextState: "shipped",
    tracking: { carrier: "ups", trackingNumber: "1Z999AA10123456784" },
  };
  const first = await run(store, input, {
    attemptOrderEmailDelivery: async (orderId) => {
      delivery.push(orderId);
      store.events.push("delivery");
    },
  });
  assert.equal(first.state, "shipped");
  assert.deepEqual(store.jobs, [{ kind: "customer_shipped", orderId: 17 }]);
  assert.deepEqual(delivery, [17]);
  assert.deepEqual(store.events, ["update", "enqueue", "commit", "delivery"]);

  assert.equal((await run(store, input, {
    attemptOrderEmailDelivery: async () => { throw new Error("must not run"); },
  })).idempotent, true);
  assert.equal(store.jobs.length, 1);
});

test("non-shipping and delivered transitions never enqueue shipment email", async () => {
  const beforeShip = repositoryFor(orderFor());
  await run(beforeShip, {
    expectedCurrentState: "unfulfilled",
    requestedNextState: "in_progress",
  });
  assert.deepEqual(beforeShip.jobs, []);

  const delivered = repositoryFor(orderFor({
    orderStatus: "shipped",
    shippedAt: fixedNow.toISOString(),
  }));
  await run(delivered, {
    expectedCurrentState: "shipped",
    requestedNextState: "delivered",
  });
  assert.deepEqual(delivered.jobs, []);
});

test("enqueue failure rolls back shipment and provider failure preserves committed shipment", async () => {
  const enqueueFailure = repositoryFor(
    orderFor({ orderStatus: "ready_to_ship" }),
    { throwOnEnqueue: true },
  );
  await assert.rejects(
    run(enqueueFailure, {
      expectedCurrentState: "ready_to_ship",
      requestedNextState: "shipped",
    }),
    /synthetic enqueue failure/,
  );
  assert.equal(enqueueFailure.order.orderStatus, "ready_to_ship");
  assert.deepEqual(enqueueFailure.jobs, []);

  const providerFailure = repositoryFor(orderFor({ orderStatus: "ready_to_ship" }));
  const result = await run(
    providerFailure,
    {
      expectedCurrentState: "ready_to_ship",
      requestedNextState: "shipped",
    },
    {
      attemptOrderEmailDelivery: async () => {
        throw new Error("provider timeout");
      },
    },
  );
  assert.equal(result.state, "shipped");
  assert.equal(providerFailure.order.orderStatus, "shipped");
  assert.deepEqual(providerFailure.jobs, [{ kind: "customer_shipped", orderId: 17 }]);
});

test("concurrent shipment requests create and attempt one logical email", async () => {
  const store = repositoryFor(orderFor({ orderStatus: "ready_to_ship" }));
  let deliveries = 0;
  const input = {
    expectedCurrentState: "ready_to_ship",
    requestedNextState: "shipped",
  };
  const options = {
    attemptOrderEmailDelivery: async () => { deliveries += 1; },
  };
  const results = await Promise.all([
    run(store, input, options),
    run(store, input, options),
  ]);
  assert.equal(results.filter(({ idempotent }) => idempotent).length, 1);
  assert.equal(store.jobs.length, 1);
  assert.equal(deliveries, 1);
});

test("full refunds and unsafe disputes block while partial refunds and won disputes continue", async () => {
  for (const blocked of [
    orderFor({ paymentStatus: "refunded", refundedAmountCents: 900, refundState: "full" }),
    orderFor({ paymentStatus: "disputed", stripeDisputeId: "dp_lost", stripeDisputeStatus: "lost" }),
    orderFor({ paymentStatus: "disputed", stripeDisputeId: "dp_active", stripeDisputeStatus: "under_review" }),
  ]) {
    await assert.rejects(
      run(repositoryFor(blocked), {
        expectedCurrentState: "unfulfilled",
        requestedNextState: "in_progress",
      }),
      (error) => ["FULLY_REFUNDED", "DISPUTE_BLOCKED"].includes(error.code),
    );
  }

  for (const allowed of [
    orderFor({ paymentStatus: "partially_refunded", refundedAmountCents: 200, refundState: "partial" }),
    orderFor({ stripeDisputeId: "dp_won", stripeDisputeStatus: "won" }),
  ]) {
    assert.equal(
      (await run(repositoryFor(allowed), {
        expectedCurrentState: "unfulfilled",
        requestedNextState: "in_progress",
      })).state,
      "in_progress",
    );
  }
});

test("inconsistent payment state and rollback failures never commit an update", async () => {
  const inconsistent = repositoryFor(orderFor({ paymentStatus: "paid", refundState: "partial", refundedAmountCents: 100 }));
  await assert.rejects(
    run(inconsistent, { expectedCurrentState: "unfulfilled", requestedNextState: "in_progress" }),
    (error) => error.code === "ORDER_STATE_INCONSISTENT",
  );
  assert.equal(inconsistent.updates, 0);

  const rollback = repositoryFor(orderFor());
  await assert.rejects(
    run(
      rollback,
      { expectedCurrentState: "unfulfilled", requestedNextState: "in_progress" },
      { probe: { afterUpdate: () => { throw new Error("synthetic rollback"); } } },
    ),
    /synthetic rollback/,
  );
  assert.equal(rollback.order.orderStatus, "unfulfilled");
});

test("the persistence write contains only fulfillment fields", async () => {
  const original = orderFor({
    orderStatus: "ready_to_ship",
    stripeDisputeId: "dp_won",
    stripeDisputeStatus: "won",
  });
  let written;
  const repository = {
    transaction: async (_request, operation) => operation({
      enqueueShipmentEmail: async () => {},
      lockOrder: async () => structuredClone(original),
      updateOrder: async (_id, update) => { written = update; },
    }),
  };
  await transitionOrderFulfillment({
    input: {
      expectedCurrentState: "ready_to_ship",
      requestedNextState: "shipped",
      tracking: { carrier: "other", trackingNumber: "ABC123456" },
    },
    now: fixedNow,
    orderId: original.id,
    repository,
    request: {},
  });
  assert.deepEqual(Object.keys(written).sort(), [
    "orderStatus",
    "shippedAt",
    "trackingCarrier",
    "trackingNumber",
  ]);
});
