import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationURL = new URL(
  "../../src/migrations/20261001_084550_add_stripe_refund_dispute_reconciliation.ts",
  import.meta.url,
);
const snapshotURL = new URL(
  "../../src/migrations/20261001_084550_add_stripe_refund_dispute_reconciliation.json",
  import.meta.url,
);
const payloadTypesURL = new URL("../../src/payload-types.ts", import.meta.url);

test("reconciliation migration is additive and constrains refund state", async () => {
  const source = await readFile(migrationURL, "utf8");
  const up = source.split("export async function down")[0];

  assert.match(up, /ADD COLUMN "refunded_amount_cents" numeric DEFAULT 0 NOT NULL/);
  assert.match(up, /ADD COLUMN "refund_state"/);
  assert.match(up, /ADD COLUMN "stripe_dispute_id"/);
  assert.match(up, /ADD COLUMN "stripe_dispute_status"/);
  assert.match(up, /orders_refunded_amount_cents_check/);
  assert.match(up, /"refunded_amount_cents" <= "amount_cents"/);
  for (const eventType of [
    "refund.created",
    "refund.updated",
    "refund.failed",
    "charge.refunded",
    "charge.dispute.created",
    "charge.dispute.updated",
    "charge.dispute.closed",
  ]) {
    assert.match(up, new RegExp(`ADD VALUE '${eventType.replaceAll(".", "\\.")}'`));
  }
  assert.doesNotMatch(up, /CREATE POLICY|DISABLE ROW LEVEL SECURITY/i);
  assert.doesNotMatch(up, /DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/i);
});

test("migration snapshot and generated Payload types contain reconciliation fields", async () => {
  const snapshot = JSON.parse(await readFile(snapshotURL, "utf8"));
  const orders = snapshot.tables["public.orders"].columns;
  for (const field of [
    "refunded_amount_cents",
    "refund_state",
    "stripe_dispute_id",
    "stripe_dispute_status",
  ]) {
    assert.ok(orders[field]);
  }
  assert.equal(orders.refunded_amount_cents.notNull, true);
  assert.equal(orders.refunded_amount_cents.default, 0);
  assert.equal(orders.refund_state.notNull, true);

  const payloadTypes = await readFile(payloadTypesURL, "utf8");
  assert.match(payloadTypes, /refundedAmountCents: number;/);
  assert.match(payloadTypes, /refundState: 'none' \| 'partial' \| 'full';/);
  assert.match(payloadTypes, /stripeDisputeId\?: string \| null;/);
  assert.match(payloadTypes, /stripeDisputeStatus\?:/);
});
