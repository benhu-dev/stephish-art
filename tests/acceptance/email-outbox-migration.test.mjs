import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const migrationsURL = new URL("../../src/migrations/", import.meta.url);

const findOutboxMigration = async () => {
  const names = await readdir(migrationsURL);
  const name = names.find((candidate) => candidate.endsWith("_add_email_outbox.ts"));
  assert.ok(name, "expected one generated add_email_outbox migration");
  return name;
};

test("email outbox migration is additive, constrained, and RLS protected", async () => {
  const name = await findOutboxMigration();
  const source = await readFile(new URL(name, migrationsURL), "utf8");
  const up = source.split("export async function down")[0];

  assert.match(up, /CREATE TABLE "email_outbox"/);
  assert.match(
    up,
    /CREATE UNIQUE INDEX [\s\S]* ON "email_outbox"[\s\S]*\("order_id",\s*"kind"\)/,
  );
  assert.match(up, /FOREIGN KEY \("order_id"\).*"orders"/s);
  assert.match(
    up,
    /ALTER TABLE "public"\."email_outbox" ENABLE ROW LEVEL SECURITY/,
  );
  assert.doesNotMatch(up, /CREATE POLICY|DISABLE ROW LEVEL SECURITY/i);
  assert.doesNotMatch(
    up,
    /(?:^|\n)\s*(?:INSERT INTO|UPDATE\s+|DELETE FROM|TRUNCATE|DROP TABLE|DROP COLUMN)/i,
  );
});

test("migration snapshot contains only the approved outbox job fields", async () => {
  const name = await findOutboxMigration();
  const snapshotName = name.replace(/\.ts$/, ".json");
  const snapshot = JSON.parse(
    await readFile(new URL(snapshotName, migrationsURL), "utf8"),
  );
  const outbox = snapshot.tables["public.email_outbox"];

  assert.ok(outbox);
  assert.deepEqual(
    Object.keys(outbox.columns)
      .filter((column) => !["id", "created_at", "updated_at"].includes(column))
      .sort(),
    [
      "attempts",
      "kind",
      "last_error_code",
      "locked_at",
      "next_attempt_at",
      "order_id",
      "provider_message_id",
      "sent_at",
      "status",
    ],
  );
});
