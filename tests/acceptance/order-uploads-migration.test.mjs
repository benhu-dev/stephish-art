import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../../src/migrations/20260915_071331_add_order_uploads.ts",
  import.meta.url,
);
const snapshotPath = new URL(
  "../../src/migrations/20260915_071331_add_order_uploads.json",
  import.meta.url,
);

test("Order Uploads migration creates only the upload table and lock metadata", async () => {
  const source = await readFile(migrationPath, "utf8");
  const [up] = source.split("export async function down");

  assert.equal((up.match(/CREATE TABLE/g) ?? []).length, 1);
  assert.match(up, /CREATE TABLE "order_uploads"/);
  assert.match(
    up,
    /ALTER TABLE "public"\."order_uploads" ENABLE ROW LEVEL SECURITY/,
  );
  assert.doesNotMatch(up, /FORCE ROW LEVEL SECURITY/);
  assert.doesNotMatch(up, /DISABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(up, /CREATE POLICY|ALTER POLICY|DROP POLICY/);
  assert.doesNotMatch(up, /storage\./);

  for (const protectedName of [
    "customers",
    "orders",
    "checkout_settings",
    "users",
  ]) {
    assert.doesNotMatch(up, new RegExp(`(?:CREATE|DROP|UPDATE|DELETE).*${protectedName}`));
  }

  assert.match(
    up,
    /ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "order_uploads_id"/,
  );
});

test("Order Uploads migration snapshot has only standard upload metadata", async () => {
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  const table = snapshot.tables["public.order_uploads"];

  assert.ok(table);
  assert.deepEqual(Object.keys(table.columns).sort(), [
    "created_at",
    "filename",
    "filesize",
    "focal_x",
    "focal_y",
    "height",
    "id",
    "mime_type",
    "thumbnail_u_r_l",
    "updated_at",
    "url",
    "width",
  ]);
  assert.deepEqual(table.policies, {});
});
