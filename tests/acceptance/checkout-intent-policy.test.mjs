import assert from "node:assert/strict";
import test from "node:test";

import {
  CHECKOUT_INTENT_POLICY,
  calculateCheckoutIntentDeadlines,
} from "../../src/server/checkout-intents/checkoutIntentPolicy.ts";
import {
  generateCheckoutIntentToken,
  hashCheckoutIntentToken,
  issueCheckoutIntentCredential,
} from "../../src/server/checkout-intents/checkoutIntentCredentials.ts";

test("Checkout Intent policy has one exact lifetime and upload contract", () => {
  assert.deepEqual(CHECKOUT_INTENT_POLICY, {
    activeLifetimeMs: 24 * 60 * 60 * 1000,
    combinedUploadLimitBytes: 30 * 1024 * 1024,
    deletionEligibilityMs: 48 * 60 * 60 * 1000,
    maximumUploads: 3,
    perFileUploadLimitBytes: 15 * 1024 * 1024,
  });
});

test("Checkout Intent deadlines share one creation time", () => {
  const createdAt = new Date("2026-09-15T12:34:56.789Z");
  const deadlines = calculateCheckoutIntentDeadlines(createdAt);

  assert.equal(
    deadlines.expiresAt.getTime() - createdAt.getTime(),
    24 * 60 * 60 * 1000,
  );
  assert.equal(
    deadlines.deleteAfter.getTime() - createdAt.getTime(),
    48 * 60 * 60 * 1000,
  );
  assert.throws(
    () => calculateCheckoutIntentDeadlines(new Date(Number.NaN)),
    /valid creation time/,
  );
});

test("Checkout Intent tokens contain 256 random bits and do not repeat", () => {
  const tokens = Array.from({ length: 64 }, () => generateCheckoutIntentToken());

  assert.equal(new Set(tokens).size, tokens.length);
  for (const token of tokens) {
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(token, "base64url").length, 32);
  }
});

test("Checkout Intent token hashes are deterministic lowercase SHA-256", () => {
  const rawToken = generateCheckoutIntentToken();
  const firstHash = hashCheckoutIntentToken(rawToken);

  assert.equal(hashCheckoutIntentToken(rawToken), firstHash);
  assert.match(firstHash, /^[0-9a-f]{64}$/);
  assert.notEqual(
    hashCheckoutIntentToken(generateCheckoutIntentToken()),
    firstHash,
  );
});

test("issued persistence data never includes the raw token", () => {
  const createdAt = new Date("2026-09-15T12:34:56.789Z");
  const credential = issueCheckoutIntentCredential(createdAt);

  assert.deepEqual(Object.keys(credential).sort(), ["createData", "rawToken"]);
  assert.deepEqual(Object.keys(credential.createData).sort(), [
    "accessTokenHash",
    "deleteAfter",
    "expiresAt",
  ]);
  assert.equal(JSON.stringify(credential.createData).includes(credential.rawToken), false);
  assert.match(credential.createData.accessTokenHash, /^[0-9a-f]{64}$/);
  assert.equal(
    new Date(credential.createData.expiresAt).getTime() - createdAt.getTime(),
    24 * 60 * 60 * 1000,
  );
  assert.equal(
    new Date(credential.createData.deleteAfter).getTime() - createdAt.getTime(),
    48 * 60 * 60 * 1000,
  );
});
