import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOrderEmailMessage,
  emailIdempotencyKey,
} from "../../src/server/email/orderEmailTemplates.ts";

const order = {
  artistNote: "Paint <sunset> & tea 'brightly'",
  currency: "usd",
  customerEmail: "customer@example.test",
  customerName: "Ava & <Kai>",
  referencePhotoCount: 2,
  shippingAddress: {
    city: "New <York>",
    country: "US",
    line1: "1 & 2 Art Way",
    line2: "Apt \"Five\"",
    postalCode: "10001",
    recipientName: "Ava & <Kai>",
    state: "NY",
  },
  shippingCents: 125,
  subtotalCents: 5_000,
  totalCents: 5_125,
};

const configuration = {
  artistOrderEmail: "artist@example.test",
  from: "Stephish Art <orders@example.test>",
  replyTo: "reply@example.test",
};

test("customer confirmation uses the immutable order recipient and exact totals", () => {
  const message = buildOrderEmailMessage(
    "customer_order_confirmation",
    order,
    configuration,
  );

  assert.equal(message.to, order.customerEmail);
  assert.equal(message.subject, "Your postcard order is confirmed");
  assert.equal(message.replyTo, configuration.replyTo);
  for (const exact of ["$50.00", "$1.25", "$51.25", "2 reference photos"]) {
    assert.match(message.text, new RegExp(exact.replace("$", "\\$")));
    assert.match(message.html, new RegExp(exact.replace("$", "\\$")));
  }
  assert.match(message.text, /1 & 2 Art Way\nApt "Five"\nNew <York>, NY 10001\nUS/);
  assert.match(message.text, /Paint <sunset> & tea 'brightly'/);
  assert.doesNotMatch(message.html, /Ava & <Kai>|Paint <sunset>|1 & 2 Art Way|Apt "Five"/);
  assert.match(message.html, /Ava &amp; &lt;Kai&gt;/);
  assert.match(message.html, /Paint &lt;sunset&gt; &amp; tea &#39;brightly&#39;/);
  assert.doesNotMatch(message.html, /<img|https?:\/\//i);
});

test("artist notification uses only the configured artist recipient", () => {
  const message = buildOrderEmailMessage(
    "artist_new_order",
    order,
    configuration,
  );

  assert.equal(message.to, configuration.artistOrderEmail);
  assert.equal(message.subject, "New paid postcard order");
  assert.equal(message.replyTo, configuration.replyTo);
  assert.match(message.text, /customer@example\.test/);
  assert.match(message.text, /authenticated Payload admin/i);
  assert.match(message.html, /authenticated Payload admin/i);
  assert.doesNotMatch(
    `${message.text}${message.html}`,
    /stripe|checkout intent|storage|signed url|webhook/i,
  );
});

test("artist note is omitted cleanly when absent", () => {
  for (const kind of ["customer_order_confirmation", "artist_new_order"]) {
    const message = buildOrderEmailMessage(
      kind,
      { ...order, artistNote: null },
      configuration,
    );
    assert.doesNotMatch(message.text, /artist note/i);
    assert.doesNotMatch(message.html, /artist note/i);
  }
});

test("idempotency keys are stable, bounded, and distinct per job kind", () => {
  const customer = emailIdempotencyKey(42, "customer_order_confirmation");
  const artist = emailIdempotencyKey(42, "artist_new_order");
  assert.equal(customer, emailIdempotencyKey(42, "customer_order_confirmation"));
  assert.notEqual(customer, artist);
  assert.ok(customer.length <= 256);
  assert.ok(artist.length <= 256);
});
