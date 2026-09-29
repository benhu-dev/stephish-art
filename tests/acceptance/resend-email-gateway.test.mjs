import assert from "node:assert/strict";
import test from "node:test";

import {
  EmailProviderError,
  createResendEmailGateway,
} from "../../src/server/email/resendEmailGateway.ts";

const message = {
  from: "Stephish Art <orders@example.test>",
  html: "<p>Hello</p>",
  replyTo: "reply@example.test",
  subject: "Test",
  text: "Hello",
  to: "customer@example.test",
};

test("Resend request sends the exact content with a stable idempotency header", async () => {
  let request;
  const gateway = createResendEmailGateway({
    apiKey: "secret-never-printed",
    fetchImplementation: async (url, init) => {
      request = { init, url };
      return Response.json({ id: "provider-id" }, { status: 200 });
    },
  });
  const result = await gateway.send(message, "stable-key");
  assert.deepEqual(result, { providerMessageId: "provider-id" });
  assert.equal(request.url, "https://api.resend.com/emails");
  assert.equal(request.init.headers["Idempotency-Key"], "stable-key");
  assert.equal(request.init.headers.Authorization, "Bearer secret-never-printed");
  assert.ok(request.init.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(request.init.body), {
    from: message.from,
    html: message.html,
    reply_to: message.replyTo,
    subject: message.subject,
    text: message.text,
    to: [message.to],
  });
});

test("Resend failures expose only a safe retry classification", async () => {
  for (const [status, retryable, code] of [
    [429, true, "provider_rate_limited"],
    [503, true, "provider_unavailable"],
    [422, false, "provider_rejected"],
  ]) {
    const gateway = createResendEmailGateway({
      apiKey: "secret",
      fetchImplementation: async () =>
        Response.json({ message: "private provider body" }, { status }),
    });
    await assert.rejects(gateway.send(message, "stable-key"), (error) => {
      assert.ok(error instanceof EmailProviderError);
      assert.equal(error.retryable, retryable);
      assert.equal(error.code, code);
      assert.doesNotMatch(error.message, /private provider body/);
      return true;
    });
  }
});
