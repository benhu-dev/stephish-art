import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { EmailOutbox } from "../../src/collections/EmailOutbox.ts";
import { createOrderEmailOutboxJobs } from "../../src/server/email/emailOutbox.ts";

const fieldsByName = Object.fromEntries(
  EmailOutbox.fields.map((field) => [field.name, field]),
);
const optionValues = (field) =>
  field.options.map((option) =>
    typeof option === "string" ? option : option.value,
  );

test("Email Outbox has the minimal durable job contract and compound uniqueness", async () => {
  assert.equal(EmailOutbox.slug, "email-outbox");
  assert.equal(EmailOutbox.auth, undefined);
  assert.equal(EmailOutbox.disableBulkDelete, true);
  assert.equal(EmailOutbox.disableBulkEdit, true);
  assert.equal(EmailOutbox.disableDuplicate, true);
  assert.deepEqual(Object.keys(fieldsByName).sort(), [
    "attempts",
    "kind",
    "lastErrorCode",
    "lockedAt",
    "nextAttemptAt",
    "order",
    "providerMessageId",
    "sentAt",
    "status",
  ]);

  assert.equal(fieldsByName.order.type, "relationship");
  assert.equal(fieldsByName.order.relationTo, "orders");
  assert.equal(fieldsByName.order.required, true);
  assert.deepEqual(optionValues(fieldsByName.kind), [
    "customer_order_confirmation",
    "artist_new_order",
    "customer_shipped",
  ]);
  assert.equal(fieldsByName.kind.required, true);
  assert.deepEqual(optionValues(fieldsByName.status), [
    "pending",
    "processing",
    "sent",
    "failed",
  ]);
  assert.equal(fieldsByName.status.defaultValue, "pending");
  assert.equal(fieldsByName.status.required, true);
  assert.equal(fieldsByName.attempts.defaultValue, 0);
  assert.equal(fieldsByName.attempts.min, 0);
  assert.equal(fieldsByName.attempts.required, true);
  assert.equal(await fieldsByName.attempts.validate(0), true);
  assert.notEqual(await fieldsByName.attempts.validate(-1), true);
  assert.notEqual(await fieldsByName.attempts.validate(0.5), true);

  assert.deepEqual(EmailOutbox.indexes, [
    { fields: ["order", "kind"], unique: true },
  ]);
});

test("Email Outbox stores no recipient, content, order snapshot, or provider payload", () => {
  for (const forbidden of [
    "recipient",
    "email",
    "name",
    "address",
    "messageBody",
    "html",
    "text",
    "artistNote",
    "stripe",
    "upload",
    "metadata",
    "payload",
  ]) {
    assert.equal(fieldsByName[forbidden], undefined);
  }
});

test("Email Outbox is administrator-read-only through ordinary access", async () => {
  const anonymous = { req: { user: null } };
  const administrator = { req: { user: { collection: "users", id: 1 } } };

  assert.equal(await EmailOutbox.access.read(anonymous), false);
  assert.equal(await EmailOutbox.access.read(administrator), true);
  for (const operation of ["create", "update", "delete"]) {
    assert.equal(await EmailOutbox.access[operation](anonymous), false);
    assert.equal(await EmailOutbox.access[operation](administrator), false);
  }
});

test("paid-order fulfillment keeps its original two email kinds", async () => {
  const created = [];
  await createOrderEmailOutboxJobs({
    orderId: 41,
    request: {
      payload: {
        create: async (input) => { created.push(input.data); },
      },
    },
  });
  assert.deepEqual(created, [
    {
      attempts: 0,
      kind: "customer_order_confirmation",
      order: 41,
      status: "pending",
    },
    {
      attempts: 0,
      kind: "artist_new_order",
      order: 41,
      status: "pending",
    },
  ]);
});

test("outbox is registered while GraphQL remains disabled and no email provider is added", async () => {
  const [config, packageManifest, fulfillment] = await Promise.all([
    readFile(new URL("../../src/payload.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../../package.json", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../../src/server/stripe/stripeWebhookFulfillment.ts",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(config, /EmailOutbox/);
  assert.match(config, /graphQL:\s*\{\s*disable:\s*true/s);
  assert.doesNotMatch(packageManifest, /resend|sendgrid|postmark|mailgun|nodemailer/i);
  assert.doesNotMatch(fulfillment, /fetch\(|resend|sendgrid|postmark|mailgun|nodemailer/i);
});
