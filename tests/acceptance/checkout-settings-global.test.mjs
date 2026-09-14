import assert from "node:assert/strict";
import test from "node:test";

import { Orders } from "../../src/collections/Orders.ts";
import { CheckoutSettings } from "../../src/globals/CheckoutSettings.ts";

const [minimumAmountCents] = CheckoutSettings.fields;

test("Checkout Settings has the exact private one-field contract", () => {
  assert.equal(CheckoutSettings.slug, "checkout-settings");
  assert.equal(CheckoutSettings.label, "Checkout Settings");
  assert.equal(CheckoutSettings.admin.group, "Settings");
  assert.equal(CheckoutSettings.fields.length, 1);

  assert.equal(minimumAmountCents.name, "minimumAmountCents");
  assert.equal(minimumAmountCents.label, "Minimum Payment Amount (cents)");
  assert.equal(minimumAmountCents.type, "number");
  assert.equal(minimumAmountCents.required, true);
  assert.equal(minimumAmountCents.defaultValue, 500);
  assert.equal(minimumAmountCents.min, 1);
  assert.equal(
    minimumAmountCents.admin.description,
    "Enter an integer number of cents. 500 = $5.00.",
  );
});

test("Checkout Settings accepts only finite positive integer cents", async () => {
  const validate = minimumAmountCents.validate;

  assert.equal(await validate(1), true);
  assert.equal(await validate(500), true);

  for (const value of [
    0,
    -1,
    1.5,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NaN,
    "500",
    null,
    undefined,
  ]) {
    assert.notEqual(await validate(value), true, `${String(value)} must fail`);
  }
});

test("Checkout Settings access denies anonymous callers and permits Payload users", async () => {
  const anonymous = { req: { user: null } };
  const authenticated = {
    req: { user: { collection: "users", id: 1 } },
  };

  for (const operation of ["read", "update"]) {
    const access = CheckoutSettings.access[operation];

    assert.equal(await access(anonymous), false);
    assert.equal(await access(authenticated), true);
  }
});

test("Checkout Settings does not alter historical Orders validation", async () => {
  const orderAmount = Orders.fields.find(({ name }) => name === "amountCents");

  assert.equal(orderAmount.min, 1);
  assert.equal(await orderAmount.validate(1), true);
  assert.equal(await orderAmount.validate(499), true);
  assert.equal(
    Orders.fields.some(({ name }) => name === "minimumAmountCents"),
    false,
  );
});
