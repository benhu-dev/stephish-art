import assert from "node:assert/strict";
import test from "node:test";

import { readEmailDeliveryEnvironment } from "../../src/server/email/emailDeliveryEnvironment.ts";

const enabled = {
  ARTIST_ORDER_EMAIL: "artist@example.test",
  EMAIL_DELIVERY_ENABLED: "true",
  EMAIL_FROM: "Stephish Art <orders@example.test>",
  EMAIL_REPLY_TO: "reply@example.test",
  RESEND_API_KEY: "re_test_value_not_real",
};

test("delivery enablement is parsed strictly", () => {
  assert.equal(readEmailDeliveryEnvironment(enabled).enabled, true);
  assert.deepEqual(readEmailDeliveryEnvironment({ EMAIL_DELIVERY_ENABLED: "false" }), {
    enabled: false,
  });
  for (const value of [undefined, "TRUE", "1", "yes", " false", "false "]) {
    assert.throws(
      () => readEmailDeliveryEnvironment({ ...enabled, EMAIL_DELIVERY_ENABLED: value }),
      /EMAIL_DELIVERY_CONFIGURATION_INVALID/,
    );
  }
});

test("enabled delivery fails closed for every missing or unsafe value", () => {
  for (const name of [
    "ARTIST_ORDER_EMAIL",
    "EMAIL_FROM",
    "EMAIL_REPLY_TO",
    "RESEND_API_KEY",
  ]) {
    assert.throws(
      () => readEmailDeliveryEnvironment({ ...enabled, [name]: undefined }),
      /EMAIL_DELIVERY_CONFIGURATION_INVALID/,
    );
  }
  assert.throws(
    () => readEmailDeliveryEnvironment({ ...enabled, EMAIL_FROM: "bad\r\nBcc: leak@example.test" }),
    /EMAIL_DELIVERY_CONFIGURATION_INVALID/,
  );
});
