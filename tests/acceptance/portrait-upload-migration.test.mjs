import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.join(
  directory,
  "..",
  "..",
  "src",
  "migrations",
  "20261011_023404_support_portrait_upload_positions.ts",
);
const source = fs.readFileSync(migrationPath, "utf8");
const [up, down] = source.split("export async function down");

test("portrait upload migration changes only upload position indexes", () => {
  assert.match(up, /DROP INDEX "checkoutIntent_position_idx"/);
  assert.match(up, /CREATE UNIQUE INDEX "checkoutPortrait_position_idx"[\s\S]*"checkout_portrait_id","position"/);
  assert.match(
    up,
    /CREATE UNIQUE INDEX "order_uploads_legacy_intent_position_idx"[\s\S]*"checkout_intent_id","position"[\s\S]*WHERE "checkout_portrait_id" IS NULL/,
  );
  assert.doesNotMatch(
    up,
    /CREATE TABLE|DROP TABLE|ADD COLUMN|DROP COLUMN|CREATE POLICY|ALTER POLICY|DROP POLICY|DISABLE ROW LEVEL SECURITY/,
  );
  assert.doesNotMatch(up, /(?:^|\n)\s*(?:UPDATE|DELETE FROM|TRUNCATE)\b/m);
  assert.match(down, /DROP INDEX "order_uploads_legacy_intent_position_idx"/);
  assert.match(down, /DROP INDEX "checkoutPortrait_position_idx"/);
  assert.match(down, /CREATE UNIQUE INDEX "checkoutIntent_position_idx"/);
});
