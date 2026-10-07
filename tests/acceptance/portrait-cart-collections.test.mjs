import assert from "node:assert/strict";
import test from "node:test";

import { CheckoutPortraits } from "../../src/collections/CheckoutPortraits.ts";
import { OrderPortraits } from "../../src/collections/OrderPortraits.ts";
import { OrderUploads } from "../../src/collections/OrderUploads.ts";

const fieldsByName = (collection) =>
  Object.fromEntries(collection.fields.map((field) => [field.name, field]));

test("draft portraits are private server-mutated cart records", async () => {
  assert.equal(CheckoutPortraits.slug, "checkout-portraits");
  assert.equal(CheckoutPortraits.disableBulkDelete, true);
  assert.equal(CheckoutPortraits.disableBulkEdit, true);
  assert.equal(CheckoutPortraits.disableDuplicate, true);
  assert.deepEqual(CheckoutPortraits.indexes, [
    { fields: ["intent", "position"], unique: true },
  ]);

  const fields = fieldsByName(CheckoutPortraits);
  assert.deepEqual(Object.keys(fields), [
    "intent",
    "publicId",
    "template",
    "position",
    "subjects",
    "artistNote",
    "amountCents",
  ]);
  assert.equal(fields.intent.relationTo, "checkout-intents");
  assert.equal(fields.template.relationTo, "postcard-templates");
  assert.equal(fields.publicId.unique, true);
  assert.equal(fields.subjects.minRows, 1);
  assert.equal(fields.subjects.maxRows, 3);
  assert.deepEqual(
    fields.subjects.fields.map((field) => field.name),
    ["subjectId", "name", "kind", "position"],
  );

  const anonymous = { req: { user: null } };
  const artist = { req: { user: { collection: "users", id: 1 } } };
  assert.equal(await CheckoutPortraits.access.read(anonymous), false);
  assert.equal(await CheckoutPortraits.access.read(artist), true);
  for (const operation of ["create", "update", "delete"]) {
    assert.equal(await CheckoutPortraits.access[operation](anonymous), false);
    assert.equal(await CheckoutPortraits.access[operation](artist), false);
  }
});

test("paid portrait snapshots are authenticated-readable and immutable", async () => {
  assert.equal(OrderPortraits.slug, "order-portraits");
  assert.deepEqual(OrderPortraits.indexes, [
    { fields: ["order", "position"], unique: true },
  ]);
  const fields = fieldsByName(OrderPortraits);
  assert.deepEqual(Object.keys(fields), [
    "order",
    "sourceCheckoutPortraitId",
    "position",
    "templateId",
    "templateName",
    "templateDescription",
    "templatePreviewMedia",
    "templatePreviewAlt",
    "subjects",
    "artistNote",
    "amountCents",
  ]);
  assert.equal(fields.order.relationTo, "orders");
  assert.equal(fields.templatePreviewMedia.relationTo, "template-media");
  assert.equal(fields.amountCents.admin.readOnly, true);

  const anonymous = { req: { user: null } };
  const artist = { req: { user: { collection: "users", id: 1 } } };
  assert.equal(await OrderPortraits.access.read(anonymous), false);
  assert.equal(await OrderPortraits.access.read(artist), true);
  for (const operation of ["create", "update", "delete"]) {
    assert.equal(await OrderPortraits.access[operation](anonymous), false);
    assert.equal(await OrderPortraits.access[operation](artist), false);
  }
});

test("order uploads have optional forward-compatible portrait subject mapping", async () => {
  const fields = fieldsByName(OrderUploads);
  assert.equal(fields.checkoutPortrait.relationTo, "checkout-portraits");
  assert.equal(fields.checkoutPortrait.required, undefined);
  assert.equal(fields.checkoutPortrait.index, true);
  assert.equal(
    await fields.checkoutPortrait.access.update({ req: { user: {} } }),
    false,
  );
  assert.equal(fields.subjectIds.type, "json");
  assert.equal(
    await fields.subjectIds.access.update({ req: { user: {} } }),
    false,
  );
  assert.equal(await fields.subjectIds.validate(undefined), true);
  assert.equal(
    await fields.subjectIds.validate([
      "a9f42c44-5a8b-4c2d-9431-66bd108cf261",
    ]),
    true,
  );
  assert.notEqual(await fields.subjectIds.validate([]), true);
  assert.notEqual(await fields.subjectIds.validate(["not-a-uuid"]), true);
});
