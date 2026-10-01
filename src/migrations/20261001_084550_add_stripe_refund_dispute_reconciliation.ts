import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_orders_refund_state" AS ENUM('none', 'partial', 'full');
  CREATE TYPE "public"."enum_orders_stripe_dispute_status" AS ENUM('lost', 'needs_response', 'prevented', 'under_review', 'warning_closed', 'warning_needs_response', 'warning_under_review', 'won');
  ALTER TYPE "public"."enum_stripe_events_event_type" ADD VALUE 'refund.created';
  ALTER TYPE "public"."enum_stripe_events_event_type" ADD VALUE 'refund.updated';
  ALTER TYPE "public"."enum_stripe_events_event_type" ADD VALUE 'refund.failed';
  ALTER TYPE "public"."enum_stripe_events_event_type" ADD VALUE 'charge.refunded';
  ALTER TYPE "public"."enum_stripe_events_event_type" ADD VALUE 'charge.dispute.created';
  ALTER TYPE "public"."enum_stripe_events_event_type" ADD VALUE 'charge.dispute.updated';
  ALTER TYPE "public"."enum_stripe_events_event_type" ADD VALUE 'charge.dispute.closed';
  ALTER TYPE "public"."enum_stripe_events_code" ADD VALUE 'order_not_found' BEFORE 'reconciliation_mismatch';
  ALTER TYPE "public"."enum_stripe_events_code" ADD VALUE 'refund_amount_invalid' BEFORE 'reconciliation_mismatch';
  ALTER TYPE "public"."enum_stripe_events_code" ADD VALUE 'refund_reconciled' BEFORE 'reconciliation_mismatch';
  ALTER TYPE "public"."enum_stripe_events_code" ADD VALUE 'refund_regression' BEFORE 'reconciliation_mismatch';
  ALTER TYPE "public"."enum_stripe_events_code" ADD VALUE 'reconciliation_object_mismatch' BEFORE 'reconciliation_mismatch';
  ALTER TYPE "public"."enum_stripe_events_code" ADD VALUE 'dispute_reconciled' BEFORE 'reconciliation_mismatch';
  ALTER TYPE "public"."enum_stripe_events_code" ADD VALUE 'stale_event' BEFORE 'reconciliation_mismatch';
  ALTER TABLE "orders" ADD COLUMN "refunded_amount_cents" numeric DEFAULT 0 NOT NULL;
  ALTER TABLE "orders" ADD COLUMN "refund_state" "enum_orders_refund_state" DEFAULT 'none' NOT NULL;
  ALTER TABLE "orders" ADD COLUMN "stripe_dispute_id" varchar;
  ALTER TABLE "orders" ADD COLUMN "stripe_dispute_status" "enum_orders_stripe_dispute_status";
  ALTER TABLE "orders" ADD CONSTRAINT "orders_refunded_amount_cents_check"
    CHECK (
      "refunded_amount_cents" >= 0
      AND "refunded_amount_cents" <= "amount_cents"
      AND "refunded_amount_cents" = trunc("refunded_amount_cents")
    );
  ALTER TABLE "orders" ADD CONSTRAINT "orders_stripe_dispute_id_check"
    CHECK (
      "stripe_dispute_id" IS NULL
      OR "stripe_dispute_id" ~ '^dp_[A-Za-z0-9_]{1,252}$'
    );
  CREATE INDEX "orders_stripe_dispute_id_idx" ON "orders" USING btree ("stripe_dispute_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "stripe_events" ALTER COLUMN "event_type" SET DATA TYPE text;
  DROP TYPE "public"."enum_stripe_events_event_type";
  CREATE TYPE "public"."enum_stripe_events_event_type" AS ENUM('checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired');
  ALTER TABLE "stripe_events" ALTER COLUMN "event_type" SET DATA TYPE "public"."enum_stripe_events_event_type" USING "event_type"::"public"."enum_stripe_events_event_type";
  ALTER TABLE "stripe_events" ALTER COLUMN "code" SET DATA TYPE text;
  DROP TYPE "public"."enum_stripe_events_code";
  CREATE TYPE "public"."enum_stripe_events_code" AS ENUM('already_expired', 'already_fulfilled', 'amount_mismatch', 'async_payment_failed', 'currency_mismatch', 'identity_conflict', 'intent_not_found', 'intent_state_conflict', 'invalid_customer', 'invalid_metadata', 'invalid_shipping', 'invalid_uploads', 'payment_mismatch', 'reconciliation_mismatch', 'session_expired', 'session_mismatch', 'session_unpaid');
  ALTER TABLE "stripe_events" ALTER COLUMN "code" SET DATA TYPE "public"."enum_stripe_events_code" USING "code"::"public"."enum_stripe_events_code";
  DROP INDEX "orders_stripe_dispute_id_idx";
  ALTER TABLE "orders" DROP COLUMN "refunded_amount_cents";
  ALTER TABLE "orders" DROP COLUMN "refund_state";
  ALTER TABLE "orders" DROP COLUMN "stripe_dispute_id";
  ALTER TABLE "orders" DROP COLUMN "stripe_dispute_status";
  DROP TYPE "public"."enum_orders_refund_state";
  DROP TYPE "public"."enum_orders_stripe_dispute_status";`)
}
