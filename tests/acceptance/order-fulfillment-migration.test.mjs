import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationURL = new URL(
  "../../src/migrations/20261002_105432_add_order_fulfillment.ts",
  import.meta.url,
);

test("fulfillment migration preserves legacy state and completion timestamp data", async () => {
  const migration = await readFile(migrationURL, "utf8");
  assert.match(migration, /RENAME COLUMN "completed_at" TO "delivered_at"/);
  assert.match(migration, /WHEN "order_status" = 'new' THEN 'unfulfilled'/);
  assert.match(migration, /WHEN "order_status" = 'completed' THEN 'delivered'/);
  assert.match(
    migration,
    /ENUM\('unfulfilled', 'in_progress', 'ready_to_ship', 'shipped', 'delivered'\)/,
  );
  assert.match(
    migration,
    /enum_orders_tracking_carrier" AS ENUM\('usps', 'ups', 'fedex', 'other'\)/,
  );
  assert.match(migration, /DROP COLUMN "tracking_url"/);
});

test("database constraints enforce tracking pairing, normalization, and timestamps", async () => {
  const migration = await readFile(migrationURL, "utf8");
  assert.match(migration, /orders_tracking_pair_check/);
  assert.match(migration, /orders_tracking_number_check/);
  assert.match(migration, /\^\[A-Z0-9\]\{6,64\}\$/);
  assert.match(migration, /orders_fulfillment_timestamps_check/);
  assert.match(migration, /"order_status" = 'shipped'/);
  assert.match(migration, /"order_status" = 'delivered'/);
});

test("the migration is registered and no provider or outbox code enters fulfillment", async () => {
  const [index, service, repository, endpoint, config] = await Promise.all([
    readFile(new URL("../../src/migrations/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/server/orders/orderFulfillmentService.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/server/orders/orderFulfillmentRepository.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/server/orders/orderFulfillmentEndpoint.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/payload.config.ts", import.meta.url), "utf8"),
  ]);
  assert.match(index, /20261002_105432_add_order_fulfillment/);
  assert.match(config, /\.\.\.orderFulfillmentEndpoints/);
  for (const source of [service, repository, endpoint]) {
    assert.doesNotMatch(source, /stripeGateway|resend|storage|email-outbox|emailOutbox/i);
  }
  assert.match(config, /graphQL:\s*{\s*disable:\s*true/s);
});
