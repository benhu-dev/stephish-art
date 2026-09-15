import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../../src/migrations/20260915_102514_add_checkout_intents.ts",
  import.meta.url,
);
const snapshotPath = new URL(
  "../../src/migrations/20260915_102514_add_checkout_intents.json",
  import.meta.url,
);

test("Checkout Intent migration is additive and narrowly scoped", async () => {
  const source = await readFile(migrationPath, "utf8");
  const [up] = source.split("export async function down");

  assert.equal((up.match(/CREATE TABLE/g) ?? []).length, 1);
  assert.match(up, /CREATE TABLE "checkout_intents"/);
  assert.match(up, /ALTER TABLE "order_uploads" ADD COLUMN "checkout_intent_id" integer NOT NULL/);
  assert.match(up, /ALTER TABLE "order_uploads" ADD COLUMN "position" numeric NOT NULL/);
  assert.match(up, /ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "checkout_intents_id"/);
  assert.doesNotMatch(up, /DROP TABLE|DROP COLUMN|DISABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(up, /(?:^|\n)\s*(?:UPDATE|DELETE FROM|TRUNCATE)\b/m);
  assert.doesNotMatch(up, /storage\./);
  assert.doesNotMatch(up, /customers|orders|checkout_settings|users/);
});

test("Checkout Intent migration enforces RLS and data invariants", async () => {
  const source = await readFile(migrationPath, "utf8");
  const [up] = source.split("export async function down");

  assert.match(
    up,
    /ALTER TABLE "public"\."checkout_intents" ENABLE ROW LEVEL SECURITY/,
  );
  assert.doesNotMatch(up, /FORCE ROW LEVEL SECURITY/);
  assert.doesNotMatch(up, /CREATE POLICY|ALTER POLICY|DROP POLICY/);
  assert.match(up, /checkout_intents_amount_cents_check/);
  assert.match(up, /checkout_intents_access_token_hash_check/);
  assert.match(up, /checkout_intents_deadlines_check/);
  assert.match(up, /order_uploads_position_check/);
  assert.match(up, /CHECK \("amount_cents" >= 1 AND "amount_cents" = trunc\("amount_cents"\)\)/);
  assert.match(up, /CHECK \("access_token_hash" ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  assert.match(up, /CHECK \("delete_after" > "expires_at"\)/);
  assert.match(up, /CHECK \("position" >= 1 AND "position" <= 3 AND "position" = trunc\("position"\)\)/);
});

test("Checkout Intent ownership is indexed without cascading deletion", async () => {
  const source = await readFile(migrationPath, "utf8");
  const [up] = source.split("export async function down");

  assert.match(
    up,
    /CREATE UNIQUE INDEX "checkoutIntent_position_idx" ON "order_uploads" USING btree \("checkout_intent_id","position"\)/,
  );
  assert.match(up, /CREATE INDEX "order_uploads_checkout_intent_idx"/);
  assert.match(
    up,
    /FOREIGN KEY \("checkout_intent_id"\) REFERENCES "public"\."checkout_intents"\("id"\) ON DELETE set null/,
  );
  assert.doesNotMatch(up, /order_uploads[^;]*ON DELETE cascade/i);
});

test("Checkout Intent migration snapshot contains only approved business columns", async () => {
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  const intents = snapshot.tables["public.checkout_intents"];
  const uploads = snapshot.tables["public.order_uploads"];

  assert.ok(intents);
  assert.deepEqual(Object.keys(intents.columns).sort(), [
    "access_token_hash",
    "amount_cents",
    "created_at",
    "delete_after",
    "expires_at",
    "id",
    "status",
    "updated_at",
  ]);
  assert.deepEqual(intents.policies, {});
  assert.equal(intents.indexes.checkout_intents_access_token_hash_idx.isUnique, true);
  assert.equal(intents.indexes.checkout_intents_expires_at_idx.isUnique, false);
  assert.equal(intents.indexes.checkout_intents_delete_after_idx.isUnique, false);
  assert.equal(uploads.columns.checkout_intent_id.notNull, true);
  assert.equal(uploads.columns.position.notNull, true);
  assert.equal(uploads.indexes.checkoutIntent_position_idx.isUnique, true);
});
