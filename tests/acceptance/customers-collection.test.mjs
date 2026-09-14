import assert from "node:assert/strict";
import test from "node:test";

import { Customers } from "../../src/collections/Customers.ts";

const fieldsByName = Object.fromEntries(
  Customers.fields.map((field) => [field.name, field]),
);

test("Customers has only the approved guest-customer fields", () => {
  assert.equal(Customers.slug, "customers");
  assert.equal(Customers.auth, undefined);
  assert.deepEqual(Object.keys(fieldsByName).sort(), [
    "email",
    "fullName",
    "stripeCustomerId",
  ]);

  assert.equal(fieldsByName.fullName.type, "text");
  assert.equal(fieldsByName.fullName.required, true);
  assert.equal(fieldsByName.fullName.maxLength, 150);

  assert.equal(fieldsByName.email.type, "email");
  assert.equal(fieldsByName.email.required, true);
  assert.equal(fieldsByName.email.unique, true);

  assert.equal(fieldsByName.stripeCustomerId.type, "text");
  assert.equal(fieldsByName.stripeCustomerId.required, undefined);
  assert.equal(fieldsByName.stripeCustomerId.unique, true);
});

test("Customers normalizes names and emails before validation", async () => {
  const normalizeName = fieldsByName.fullName.hooks.beforeValidate[0];
  const normalizeEmail = fieldsByName.email.hooks.beforeValidate[0];

  assert.equal(await normalizeName({ value: "  Example Customer  " }), "Example Customer");
  assert.equal(
    await normalizeEmail({ value: "  TEST@EXAMPLE.INVALID  " }),
    "test@example.invalid",
  );
  assert.equal(await normalizeName({ value: undefined }), undefined);
  assert.equal(await normalizeEmail({ value: undefined }), undefined);
});

test("Customers uses the approved Admin presentation", () => {
  assert.equal(Customers.admin.useAsTitle, "email");
  assert.deepEqual(Customers.admin.defaultColumns, [
    "fullName",
    "email",
    "updatedAt",
  ]);
});

test("Customers denies anonymous CRUD and permits an authenticated Payload user", async () => {
  const anonymous = { req: { user: null } };
  const authenticated = {
    req: { user: { collection: "users", id: 1 } },
  };

  for (const operation of ["create", "read", "update", "delete"]) {
    const access = Customers.access[operation];

    assert.equal(typeof access, "function");
    assert.equal(await access(anonymous), false, `${operation} should deny anonymous callers`);
    assert.equal(
      await access(authenticated),
      true,
      `${operation} should permit an authenticated Payload user`,
    );
  }
});
