import assert from "node:assert/strict";
import test from "node:test";

import {
  createOrderFulfillmentHandler,
  orderFulfillmentEndpoints,
} from "../../src/server/orders/orderFulfillmentEndpoint.ts";

const body = {
  expectedCurrentState: "unfulfilled",
  requestedNextState: "in_progress",
};

const requestFor = ({
  authenticated = true,
  contentType = "application/json",
  orderId = "17",
  origin = "https://shop.example",
  payload = body,
  query = "",
  rawBody,
} = {}) => {
  const request = new Request(`https://shop.example/api/admin/orders/${orderId}/fulfillment${query}`, {
    body: rawBody ?? JSON.stringify(payload),
    headers: {
      ...(contentType ? { "content-type": contentType } : {}),
      ...(origin ? { origin } : {}),
    },
    method: "PATCH",
  });
  request.user = authenticated ? { collection: "users", id: 1 } : null;
  request.routeParams = { orderId };
  request.payload = { logger: { error: () => {} } };
  return request;
};

test("the root endpoint has the exact method and path", () => {
  assert.equal(orderFulfillmentEndpoints.length, 1);
  assert.equal(orderFulfillmentEndpoints[0].method, "patch");
  assert.equal(
    orderFulfillmentEndpoints[0].path,
    "/admin/orders/:orderId/fulfillment",
  );
});

test("administrator session and same-origin checks run before mutation", async () => {
  let calls = 0;
  const handler = createOrderFulfillmentHandler(async () => {
    calls += 1;
    return { state: "in_progress" };
  });
  for (const [request, expected] of [
    [requestFor({ authenticated: false }), 401],
    [requestFor({ origin: null }), 403],
    [requestFor({ origin: "https://attacker.invalid" }), 403],
  ]) {
    const response = await handler(request);
    assert.equal(response.status, expected);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal(calls, 0);
});

test("query, content type, malformed ID, JSON, and exact body failures are rejected", async () => {
  let calls = 0;
  const handler = createOrderFulfillmentHandler(async () => { calls += 1; });
  const requests = [
    [requestFor({ query: "?force=true" }), 400],
    [requestFor({ contentType: "text/plain" }), 415],
    [requestFor({ orderId: "abc" }), 400],
    [requestFor({ rawBody: "{" }), 400],
    [requestFor({ payload: { ...body, extra: true } }), 400],
    [requestFor({ payload: { ...body, trackingUrl: "https://example.invalid" } }), 400],
  ];
  for (const [request, status] of requests) {
    assert.equal((await handler(request)).status, status);
  }
  assert.equal(calls, 0);
});

test("valid requests pass only normalized, bounded input and return a private response", async () => {
  let received;
  const handler = createOrderFulfillmentHandler(async (input) => {
    received = input;
    return {
      deliveredAt: null,
      idempotent: false,
      shippedAt: null,
      state: "in_progress",
      tracking: null,
    };
  });
  const response = await handler(requestFor({
    payload: {
      ...body,
      tracking: { carrier: "ups", trackingNumber: " 1z-999 aa 101 " },
    },
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(received.orderId, 17);
  assert.deepEqual(received.input.tracking, {
    carrier: "ups",
    trackingNumber: "1Z999AA101",
  });
  assert.deepEqual(await response.json(), {
    deliveredAt: null,
    idempotent: false,
    shippedAt: null,
    state: "in_progress",
    tracking: null,
  });
});
