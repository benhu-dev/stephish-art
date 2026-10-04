import assert from "node:assert/strict";
import test from "node:test";

import { Orders } from "../../src/collections/Orders.ts";

const fieldsByName = Object.fromEntries(
  Orders.fields.map((field) => [field.name, field]),
);
const shippingFields = Object.fromEntries(
  fieldsByName.shippingAddress.fields.map((field) => [field.name, field]),
);
const optionValues = (field) =>
  field.options.map((option) =>
    typeof option === "string" ? option : option.value,
  );

test("Orders has exactly the approved non-auth field contract", () => {
  assert.equal(Orders.slug, "orders");
  assert.equal(Orders.auth, undefined);
  assert.equal(Orders.disableDuplicate, true);
  assert.deepEqual(Object.keys(fieldsByName).sort(), [
    "amountCents",
    "artistNote",
    "checkoutIntent",
    "contactEmail",
    "createdAtDisplay",
    "currency",
    "customer",
    "deliveredAt",
    "orderStatus",
    "paidAt",
    "paymentStatus",
    "recipientNameDisplay",
    "refundState",
    "refundedAmountCents",
    "shippedAt",
    "shippingAddress",
    "stripeCheckoutSessionId",
    "stripeDisputeId",
    "stripeDisputeStatus",
    "stripePaymentIntentId",
    "trackingCarrier",
    "trackingNumber",
    "viewOrder",
    "workbench",
  ]);

  assert.equal(fieldsByName.workbench.type, "ui");
  assert.equal(
    fieldsByName.workbench.admin.components.Field,
    "/src/components/admin/orders/OrderWorkbenchField#OrderWorkbench",
  );

  assert.equal(fieldsByName.customer.type, "relationship");
  assert.equal(fieldsByName.customer.relationTo, "customers");
  assert.equal(fieldsByName.customer.required, true);
  assert.equal(fieldsByName.checkoutIntent.type, "relationship");
  assert.equal(fieldsByName.checkoutIntent.relationTo, "checkout-intents");
  assert.equal(fieldsByName.checkoutIntent.required, true);
  assert.equal(fieldsByName.checkoutIntent.unique, true);

  assert.equal(fieldsByName.contactEmail.type, "email");
  assert.equal(fieldsByName.contactEmail.required, true);
  assert.equal(fieldsByName.amountCents.type, "number");
  assert.equal(fieldsByName.amountCents.required, true);
  assert.equal(fieldsByName.amountCents.min, 1);

  for (const name of ["stripeCheckoutSessionId", "stripePaymentIntentId"]) {
    assert.equal(fieldsByName[name].type, "text");
    assert.equal(fieldsByName[name].required, true);
    assert.equal(fieldsByName[name].unique, true);
  }

  assert.equal(fieldsByName.paidAt.type, "date");
  assert.equal(fieldsByName.paidAt.required, true);
  assert.equal(fieldsByName.paidAt.admin.date.pickerAppearance, "dayAndTime");
  assert.equal(fieldsByName.shippedAt.type, "date");
  assert.equal(fieldsByName.shippedAt.required, undefined);
  assert.equal(fieldsByName.shippedAt.admin.date.pickerAppearance, "dayAndTime");
  assert.equal(fieldsByName.deliveredAt.type, "date");
  assert.equal(fieldsByName.deliveredAt.required, undefined);
  assert.equal(fieldsByName.deliveredAt.admin.date.pickerAppearance, "dayAndTime");
});

test("Orders defines the exact currency and status values", () => {
  assert.deepEqual(optionValues(fieldsByName.currency), ["usd"]);
  assert.equal(fieldsByName.currency.defaultValue, "usd");
  assert.equal(fieldsByName.currency.required, true);

  assert.deepEqual(optionValues(fieldsByName.orderStatus), [
    "unfulfilled",
    "in_progress",
    "ready_to_ship",
    "shipped",
    "delivered",
  ]);
  assert.equal(fieldsByName.orderStatus.defaultValue, "unfulfilled");
  assert.equal(fieldsByName.orderStatus.required, true);

  assert.deepEqual(optionValues(fieldsByName.paymentStatus), [
    "paid",
    "partially_refunded",
    "refunded",
    "disputed",
  ]);
  assert.equal(fieldsByName.paymentStatus.defaultValue, "paid");
  assert.equal(fieldsByName.paymentStatus.required, true);

  assert.deepEqual(optionValues(fieldsByName.refundState), [
    "none",
    "partial",
    "full",
  ]);
  assert.equal(fieldsByName.refundState.defaultValue, "none");
  assert.equal(fieldsByName.refundState.required, true);
  assert.deepEqual(optionValues(fieldsByName.stripeDisputeStatus), [
    "lost",
    "needs_response",
    "prevented",
    "under_review",
    "warning_closed",
    "warning_needs_response",
    "warning_under_review",
    "won",
  ]);
});

test("Orders enforces amount and snapshot normalization rules", async () => {
  const normalizeEmail = fieldsByName.contactEmail.hooks.beforeValidate[0];
  const validateAmount = fieldsByName.amountCents.validate;

  assert.equal(
    await normalizeEmail({ value: "  ORDER@EXAMPLE.INVALID  " }),
    "order@example.invalid",
  );
  assert.equal(await validateAmount(1), true);
  assert.equal(await validateAmount(499), true);
  assert.notEqual(await validateAmount(0), true);
  assert.notEqual(await validateAmount(1.5), true);
  assert.notEqual(await validateAmount(undefined), true);

  const validateRefundedAmount = fieldsByName.refundedAmountCents.validate;
  assert.equal(await validateRefundedAmount(0), true);
  assert.equal(await validateRefundedAmount(499), true);
  assert.notEqual(await validateRefundedAmount(-1), true);
  assert.notEqual(await validateRefundedAmount(1.5), true);
});

test("Orders has the exact shipping and fulfillment contract", async () => {
  assert.equal(fieldsByName.shippingAddress.type, "group");
  assert.equal(fieldsByName.shippingAddress.required, true);
  assert.deepEqual(Object.keys(shippingFields).sort(), [
    "city",
    "country",
    "line1",
    "line2",
    "postalCode",
    "recipientName",
    "state",
  ]);

  for (const [name, maximum] of [
    ["recipientName", 150],
    ["line1", 200],
    ["line2", 200],
    ["city", 100],
    ["state", 100],
    ["postalCode", 32],
  ]) {
    assert.equal(shippingFields[name].type, "text");
    assert.equal(shippingFields[name].maxLength, maximum);
  }
  for (const name of ["recipientName", "line1", "city"]) {
    assert.equal(shippingFields[name].required, true);
  }
  for (const name of ["line2", "state", "postalCode"]) {
    assert.equal(shippingFields[name].required, undefined);
  }

  assert.equal(shippingFields.country.type, "text");
  assert.equal(shippingFields.country.required, true);
  assert.equal(shippingFields.country.minLength, 2);
  assert.equal(shippingFields.country.maxLength, 2);
  assert.equal(
    await shippingFields.country.hooks.beforeValidate[0]({ value: " us " }),
    "US",
  );
  assert.equal(await shippingFields.country.validate("US"), true);
  assert.notEqual(await shippingFields.country.validate("USA"), true);

  assert.equal(fieldsByName.trackingCarrier.type, "select");
  assert.deepEqual(optionValues(fieldsByName.trackingCarrier), [
    "usps",
    "ups",
    "fedex",
    "other",
  ]);
  assert.equal(fieldsByName.trackingNumber.maxLength, 64);
});

test("Orders exposes the approved Admin columns", () => {
  assert.equal(Orders.defaultSort, "-createdAt");
  assert.equal(Orders.disableBulkDelete, true);
  assert.equal(Orders.disableBulkEdit, true);
  assert.equal(Orders.admin.group, "Orders");
  assert.equal(
    Orders.admin.components.views.list.Component,
    "/src/components/admin/orders/OrderListView#OrderListView",
  );
  assert.deepEqual(Orders.admin.defaultColumns, [
    "viewOrder",
    "createdAtDisplay",
    "recipientNameDisplay",
    "contactEmail",
    "amountCents",
    "orderStatus",
    "refundState",
    "stripeDisputeStatus",
  ]);
  assert.equal(fieldsByName.viewOrder.type, "ui");
  assert.equal(fieldsByName.viewOrder.label, "Order");
  assert.equal(
    fieldsByName.viewOrder.admin.components.Cell,
    "/src/components/admin/orders/OrderListCells#OrderViewCell",
  );
  assert.equal(fieldsByName.recipientNameDisplay.type, "ui");
  assert.equal(fieldsByName.recipientNameDisplay.label, "Recipient Name");
  assert.equal(fieldsByName.contactEmail.label, "Customer Email");
  assert.equal(
    fieldsByName.amountCents.admin.components.Cell,
    "/src/components/admin/orders/OrderListCells#OrderTotalCell",
  );
});

test("Orders ordinary access denies create/delete and gates read/update", async () => {
  const anonymous = { req: { user: null } };
  const authenticated = {
    req: { user: { collection: "users", id: 1 } },
  };

  for (const context of [anonymous, authenticated]) {
    assert.equal(await Orders.access.create(context), false);
    assert.equal(await Orders.access.delete(context), false);
  }
  assert.equal(await Orders.access.read(anonymous), false);
  assert.equal(await Orders.access.update(anonymous), false);
  assert.equal(await Orders.access.read(authenticated), true);
  assert.equal(await Orders.access.update(authenticated), false);
});

test("Orders immutable payment fields deny ordinary authenticated updates", async () => {
  const authenticated = {
    req: { user: { collection: "users", id: 1 } },
  };
  const immutableFields = [
    "customer",
    "contactEmail",
    "amountCents",
    "currency",
    "stripeCheckoutSessionId",
    "stripePaymentIntentId",
    "paidAt",
    "paymentStatus",
    "refundState",
    "refundedAmountCents",
    "stripeDisputeId",
    "stripeDisputeStatus",
  ];
  for (const name of immutableFields) {
    assert.equal(typeof fieldsByName[name].access.update, "function");
    assert.equal(await fieldsByName[name].access.update(authenticated), false);
  }
  assert.equal(typeof fieldsByName.shippingAddress.access.update, "function");
  assert.equal(
    await fieldsByName.shippingAddress.access.update(authenticated),
    false,
  );

  for (const name of [
    "orderStatus",
    "trackingCarrier",
    "trackingNumber",
    "shippedAt",
    "deliveredAt",
  ]) {
    assert.equal(typeof fieldsByName[name].access.update, "function");
    assert.equal(await fieldsByName[name].access.update(authenticated), false);
  }
});
