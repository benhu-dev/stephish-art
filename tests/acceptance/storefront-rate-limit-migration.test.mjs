import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

test("one forward migration creates an internal RLS-only rate-limit table", async () => {
  const directory = new URL("../../src/migrations/", import.meta.url);
  const files = (await readdir(directory)).filter((name) =>
    name.endsWith("_add_storefront_rate_limits.ts"),
  );
  assert.equal(files.length, 1);
  const migration = await readFile(new URL(files[0], directory), "utf8");
  assert.match(migration, /CREATE TABLE "public"\."storefront_rate_limits"/);
  assert.match(migration, /PRIMARY KEY \("action","subject_hash","window_started_at"\)/);
  assert.match(migration, /request_count[\s\S]+CHECK[\s\S]+2147483647/i);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.equal(/CREATE POLICY/i.test(migration), false);

  const config = await readFile(new URL("../../src/payload.config.ts", import.meta.url), "utf8");
  assert.equal(/storefront-rate-limit|storefront_rate_limit/i.test(config), false);
});
