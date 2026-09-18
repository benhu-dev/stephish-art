import assert from "node:assert/strict";
import test from "node:test";

import { StripeEvents } from "../../src/collections/StripeEvents.ts";

const fieldsByName = Object.fromEntries(
  StripeEvents.fields.map((field) => [field.name, field]),
);
const optionValues = (field) =>
  field.options.map((option) =>
    typeof option === "string" ? option : option.value,
  );

test("Stripe Events is a minimal internal ledger with no raw or customer data", () => {
  assert.equal(StripeEvents.slug, "stripe-events");
  assert.equal(StripeEvents.auth, undefined);
  assert.equal(StripeEvents.disableDuplicate, true);
  assert.deepEqual(Object.keys(fieldsByName).sort(), [
    "checkoutIntent",
    "code",
    "disposition",
    "eventType",
    "processedAt",
    "stripeCreatedAt",
    "stripeEventId",
  ]);

  assert.equal(fieldsByName.stripeEventId.required, true);
  assert.equal(fieldsByName.stripeEventId.unique, true);
  assert.deepEqual(optionValues(fieldsByName.eventType), [
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed",
    "checkout.session.expired",
  ]);
  assert.deepEqual(optionValues(fieldsByName.disposition), [
    "processed",
    "ignored",
    "rejected",
  ]);
  assert.equal(fieldsByName.checkoutIntent.relationTo, "checkout-intents");
  assert.equal(fieldsByName.checkoutIntent.required, undefined);
  assert.equal(fieldsByName.stripeCreatedAt.required, true);
  assert.equal(fieldsByName.processedAt.required, true);

  for (const forbidden of [
    "payload",
    "signature",
    "secret",
    "email",
    "address",
    "customer",
    "card",
  ]) {
    assert.equal(fieldsByName[forbidden], undefined);
  }
});

test("Stripe Events is administrator-read-only through ordinary access", async () => {
  const anonymous = { req: { user: null } };
  const administrator = { req: { user: { collection: "users", id: 1 } } };

  assert.equal(await StripeEvents.access.read(anonymous), false);
  assert.equal(await StripeEvents.access.read(administrator), true);
  for (const operation of ["create", "update", "delete"]) {
    assert.equal(await StripeEvents.access[operation](anonymous), false);
    assert.equal(await StripeEvents.access[operation](administrator), false);
  }
});
