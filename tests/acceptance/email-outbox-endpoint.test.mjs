import assert from "node:assert/strict";
import test from "node:test";

import { handleEmailOutboxCronRequest } from "../../src/server/email/emailOutboxEndpoint.ts";

const secret = "a".repeat(32);
const summary = { failed: 1, retried: 2, scanned: 4, sent: 1, skipped: 0 };

test("cron requires the exact Bearer secret and rejects query overrides without work", async () => {
  for (const request of [
    new Request("https://example.test/api/internal/cron/email-outbox"),
    new Request("https://example.test/api/internal/cron/email-outbox", { headers: { authorization: `Bearer ${secret}x` } }),
    new Request("https://example.test/api/internal/cron/email-outbox?recipient=elsewhere", { headers: { authorization: `Bearer ${secret}` } }),
  ]) {
    let calls = 0;
    const response = await handleEmailOutboxCronRequest(request, {
      cronSecret: secret,
      runProcessor: async () => { calls += 1; return summary; },
    });
    assert.equal(calls, 0);
    assert.ok([400, 401].includes(response.status));
  }
});

test("cron returns only the safe aggregate summary", async () => {
  const response = await handleEmailOutboxCronRequest(
    new Request("https://example.test/api/internal/cron/email-outbox", {
      headers: { authorization: `Bearer ${secret}` },
    }),
    { cronSecret: secret, runProcessor: async () => summary },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), summary);
});
