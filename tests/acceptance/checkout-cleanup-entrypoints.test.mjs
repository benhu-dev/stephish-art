import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseCheckoutCleanupArguments } from "../../src/server/checkout-cleanup/checkoutCleanupCli.ts";
import { handleCheckoutCleanupCronRequest } from "../../src/server/checkout-cleanup/checkoutCleanupEndpoint.ts";

const endpoint = "https://shop.example/api/internal/cron/checkout-cleanup";
const secret = "A".repeat(32);
const summary = {
  eligible: 1,
  intentsDeleted: 1,
  retryableFailures: 0,
  scanned: 1,
  skippedActive: 0,
  skippedProtected: 0,
  storageObjectsDeleted: 1,
  stripeSessionsExpired: 0,
  uploadRowsDeleted: 1,
};

test("CLI is dry-run by default and accepts only the explicit execute flag", () => {
  assert.deepEqual(parseCheckoutCleanupArguments([]), { execute: false });
  assert.deepEqual(parseCheckoutCleanupArguments(["--execute"]), {
    execute: true,
  });
  for (const arguments_ of [["--dry-run"], ["--execute", "extra"], ["--force"]]) {
    assert.throws(() => parseCheckoutCleanupArguments(arguments_));
  }
});

test("missing configuration or invalid Cron authorization performs zero work", async () => {
  for (const fixture of [
    { authorization: `Bearer ${secret}`, cronSecret: undefined, status: 500 },
    { authorization: undefined, cronSecret: secret, status: 401 },
    { authorization: "Bearer wrong", cronSecret: secret, status: 401 },
    { authorization: `bearer ${secret}`, cronSecret: secret, status: 401 },
  ]) {
    let calls = 0;
    const response = await handleCheckoutCleanupCronRequest(
      new Request(endpoint, {
        headers: fixture.authorization
          ? { Authorization: fixture.authorization }
          : {},
      }),
      {
        cronSecret: fixture.cronSecret,
        runCleanup: async () => {
          calls += 1;
          return summary;
        },
      },
    );
    assert.equal(response.status, fixture.status);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(calls, 0);
    assert.equal(/wrong|AAAA/.test(await response.text()), false);
  }
});

test("valid Cron authorization runs one execute batch and rejects query options", async () => {
  const calls = [];
  const runCleanup = async (options) => {
    calls.push(options);
    return summary;
  };
  const response = await handleCheckoutCleanupCronRequest(
    new Request(endpoint, {
      headers: { Authorization: `Bearer ${secret}` },
    }),
    { cronSecret: secret, runCleanup },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), summary);
  assert.deepEqual(calls, [{ execute: true }]);

  const rejected = await handleCheckoutCleanupCronRequest(
    new Request(`${endpoint}?execute=false`, {
      headers: { Authorization: `Bearer ${secret}` },
    }),
    { cronSecret: secret, runCleanup },
  );
  assert.equal(rejected.status, 400);
  assert.equal(calls.length, 1);
});

test("Cron failures are generic and summaries contain aggregate keys only", async () => {
  const response = await handleCheckoutCleanupCronRequest(
    new Request(endpoint, {
      headers: { Authorization: `Bearer ${secret}` },
    }),
    {
      cronSecret: secret,
      runCleanup: async () => {
        throw new Error("private key filename customer@example.invalid");
      },
    },
  );
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Cleanup failed." });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(Object.keys(summary).sort(), [
    "eligible",
    "intentsDeleted",
    "retryableFailures",
    "scanned",
    "skippedActive",
    "skippedProtected",
    "storageObjectsDeleted",
    "stripeSessionsExpired",
    "uploadRowsDeleted",
  ]);
});

test("Vercel schedule, package script, placeholder, and documentation are exact", async () => {
  const [vercel, packageJson, environment, readme] = await Promise.all([
    readFile(new URL("../../vercel.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../../package.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../../README.md", import.meta.url), "utf8"),
  ]);
  assert.deepEqual(vercel.crons, [
    {
      path: "/api/internal/cron/checkout-cleanup",
      schedule: "0 10 * * *",
    },
  ]);
  assert.equal(packageJson.scripts["checkout:cleanup"], "tsx scripts/checkout-cleanup.ts");
  assert.match(environment, /^CRON_SECRET=replace-with-/m);
  for (const term of [
    "10:00 UTC",
    "CRON_SECRET",
    "npm run checkout:cleanup",
    "npm run checkout:cleanup -- --execute",
    "Vercel Cron logs",
    "paid-order",
  ]) {
    assert.equal(readme.includes(term), true, `missing ${term}`);
  }
});
