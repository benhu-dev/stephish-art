import assert from "node:assert/strict";
import test from "node:test";

import { EmailProviderError } from "../../src/server/email/resendEmailGateway.ts";
import { processEmailOutbox } from "../../src/server/email/emailOutboxProcessor.ts";

const order = {
  artistNote: null,
  currency: "usd",
  customerEmail: "customer@example.test",
  customerName: "Customer",
  referencePhotoCount: 1,
  shippingAddress: {
    city: "Test City",
    country: "US",
    line1: "1 Test Way",
    line2: null,
    postalCode: "00000",
    recipientName: "Customer",
    state: "CA",
  },
  shippingCents: 100,
  subtotalCents: 500,
  totalCents: 600,
  shipment: {
    carrier: "usps",
    shippedAt: "2027-01-15T17:00:00.000Z",
    trackingNumber: "9400111899223856928499",
  },
};

const configuration = {
  apiKey: "secret",
  artistOrderEmail: "artist@example.test",
  enabled: true,
  from: "orders@example.test",
  replyTo: "reply@example.test",
};

const makeRepository = (jobs) => {
  const calls = [];
  return {
    calls,
    async failExhausted() {
      calls.push(["failExhausted"]);
      return 0;
    },
    async claim(options) {
      calls.push(["claim", options]);
      return jobs.splice(0, options.limit);
    },
    async loadOrder() {
      calls.push(["loadOrder"]);
      return order;
    },
    async markFailed(job, code) {
      calls.push(["failed", job.id, code]);
      return true;
    },
    async markRetry(job, code, nextAttemptAt) {
      calls.push(["retry", job.id, code, nextAttemptAt]);
      return true;
    },
    async markSent(job, providerMessageId, sentAt) {
      calls.push(["sent", job.id, providerMessageId, sentAt]);
      return true;
    },
  };
};

test("successful jobs transition to sent only after provider acceptance", async () => {
  const repository = makeRepository([
    { attempts: 1, id: 11, kind: "customer_order_confirmation", lease: "lease", orderId: 9 },
  ]);
  const events = [];
  const summary = await processEmailOutbox({
    configuration,
    gateway: { async send() { events.push("accepted"); return { providerMessageId: "provider-id" }; } },
    now: new Date("2027-01-01T00:00:00.000Z"),
    repository,
  });
  events.push(repository.calls.find((call) => call[0] === "sent")?.[0]);
  assert.deepEqual(events, ["accepted", "sent"]);
  assert.deepEqual(summary, { failed: 0, retried: 0, scanned: 1, sent: 1, skipped: 0 });
});

test("transient failures back off and the final attempt becomes terminal", async () => {
  for (const [attempts, expectedCall, expectedSummary] of [
    [1, "retry", { failed: 0, retried: 1, scanned: 1, sent: 0, skipped: 0 }],
    [5, "failed", { failed: 1, retried: 0, scanned: 1, sent: 0, skipped: 0 }],
  ]) {
    const repository = makeRepository([
      { attempts, id: attempts, kind: "customer_order_confirmation", lease: "lease", orderId: 9 },
    ]);
    const summary = await processEmailOutbox({
      configuration,
      gateway: { async send() { throw new EmailProviderError("provider_unavailable", true); } },
      now: new Date("2027-01-01T00:00:00.000Z"),
      repository,
    });
    assert.deepEqual(summary, expectedSummary);
    assert.ok(repository.calls.some((call) => call[0] === expectedCall));
  }
});

test("disabled delivery performs no claim, mutation, or provider call", async () => {
  let sent = false;
  const repository = makeRepository([]);
  const summary = await processEmailOutbox({
    configuration: { enabled: false },
    gateway: { async send() { sent = true; throw new Error("must not run"); } },
    repository,
  });
  assert.deepEqual(summary, { failed: 0, retried: 0, scanned: 0, sent: 0, skipped: 1 });
  assert.equal(repository.calls.length, 0);
  assert.equal(sent, false);
});

test("stale exhausted leases become terminal without contacting the provider", async () => {
  let sent = false;
  const repository = makeRepository([]);
  repository.failExhausted = async () => 1;
  const summary = await processEmailOutbox({
    configuration,
    gateway: { async send() { sent = true; return { providerMessageId: "bad" }; } },
    now: new Date("2027-01-01T00:00:00.000Z"),
    repository,
  });
  assert.deepEqual(summary, { failed: 1, retried: 0, scanned: 1, sent: 0, skipped: 0 });
  assert.equal(sent, false);
});

test("already-sent jobs remain terminal because only claimed jobs are processed", async () => {
  const repository = makeRepository([]);
  let sent = false;
  const summary = await processEmailOutbox({
    configuration,
    gateway: { async send() { sent = true; return { providerMessageId: "bad" }; } },
    repository,
  });
  assert.equal(summary.scanned, 0);
  assert.equal(sent, false);
});

test("shipment worker retries reuse one stable provider idempotency key", async () => {
  const keys = [];
  const job = {
    attempts: 1,
    id: 77,
    kind: "customer_shipped",
    lease: "lease-1",
    orderId: 9,
  };
  const first = makeRepository([]);
  first.claim = async () => [job];
  await processEmailOutbox({
    configuration,
    gateway: {
      async send(_message, key) {
        keys.push(key);
        throw new EmailProviderError("provider_unavailable", true);
      },
    },
    repository: first,
  });

  const second = makeRepository([]);
  second.claim = async () => [{ ...job, attempts: 2, lease: "lease-2" }];
  await processEmailOutbox({
    configuration,
    gateway: {
      async send(_message, key) {
        keys.push(key);
        return { providerMessageId: "accepted-on-retry" };
      },
    },
    repository: second,
  });
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
  assert.match(keys[0], /customer_shipped\/77$/);
});
