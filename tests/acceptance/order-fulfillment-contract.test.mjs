import assert from "node:assert/strict";
import test from "node:test";

import {
  FULFILLMENT_STATES,
  OrderFulfillmentError,
  parseFulfillmentTransitionInput,
  parseOrderId,
} from "../../src/server/orders/orderFulfillmentContract.ts";

const valid = {
  expectedCurrentState: "ready_to_ship",
  requestedNextState: "shipped",
};

test("the exact fulfillment states and tracking normalization contract are accepted", () => {
  assert.deepEqual(FULFILLMENT_STATES, [
    "unfulfilled",
    "in_progress",
    "ready_to_ship",
    "shipped",
    "delivered",
  ]);
  assert.deepEqual(
    parseFulfillmentTransitionInput({
      ...valid,
      tracking: { carrier: "ups", trackingNumber: " 1z-999 aa 101 " },
    }),
    {
      ...valid,
      tracking: { carrier: "ups", trackingNumber: "1Z999AA101" },
    },
  );
  assert.equal(parseOrderId("42"), 42);
});

test("body shape, state, carrier, tracking pairing, and tracking characters are strict", () => {
  const invalidBodies = [
    null,
    [],
    {},
    { ...valid, extra: true },
    { ...valid, tracking: null },
    { ...valid, tracking: { carrier: "ups" } },
    { ...valid, tracking: { trackingNumber: "1Z999AA101" } },
    { ...valid, tracking: { carrier: "dhl", trackingNumber: "ABC123" } },
    { ...valid, tracking: { carrier: "ups", trackingNumber: "short" } },
    { ...valid, tracking: { carrier: "ups", trackingNumber: "ABC/123" } },
    { ...valid, tracking: { carrier: "ups", trackingNumber: "ABC123", url: "https://example.invalid" } },
    { ...valid, trackingUrl: "https://example.invalid" },
    { ...valid, requestedNextState: "completed" },
  ];
  for (const body of invalidBodies) {
    assert.throws(
      () => parseFulfillmentTransitionInput(body),
      OrderFulfillmentError,
    );
  }
  for (const id of [undefined, "", "0", "-1", "1.0", "abc", "9007199254740992"]) {
    assert.throws(() => parseOrderId(id), OrderFulfillmentError);
  }
});
