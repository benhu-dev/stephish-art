import assert from "node:assert/strict";
import test from "node:test";

import {
  GENERIC_RATE_LIMIT_MESSAGE,
  readRetryAfterSeconds,
} from "../../src/features/checkout/checkoutRateLimitClient.ts";
import { submitCheckoutAmount, saveCheckoutArtistNote } from "../../src/features/checkout/checkoutIntentClient.ts";
import { deletePhoto, readCurrentPhotos, uploadPhoto } from "../../src/features/checkout/checkoutPhotoClient.ts";
import { createCheckoutPhotoPreviewManager } from "../../src/features/checkout/checkoutPhotoPreviewClient.ts";
import { readCurrentCheckoutState, abandonCurrentCheckout } from "../../src/features/checkout/checkoutRecoveryClient.ts";
import { requestCheckoutSession } from "../../src/features/checkout/checkoutSessionClient.ts";

const limited = (retryAfter = "23") => Response.json(
  { error: { code: "RATE_LIMITED" } },
  { headers: { "Retry-After": retryAfter }, status: 429 },
);

test("Retry-After accepts only bounded positive integer seconds", () => {
  assert.equal(readRetryAfterSeconds(limited("23")), 23);
  for (const value of [null, "0", "-1", "1.5", "901", "date", "2,3"]) {
    const response = limited("1");
    if (value === null) response.headers.delete("retry-after");
    else response.headers.set("retry-after", value);
    assert.equal(readRetryAfterSeconds(response), null);
  }
});

test("user-action clients return one generic retry-later treatment for 429", async () => {
  const fetchImpl = async () => limited();
  assert.deepEqual(await submitCheckoutAmount(825, { fetchImpl }), {
    message: GENERIC_RATE_LIMIT_MESSAGE,
    ok: false,
  });
  assert.deepEqual(await saveCheckoutArtistNote("hello", { fetchImpl }), {
    message: GENERIC_RATE_LIMIT_MESSAGE,
    ok: false,
  });
  assert.deepEqual(await requestCheckoutSession({ fetchImpl }), {
    kind: "failed",
    message: GENERIC_RATE_LIMIT_MESSAGE,
    retryAfterSeconds: 23,
  });
  assert.deepEqual(await abandonCurrentCheckout({ fetchImpl }), {
    kind: "failed",
    message: GENERIC_RATE_LIMIT_MESSAGE,
    retryAfterSeconds: 23,
  });
});

test("photo and recovery clients preserve rate-limit classification without retry loops", async () => {
  const fetchImpl = async () => limited("17");
  assert.deepEqual(await uploadPhoto(
    new File([new Uint8Array([1])], "one.png", { type: "image/png" }),
    1,
    { fetchImpl },
  ), { kind: "rate_limited", retryAfterSeconds: 17 });
  assert.deepEqual(await deletePhoto(19, { fetchImpl }), {
    kind: "rate_limited",
    retryAfterSeconds: 17,
  });
  assert.deepEqual(await readCurrentPhotos({ fetchImpl }), {
    kind: "rate_limited",
    retryAfterSeconds: 17,
  });
  const previewManager = createCheckoutPhotoPreviewManager({ fetchImpl });
  assert.deepEqual(await previewManager.load(19), {
    kind: "rate_limited",
    retryAfterSeconds: 17,
  });
  previewManager.dispose();
  assert.deepEqual(await readCurrentCheckoutState({ fetchImpl }), {
    kind: "rate_limited",
    retryAfterSeconds: 17,
  });
});
