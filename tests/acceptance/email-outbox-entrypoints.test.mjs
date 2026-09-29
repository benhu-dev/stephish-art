import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseEmailOutboxArguments } from "../../src/server/email/emailOutboxCli.ts";

test("manual delivery is one-shot and rejects all overrides", () => {
  assert.equal(parseEmailOutboxArguments([]), undefined);
  for (const arguments_ of [["--recipient=x"], ["--order=1"], ["--execute"]]) {
    assert.throws(() => parseEmailOutboxArguments(arguments_));
  }
});

test("CLI, protected route, and one daily Hobby-compatible fallback are wired", async () => {
  const [manifest, vercel, route, script, environment] = await Promise.all([
    readFile(new URL("../../package.json", import.meta.url), "utf8"),
    readFile(new URL("../../vercel.json", import.meta.url), "utf8"),
    readFile(
      new URL("../../src/app/api/internal/cron/email-outbox/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../../scripts/email-outbox.ts", import.meta.url), "utf8"),
    readFile(new URL("../../.env.example", import.meta.url), "utf8"),
  ]);
  assert.equal(JSON.parse(manifest).scripts["email:deliver"], "tsx scripts/email-outbox.ts");
  const emailCrons = JSON.parse(vercel).crons.filter(
    ({ path }) => path === "/api/internal/cron/email-outbox",
  );
  assert.equal(emailCrons.length, 1);
  assert.match(emailCrons[0].schedule, /^\d{1,2} \d{1,2} \* \* \*$/);
  assert.match(route, /CRON_SECRET/);
  assert.match(route, /handleEmailOutboxCronRequest/);
  assert.doesNotMatch(route, /searchParams|recipient|orderId/);
  assert.match(script, /await closePayload\(payload\)/);
  assert.doesNotMatch(script, /process\.exit\(/);
  for (const name of [
    "EMAIL_DELIVERY_ENABLED",
    "RESEND_API_KEY",
    "EMAIL_FROM",
    "EMAIL_REPLY_TO",
    "ARTIST_ORDER_EMAIL",
  ]) {
    assert.match(environment, new RegExp(`^${name}=`, "m"));
  }
  assert.doesNotMatch(environment, /re_[A-Za-z0-9_-]{20,}/);
});
