import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../../src/migrations/20261006_105253_add_postcard_template_catalog.ts",
  import.meta.url,
);
const snapshotPath = new URL(
  "../../src/migrations/20261006_105253_add_postcard_template_catalog.json",
  import.meta.url,
);

test("template catalog migration creates only the catalog tables with RLS", async () => {
  const source = await readFile(migrationPath, "utf8");
  const [up] = source.split("export async function down");

  assert.equal((up.match(/CREATE TABLE/g) ?? []).length, 2);
  assert.match(up, /CREATE TABLE "template_media"/);
  assert.match(up, /CREATE TABLE "postcard_templates"/);
  assert.match(
    up,
    /ALTER TABLE "public"\."template_media" ENABLE ROW LEVEL SECURITY/,
  );
  assert.match(
    up,
    /ALTER TABLE "public"\."postcard_templates" ENABLE ROW LEVEL SECURITY/,
  );
  assert.doesNotMatch(up, /FORCE ROW LEVEL SECURITY/);
  assert.doesNotMatch(up, /DISABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(up, /CREATE POLICY|ALTER POLICY|DROP POLICY/);
  assert.doesNotMatch(up, /storage\./);

  for (const protectedName of [
    "customers",
    "orders",
    "checkout_intents",
    "order_uploads",
    "checkout_settings",
    "users",
  ]) {
    assert.doesNotMatch(
      up,
      new RegExp(`(?:CREATE|DROP|UPDATE|DELETE).*${protectedName}`),
    );
  }
});

test("template catalog migration snapshot has the expected private schema", async () => {
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  const media = snapshot.tables["public.template_media"];
  const templates = snapshot.tables["public.postcard_templates"];

  assert.ok(media);
  assert.ok(templates);
  assert.deepEqual(media.policies, {});
  assert.deepEqual(templates.policies, {});
  assert.equal(media.columns.prefix.default, "'template-media'");
  assert.equal(media.columns.alt.notNull, true);
  assert.equal(templates.columns.name.notNull, true);
  assert.equal(templates.columns.preview_media_id.notNull, true);
  assert.equal(templates.columns.sort_order.default, 100);
  assert.equal(templates.columns.available.default, true);
});

test("template catalog migration is registered after the existing history", async () => {
  const index = await readFile(
    new URL("../../src/migrations/index.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    index,
    /20261006_105253_add_postcard_template_catalog/,
  );
  assert.ok(
    index.indexOf("20261006_105253_add_postcard_template_catalog") >
      index.indexOf("20261002_113320_add_customer_shipped_email"),
  );
});
