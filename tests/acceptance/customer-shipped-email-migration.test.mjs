import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationURL = new URL(
  "../../src/migrations/20261002_113320_add_customer_shipped_email.ts",
  import.meta.url,
);
const snapshotURL = new URL(
  "../../src/migrations/20261002_113320_add_customer_shipped_email.json",
  import.meta.url,
);

test("shipment email migration adds only the new enum value with no backfill", async () => {
  const source = await readFile(migrationURL, "utf8");
  const up = source.split("export async function down")[0];
  assert.match(
    up,
    /ALTER TYPE "public"\."enum_email_outbox_kind" ADD VALUE 'customer_shipped'/,
  );
  assert.doesNotMatch(
    up,
    /INSERT INTO|UPDATE\s+|DELETE FROM|TRUNCATE|DROP\s+|CREATE TABLE/i,
  );
});

test("generated snapshot keeps compound uniqueness and all three kinds", async () => {
  const snapshot = JSON.parse(await readFile(snapshotURL, "utf8"));
  const outbox = snapshot.tables["public.email_outbox"];
  assert.deepEqual(snapshot.enums["public.enum_email_outbox_kind"].values, [
    "customer_order_confirmation",
    "artist_new_order",
    "customer_shipped",
  ]);
  assert.equal(outbox.indexes.order_kind_idx.isUnique, true);
  assert.deepEqual(
    outbox.indexes.order_kind_idx.columns.map(({ expression }) => expression),
    ["order_id", "kind"],
  );
});
