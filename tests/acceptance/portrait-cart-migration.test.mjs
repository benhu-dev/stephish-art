import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = new URL(
  "../../src/migrations/20261007_101730_add_multi_portrait_cart_domain.ts",
  import.meta.url,
);
const migration = readFileSync(migrationPath, "utf8");
const snapshot = JSON.parse(
  readFileSync(
    new URL(
      "../../src/migrations/20261007_101730_add_multi_portrait_cart_domain.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

test("portrait cart migration creates the required normalized domain tables", () => {
  for (const table of [
    "order_portraits_subjects",
    "order_portraits",
    "checkout_portraits_subjects",
    "checkout_portraits",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE "${table}"`));
    assert.match(
      migration,
      new RegExp(
        `ALTER TABLE "public"\\."${table}" ENABLE ROW LEVEL SECURITY`,
      ),
    );
  }
  assert.match(
    migration,
    /ALTER TABLE "order_uploads" ADD COLUMN "checkout_portrait_id" integer/,
  );
  assert.match(
    migration,
    /ALTER TABLE "order_uploads" ADD COLUMN "subject_ids" jsonb/,
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "intent_position_idx" ON "checkout_portraits"/,
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "order_position_idx" ON "order_portraits"/,
  );
});

test("draft portraits are lifecycle-owned by checkout intents", () => {
  assert.match(
    migration,
    /checkout_portraits_intent_id_checkout_intents_id_fk[\s\S]*ON DELETE cascade/,
  );
  assert.doesNotMatch(migration, /DROP INDEX "checkoutIntent_position_idx"/);
  assert.doesNotMatch(migration, /CREATE UNIQUE INDEX "checkoutIntent_position_1_idx"/);
});

test("portrait cart migration creates no public RLS policy or destructive data rewrite", () => {
  assert.doesNotMatch(migration, /CREATE POLICY/i);
  assert.doesNotMatch(migration, /TO\s+(anon|authenticated)/i);
  assert.doesNotMatch(migration, /DELETE FROM|TRUNCATE|UPDATE\s+"/i);
});

test("portrait cart migration snapshot has private tables and bounded relationships", () => {
  for (const tableName of [
    "public.order_portraits_subjects",
    "public.order_portraits",
    "public.checkout_portraits_subjects",
    "public.checkout_portraits",
  ]) {
    assert.ok(snapshot.tables[tableName]);
    assert.deepEqual(snapshot.tables[tableName].policies, {});
  }
  assert.equal(
    snapshot.tables["public.checkout_portraits"].columns.intent_id.notNull,
    true,
  );
  assert.equal(
    snapshot.tables["public.order_portraits"].columns.order_id.notNull,
    true,
  );
  assert.equal(
    snapshot.tables["public.order_uploads"].columns.checkout_portrait_id.notNull,
    false,
  );
  assert.equal(
    snapshot.tables["public.order_uploads"].columns.subject_ids.type,
    "jsonb",
  );
});

test("portrait cart migration is registered after the template catalog", () => {
  const index = readFileSync(
    new URL("../../src/migrations/index.ts", import.meta.url),
    "utf8",
  );
  assert.match(index, /20261007_101730_add_multi_portrait_cart_domain/);
  assert.ok(
    index.indexOf("20261007_101730_add_multi_portrait_cart_domain") >
      index.indexOf("20261006_105253_add_postcard_template_catalog"),
  );
});

test("down migration removes existing-table constraints before new tables", () => {
  const down = migration.slice(migration.indexOf("export async function down"));
  assert.ok(
    down.indexOf(
      'ALTER TABLE "order_uploads" DROP CONSTRAINT "order_uploads_checkout_portrait_id_checkout_portraits_id_fk"',
    ) < down.indexOf('DROP TABLE "checkout_portraits" CASCADE'),
  );
  assert.ok(
    down.indexOf(
      'ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_order_portraits_fk"',
    ) < down.indexOf('DROP TABLE "order_portraits" CASCADE'),
  );
});
