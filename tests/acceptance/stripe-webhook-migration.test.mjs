import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationURL = new URL(
  "../../src/migrations/20260918_073547_add_stripe_webhook_fulfillment.ts",
  import.meta.url,
);
const snapshotURL = new URL(
  "../../src/migrations/20260918_073547_add_stripe_webhook_fulfillment.json",
  import.meta.url,
);

test("webhook fulfillment migration is additive, constrained, and RLS protected", async () => {
  const source = await readFile(migrationURL, "utf8");
  const up = source.split("export async function down")[0];

  assert.match(up, /CREATE TABLE "stripe_events"/);
  assert.match(
    up,
    /ALTER TABLE "public"\."stripe_events" ENABLE ROW LEVEL SECURITY/,
  );
  assert.match(up, /stripe_events_stripe_event_id_idx/);
  assert.match(up, /orders_checkout_intent_idx/);
  assert.match(up, /order_uploads_order_idx/);
  assert.match(up, /FOREIGN KEY \("checkout_intent_id"\).*"checkout_intents"/s);
  assert.match(up, /FOREIGN KEY \("order_id"\).*"orders"/s);
  assert.doesNotMatch(up, /CREATE POLICY|DISABLE ROW LEVEL SECURITY/i);
  assert.doesNotMatch(up, /DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/i);
});

test("migration snapshot contains only the approved ledger and relationships", async () => {
  const snapshot = JSON.parse(await readFile(snapshotURL, "utf8"));
  const ledger = snapshot.tables["public.stripe_events"];

  assert.ok(ledger);
  assert.deepEqual(
    Object.keys(ledger.columns)
      .filter((name) => !["id", "created_at", "updated_at"].includes(name))
      .sort(),
    [
      "checkout_intent_id",
      "code",
      "disposition",
      "event_type",
      "processed_at",
      "stripe_created_at",
      "stripe_event_id",
    ],
  );
  assert.equal(
    snapshot.tables["public.orders"].columns.checkout_intent_id.notNull,
    true,
  );
  assert.ok(snapshot.tables["public.order_uploads"].columns.order_id);
});
