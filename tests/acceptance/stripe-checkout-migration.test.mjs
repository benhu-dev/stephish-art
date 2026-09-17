import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationURL = new URL(
  "../../src/migrations/20260917_080014_add_stripe_checkout_sessions.ts",
  import.meta.url,
);
const snapshotURL = new URL(
  "../../src/migrations/20260917_080014_add_stripe_checkout_sessions.json",
  import.meta.url,
);

test("Stripe Checkout migration is one additive schema change", async () => {
  const source = await readFile(migrationURL, "utf8");
  assert.match(
    source,
    /CREATE TYPE "public"\."enum_checkout_intents_status" AS ENUM\('draft', 'checkout_pending', 'checkout_created', 'completed', 'expired'\)/,
  );
  for (const column of [
    "checkout_attempt_id",
    "checkout_started_at",
    "shipping_amount_cents",
    "total_amount_cents",
    "stripe_checkout_session_id",
    "stripe_checkout_session_expires_at",
    "shipping_fee_cents",
  ]) {
    assert.match(source, new RegExp(`ADD COLUMN "${column}"`));
  }
  assert.match(source, /checkout_intents_checkout_attempt_id_idx/);
  assert.match(source, /checkout_intents_stripe_checkout_session_id_idx/);
  assert.doesNotMatch(source, /CREATE TABLE/);
  assert.doesNotMatch(source, /customers.*ADD COLUMN/is);
  assert.doesNotMatch(source, /orders.*ADD COLUMN/is);
});

test("Stripe Checkout migration enforces integer money and reservation consistency", async () => {
  const source = await readFile(migrationURL, "utf8");
  assert.match(source, /checkout_settings_shipping_fee_cents_check/);
  assert.match(source, /checkout_intents_shipping_amount_cents_check/);
  assert.match(source, /checkout_intents_total_amount_cents_check/);
  assert.match(source, /checkout_intents_checkout_attempt_id_check/);
  assert.match(source, /checkout_intents_checkout_snapshots_check/);
  assert.match(source, /checkout_intents_session_pair_check/);
  assert.match(source, /checkout_intents_checkout_state_check/);
});

test("migration snapshot contains only the approved Checkout fields", async () => {
  const snapshot = JSON.parse(await readFile(snapshotURL, "utf8"));
  const intentColumns = Object.keys(
    snapshot.tables["public.checkout_intents"].columns,
  );
  for (const column of [
    "checkout_attempt_id",
    "checkout_started_at",
    "shipping_amount_cents",
    "total_amount_cents",
    "stripe_checkout_session_id",
    "stripe_checkout_session_expires_at",
  ]) {
    assert.equal(intentColumns.includes(column), true);
  }
  assert.equal(
    snapshot.tables["public.checkout_settings"].columns.shipping_fee_cents
      .default,
    100,
  );
  assert.deepEqual(
    snapshot.enums["public.enum_checkout_intents_status"].values,
    ["draft", "checkout_pending", "checkout_created", "completed", "expired"],
  );
  assert.equal(snapshot.tables["public.customers"].columns.payment_status, undefined);
  assert.equal(snapshot.tables["public.orders"].columns.shipping_fee_cents, undefined);
});
