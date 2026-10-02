import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOrderEmailMessage,
  emailIdempotencyKey,
  trackingUrlFor,
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
  shipment: {
    carrier: "ups",
    shippedAt: "2027-01-15T17:00:00.000Z",
    trackingNumber: "1Z999AA10123456784",
  },
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
  const shipped = emailIdempotencyKey(42, "customer_shipped");
  assert.equal(customer, emailIdempotencyKey(42, "customer_order_confirmation"));
  assert.notEqual(customer, artist);
  assert.notEqual(customer, shipped);
  assert.notEqual(artist, shipped);
  assert.ok(customer.length <= 256);
  assert.ok(artist.length <= 256);
  assert.ok(shipped.length <= 256);
});

test("supported carriers use only strict server-authored HTTPS tracking hosts", () => {
  const cases = [
    ["usps", "tools.usps.com", "9400111899223856928499"],
    ["ups", "www.ups.com", "1Z999AA10123456784"],
    ["fedex", "www.fedex.com", "123456789012"],
  ];
  for (const [carrier, host, trackingNumber] of cases) {
    const value = trackingUrlFor(carrier, trackingNumber);
    const url = new URL(value);
    assert.equal(url.protocol, "https:");
    assert.equal(url.hostname, host);
    assert.match(decodeURIComponent(url.href), new RegExp(trackingNumber));
  }
  assert.equal(trackingUrlFor("other", "ABC123456"), null);
  assert.equal(trackingUrlFor("ups", "ABC/123"), null);
  assert.equal(trackingUrlFor("ups", "<script>"), null);
});

test("customer shipment templates use committed tracking and New York dates", () => {
  for (const [carrier, trackingNumber, host] of [
    ["usps", "9400111899223856928499", "tools.usps.com"],
    ["ups", "1Z999AA10123456784", "www.ups.com"],
    ["fedex", "123456789012", "www.fedex.com"],
  ]) {
    const message = buildOrderEmailMessage(
      "customer_shipped",
      {
        ...order,
        shipment: {
          carrier,
          shippedAt: "2027-07-15T16:00:00.000Z",
          trackingNumber,
        },
      },
      configuration,
    );
    assert.equal(message.to, order.customerEmail);
    assert.equal(message.subject, "Your postcard is on its way");
    assert.equal(message.replyTo, configuration.replyTo);
    assert.match(message.text, /Jul 15, 2027, 12:00 PM EDT \(New York time\)/);
    assert.match(message.html, /Jul 15, 2027, 12:00 PM EDT \(New York time\)/);
    assert.match(message.text, new RegExp(trackingNumber));
    assert.match(message.html, new RegExp(`https://${host.replaceAll(".", "\\.")}`));
  }
});

test("other and absent tracking render cleanly without clickable tracking URLs", () => {
  const other = buildOrderEmailMessage(
    "customer_shipped",
    {
      ...order,
      shipment: {
        carrier: "other",
        shippedAt: "2027-01-15T17:00:00.000Z",
        trackingNumber: "OTHER123456",
      },
    },
    configuration,
  );
  assert.match(other.text, /Carrier: Other/);
  assert.match(other.text, /Tracking number: OTHER123456/);
  assert.match(other.text, /Jan 15, 2027, 12:00 PM EST \(New York time\)/);
  assert.doesNotMatch(other.html, /<a\b/i);

  const untracked = buildOrderEmailMessage(
    "customer_shipped",
    {
      ...order,
      shipment: {
        carrier: null,
        shippedAt: "2027-01-15T17:00:00.000Z",
        trackingNumber: null,
      },
    },
    configuration,
  );
  assert.doesNotMatch(untracked.text, /Carrier:|Tracking number:|Tracking link:/);
  assert.doesNotMatch(untracked.html, /<a\b|Carrier|Tracking number/i);
});

test("shipment HTML escapes customer data and omits private order material", () => {
  const message = buildOrderEmailMessage(
    "customer_shipped",
    {
      ...order,
      artistNote: "PRIVATE_ARTIST_NOTE_pi_private_signed_url",
      customerName: "Ava <script> & Kai",
      shipment: {
        carrier: "ups",
        shippedAt: "2027-01-15T17:00:00.000Z",
        trackingNumber: "1Z999AA10123456784",
      },
    },
    configuration,
  );
  assert.match(message.html, /Ava &lt;script&gt; &amp; Kai/);
  assert.doesNotMatch(message.html, /Ava <script>/);
  assert.doesNotMatch(
    `${message.text}${message.html}`,
    /PRIVATE_ARTIST_NOTE|pi_private|signed_url|checkout|stripe|webhook|storage|upload|customer id|order id/i,
  );
  assert.equal("attachments" in message, false);
});
