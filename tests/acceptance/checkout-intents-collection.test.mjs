import assert from "node:assert/strict";
import test from "node:test";

import { CheckoutIntents } from "../../src/collections/CheckoutIntents.ts";

const fieldsByName = Object.fromEntries(
  CheckoutIntents.fields.map((field) => [field.name, field]),
);

test("Checkout Intents has the exact private stored schema and virtual Join", () => {
  assert.equal(CheckoutIntents.slug, "checkout-intents");
  assert.deepEqual(Object.keys(fieldsByName), [
    "status",
    "amountCents",
    "accessTokenHash",
    "expiresAt",
    "deleteAfter",
    "uploads",
  ]);
  assert.equal(CheckoutIntents.timestamps, true);
  assert.equal(CheckoutIntents.admin.group, "Orders");
  assert.equal(CheckoutIntents.disableDuplicate, true);
  assert.equal(CheckoutIntents.disableBulkEdit, true);
  assert.equal(CheckoutIntents.disableBulkDelete, true);

  assert.equal(fieldsByName.status.type, "select");
  assert.equal(fieldsByName.status.required, true);
  assert.equal(fieldsByName.status.defaultValue, "draft");
  assert.deepEqual(
    fieldsByName.status.options.map((option) => option.value),
    ["draft", "checkout_created", "completed", "expired"],
  );

  assert.deepEqual(fieldsByName.uploads, {
    name: "uploads",
    type: "join",
    collection: "order-uploads",
    on: "checkoutIntent",
    defaultLimit: 3,
    defaultSort: "position",
    admin: { allowCreate: false },
  });
});

test("Checkout Intents contains no PII, payment, order, or plaintext token fields", () => {
  const forbiddenNames = [
    "name",
    "email",
    "phone",
    "address",
    "ipAddress",
    "userAgent",
    "customer",
    "order",
    "stripe",
    "rawToken",
    "accessToken",
  ];
  const configuredNames = CheckoutIntents.fields.map((field) => field.name);

  for (const forbiddenName of forbiddenNames) {
    assert.equal(configuredNames.includes(forbiddenName), false);
  }
});

test("Checkout Intent amounts require positive integer cents", async () => {
  const amount = fieldsByName.amountCents;

  assert.equal(amount.type, "number");
  assert.equal(amount.required, true);
  assert.equal(amount.min, 1);
  assert.equal(await amount.validate(1), true);
  assert.notEqual(await amount.validate(0), true);
  assert.notEqual(await amount.validate(1.5), true);
  assert.notEqual(await amount.validate(Number.NaN), true);
  assert.notEqual(await amount.validate("1"), true);
});

test("Checkout Intent token hashes are hidden, immutable, unique, and exact", async () => {
  const tokenHash = fieldsByName.accessTokenHash;

  assert.equal(tokenHash.type, "text");
  assert.equal(tokenHash.required, true);
  assert.equal(tokenHash.unique, true);
  assert.equal(tokenHash.minLength, 64);
  assert.equal(tokenHash.maxLength, 64);
  assert.equal(tokenHash.admin.hidden, true);
  assert.equal(await tokenHash.access.read(), false);
  assert.equal(await tokenHash.access.update(), false);
  assert.equal(await tokenHash.validate("a".repeat(64)), true);
  assert.notEqual(await tokenHash.validate("A".repeat(64)), true);
  assert.notEqual(await tokenHash.validate("a".repeat(63)), true);
  assert.notEqual(await tokenHash.validate("g".repeat(64)), true);
});

test("Checkout Intent deadlines are indexed and deletion follows expiry", async () => {
  assert.equal(fieldsByName.expiresAt.type, "date");
  assert.equal(fieldsByName.expiresAt.required, true);
  assert.equal(fieldsByName.expiresAt.index, true);
  assert.equal(fieldsByName.deleteAfter.type, "date");
  assert.equal(fieldsByName.deleteAfter.required, true);
  assert.equal(fieldsByName.deleteAfter.index, true);

  const expiresAt = "2026-09-16T00:00:00.000Z";
  assert.equal(
    await fieldsByName.deleteAfter.validate("2026-09-17T00:00:00.000Z", {
      siblingData: { expiresAt },
    }),
    true,
  );
  assert.notEqual(
    await fieldsByName.deleteAfter.validate(expiresAt, {
      siblingData: { expiresAt },
    }),
    true,
  );
  assert.notEqual(
    await fieldsByName.deleteAfter.validate("2026-09-15T00:00:00.000Z", {
      siblingData: { expiresAt },
    }),
    true,
  );
});

test("Checkout Intent ordinary access is administrator read-only", async () => {
  const anonymous = { req: { user: null } };
  const authenticated = { req: { user: { collection: "users", id: 1 } } };

  assert.equal(await CheckoutIntents.access.read(anonymous), false);
  assert.equal(await CheckoutIntents.access.read(authenticated), true);
  for (const operation of ["create", "update", "delete"]) {
    assert.equal(await CheckoutIntents.access[operation](anonymous), false);
    assert.equal(await CheckoutIntents.access[operation](authenticated), false);
  }
});
