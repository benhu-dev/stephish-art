import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

import {
  fulfillmentActionFor,
  fulfillmentWarningFor,
} from "../../src/components/admin/orders/orderWorkbenchContract.ts";
import { OrderWorkbenchDetails } from "../../src/components/admin/orders/OrderWorkbenchDetails.tsx";
import { readOrderWorkbench } from "../../src/server/orders/orderWorkbenchService.ts";

const order = {
  amountCents: 1600,
  artistNote: '<img src=x onerror="alert(1)"> & hello',
  checkoutIntent: 12,
  contactEmail: "hostile@example.invalid<script>",
  createdAt: "2026-01-15T14:30:00.000Z",
  customer: 11,
  deliveredAt: null,
  id: 41,
  orderStatus: "unfulfilled",
  refundState: "none",
  refundedAmountCents: 0,
  shippedAt: null,
  shippingAddress: {
    recipientName: "A <script>alert(1)</script>",
    line1: "1 Main St",
    city: "New York",
    state: "NY",
    postalCode: "10001",
    country: "US",
  },
  stripeDisputeStatus: null,
  trackingCarrier: null,
  trackingNumber: null,
};

const payloadFor = () => {
  const calls = [];
  return {
    calls,
    payload: {
      findByID: async (args) => {
        calls.push({ operation: "findByID", args });
        if (args.collection === "orders") return structuredClone(order);
        if (args.collection === "customers") {
          return { id: 11, fullName: "Customer <b>Name</b>" };
        }
        if (args.collection === "checkout-intents") {
          return {
            id: 12,
            amountCents: 1500,
            shippingAmountCents: 100,
            totalAmountCents: 1600,
          };
        }
        throw new Error("unexpected collection");
      },
      find: async (args) => {
        calls.push({ operation: "find", args });
        return {
          docs: [
            { id: 73, mimeType: "image/png", position: 1 },
            { id: 74, mimeType: "image/jpeg", position: 2 },
          ],
        };
      },
    },
  };
};

test("each fulfillment state exposes exactly its current next action", () => {
  assert.deepEqual(fulfillmentActionFor("unfulfilled"), {
    label: "Start Work",
    nextState: "in_progress",
  });
  assert.deepEqual(fulfillmentActionFor("in_progress"), {
    label: "Mark Ready to Ship",
    nextState: "ready_to_ship",
  });
  assert.deepEqual(fulfillmentActionFor("ready_to_ship"), {
    label: "Mark Shipped",
    nextState: "shipped",
  });
  assert.deepEqual(fulfillmentActionFor("shipped"), {
    label: "Mark Delivered",
    nextState: "delivered",
  });
  assert.equal(fulfillmentActionFor("delivered"), null);
});

test("full refunds and unsafe disputes have visible blocking explanations", () => {
  assert.match(
    fulfillmentWarningFor({ refundState: "full", stripeDisputeStatus: null }),
    /fully refunded/i,
  );
  assert.match(
    fulfillmentWarningFor({ refundState: "none", stripeDisputeStatus: "under_review" }),
    /dispute/i,
  );
  assert.equal(
    fulfillmentWarningFor({ refundState: "partial", stripeDisputeStatus: "won" }),
    null,
  );
});

test("workbench reads through administrator access, formats New York time, and exposes no storage metadata", async () => {
  const fixture = payloadFor();
  const request = { payload: fixture.payload, user: { collection: "users", id: 1 } };
  const result = await readOrderWorkbench({ orderId: 41, request });

  assert.equal(result.customer.name, "Customer <b>Name</b>");
  assert.equal(result.amounts.subtotal, "$15.00");
  assert.equal(result.amounts.shipping, "$1.00");
  assert.equal(result.amounts.total, "$16.00");
  assert.equal(result.timestamps.created, "Jan 15, 2026, 9:30 AM EST (New York time)");
  assert.deepEqual(result.uploads, [
    { id: 73, mimeType: "image/png", position: 1 },
    { id: 74, mimeType: "image/jpeg", position: 2 },
  ]);
  assert.doesNotMatch(
    JSON.stringify(result),
    /filename|objectKey|bucket|stripeCheckout|stripePayment|stripeDisputeId/i,
  );
  assert.equal(
    fixture.calls
      .filter(({ args }) => args.collection !== "checkout-intents")
      .every(({ args }) => args.overrideAccess === false),
    true,
  );
  assert.equal(
    fixture.calls.find(({ args }) => args.collection === "checkout-intents")
      .args.overrideAccess,
    true,
  );
  assert.equal(fixture.calls.every(({ args }) => args.req === request), true);
  assert.equal(fixture.calls.some(({ operation }) => operation.includes("update")), false);
});

test("hostile customer and note content is rendered only as escaped text", () => {
  const fixture = {
    amounts: { shipping: "$1.00", subtotal: "$15.00", total: "$16.00" },
    artistNote: order.artistNote,
    customer: { email: order.contactEmail, name: "Customer <b>Name</b>" },
    fulfillment: {
      deliveredAt: null,
      orderStatus: "unfulfilled",
      refundState: "none",
      refundedAmount: "$0.00",
      shippedAt: null,
      stripeDisputeStatus: null,
      tracking: null,
    },
    orderId: 41,
    shippingAddress: order.shippingAddress,
    timestamps: {
      created: "Jan 15, 2026, 9:30 AM EST (New York time)",
      delivered: null,
      shipped: null,
    },
    uploads: [{ id: 73, mimeType: "image/png", position: 1 }],
  };
  const html = renderToStaticMarkup(
    React.createElement(OrderWorkbenchDetails, {
      data: fixture,
      error: null,
      onSubmit: () => {},
      pending: false,
    }),
  );
  assert.match(html, /Customer &lt;b&gt;Name&lt;\/b&gt;/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; hello/);
  assert.doesNotMatch(html, /<script|<img src=x|dangerouslySetInnerHTML/i);
  assert.match(html, /aria-label="Preview reference image 1"/);
  assert.match(html, /Download reference image 1/);
  assert.match(html, /href="\/admin\/collections\/orders">Back to Orders<\/a>/);
  assert.match(html, /<button type="button">Start Work<\/button>/);
});
