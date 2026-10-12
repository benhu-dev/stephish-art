import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { up } from "../../src/migrations/20261012_103336_add_portrait_payment_snapshots.ts";
import { sqlText } from "./portrait-payment-fixture.mjs";
import { CheckoutIntents } from "../../src/collections/CheckoutIntents.ts";
import { CheckoutPortraits } from "../../src/collections/CheckoutPortraits.ts";
import { OrderUploads } from "../../src/collections/OrderUploads.ts";
import { Orders } from "../../src/collections/Orders.ts";

test("forward payment migration is additive and preserves existing RLS/policies", async () => {
  const statements = [];
  await up({ db: { execute: async (query) => { statements.push(sqlText(query)); } } });
  const sql = statements.join("\n");
  for (const column of ["portrait_payment_facts", "portrait_payment_snapshot", "reserved_preview_media_id", "order_portrait_id"])
    assert.ok(sql.includes(`ADD COLUMN "${column}"`));
  assert.ok(sql.includes('REFERENCES "public"."template_media"'));
  assert.ok(sql.includes('REFERENCES "public"."order_portraits"'));
  assert.equal(/\bDROP\b|\bDELETE\s+FROM\b|\bTRUNCATE\b|DISABLE ROW LEVEL SECURITY|CREATE POLICY|CREATE TABLE|NOT NULL/i.test(sql), false);
  const index = await readFile(new URL("../../src/migrations/index.ts", import.meta.url), "utf8");
  assert.ok(index.includes("20261012_103336_add_portrait_payment_snapshots"));
});

test("payment snapshots and associations are server-owned, not public CRUD authority", async () => {
  const field = (c, n) => c.fields.find(f => f.name === n);
  const snapshot = field(CheckoutIntents, "portraitPaymentSnapshot");
  assert.equal(snapshot.admin.hidden, true);
  assert.equal(await snapshot.access.read({}), false);
  assert.equal(await snapshot.access.update({}), false);
  const reserved = field(CheckoutPortraits, "reservedPreviewMedia");
  assert.equal(reserved.relationTo, "template-media");
  assert.equal(await reserved.access.read({}), false);
  assert.equal(await reserved.access.update({}), false);
  assert.equal(await field(Orders, "portraitPaymentFacts").access.update({}), false);
  assert.equal(await field(OrderUploads, "orderPortrait").access.update({}), false);
  assert.equal(field(OrderUploads, "orderPortrait").relationTo, "order-portraits");
});
