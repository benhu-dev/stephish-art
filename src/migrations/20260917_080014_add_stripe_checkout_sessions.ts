import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "checkout_intents" ALTER COLUMN "status" SET DATA TYPE text;
  ALTER TABLE "checkout_intents" ALTER COLUMN "status" SET DEFAULT 'draft'::text;
  DROP TYPE "public"."enum_checkout_intents_status";
  CREATE TYPE "public"."enum_checkout_intents_status" AS ENUM('draft', 'checkout_pending', 'checkout_created', 'completed', 'expired');
  ALTER TABLE "checkout_intents" ALTER COLUMN "status" SET DEFAULT 'draft'::"public"."enum_checkout_intents_status";
  ALTER TABLE "checkout_intents" ALTER COLUMN "status" SET DATA TYPE "public"."enum_checkout_intents_status" USING "status"::"public"."enum_checkout_intents_status";
  ALTER TABLE "checkout_intents" ADD COLUMN "checkout_attempt_id" varchar;
  ALTER TABLE "checkout_intents" ADD COLUMN "checkout_started_at" timestamp(3) with time zone;
  ALTER TABLE "checkout_intents" ADD COLUMN "shipping_amount_cents" numeric;
  ALTER TABLE "checkout_intents" ADD COLUMN "total_amount_cents" numeric;
  ALTER TABLE "checkout_intents" ADD COLUMN "stripe_checkout_session_id" varchar;
  ALTER TABLE "checkout_intents" ADD COLUMN "stripe_checkout_session_expires_at" timestamp(3) with time zone;
  ALTER TABLE "checkout_settings" ADD COLUMN "shipping_fee_cents" numeric DEFAULT 100 NOT NULL;
  ALTER TABLE "public"."checkout_settings" ADD CONSTRAINT "checkout_settings_shipping_fee_cents_check" CHECK ("shipping_fee_cents" >= 0 AND "shipping_fee_cents" <= 10000 AND "shipping_fee_cents" = trunc("shipping_fee_cents"));
  ALTER TABLE "public"."checkout_intents" ADD CONSTRAINT "checkout_intents_shipping_amount_cents_check" CHECK ("shipping_amount_cents" IS NULL OR ("shipping_amount_cents" >= 0 AND "shipping_amount_cents" <= 10000 AND "shipping_amount_cents" = trunc("shipping_amount_cents")));
  ALTER TABLE "public"."checkout_intents" ADD CONSTRAINT "checkout_intents_total_amount_cents_check" CHECK ("total_amount_cents" IS NULL OR ("total_amount_cents" >= 1 AND "total_amount_cents" = trunc("total_amount_cents")));
  ALTER TABLE "public"."checkout_intents" ADD CONSTRAINT "checkout_intents_checkout_attempt_id_check" CHECK ("checkout_attempt_id" IS NULL OR "checkout_attempt_id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');
  ALTER TABLE "public"."checkout_intents" ADD CONSTRAINT "checkout_intents_checkout_snapshots_check" CHECK (("shipping_amount_cents" IS NULL AND "total_amount_cents" IS NULL) OR ("shipping_amount_cents" IS NOT NULL AND "total_amount_cents" = "amount_cents" + "shipping_amount_cents"));
  ALTER TABLE "public"."checkout_intents" ADD CONSTRAINT "checkout_intents_session_pair_check" CHECK (("stripe_checkout_session_id" IS NULL) = ("stripe_checkout_session_expires_at" IS NULL));
  ALTER TABLE "public"."checkout_intents" ADD CONSTRAINT "checkout_intents_checkout_state_check" CHECK ((("status" NOT IN ('checkout_pending', 'checkout_created', 'completed')) OR ("checkout_attempt_id" IS NOT NULL AND "checkout_started_at" IS NOT NULL AND "shipping_amount_cents" IS NOT NULL AND "total_amount_cents" IS NOT NULL)) AND (("status" NOT IN ('checkout_created', 'completed')) OR ("stripe_checkout_session_id" IS NOT NULL AND "stripe_checkout_session_expires_at" IS NOT NULL)));
  CREATE UNIQUE INDEX "checkout_intents_checkout_attempt_id_idx" ON "checkout_intents" USING btree ("checkout_attempt_id");
  CREATE UNIQUE INDEX "checkout_intents_stripe_checkout_session_id_idx" ON "checkout_intents" USING btree ("stripe_checkout_session_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "checkout_intents" DROP CONSTRAINT "checkout_intents_checkout_state_check";
  ALTER TABLE "checkout_intents" DROP CONSTRAINT "checkout_intents_session_pair_check";
  ALTER TABLE "checkout_intents" DROP CONSTRAINT "checkout_intents_checkout_snapshots_check";
  ALTER TABLE "checkout_intents" DROP CONSTRAINT "checkout_intents_checkout_attempt_id_check";
  ALTER TABLE "checkout_intents" DROP CONSTRAINT "checkout_intents_total_amount_cents_check";
  ALTER TABLE "checkout_intents" DROP CONSTRAINT "checkout_intents_shipping_amount_cents_check";
  ALTER TABLE "checkout_settings" DROP CONSTRAINT "checkout_settings_shipping_fee_cents_check";
  ALTER TABLE "checkout_intents" ALTER COLUMN "status" SET DATA TYPE text;
  ALTER TABLE "checkout_intents" ALTER COLUMN "status" SET DEFAULT 'draft'::text;
  DROP TYPE "public"."enum_checkout_intents_status";
  CREATE TYPE "public"."enum_checkout_intents_status" AS ENUM('draft', 'checkout_created', 'completed', 'expired');
  ALTER TABLE "checkout_intents" ALTER COLUMN "status" SET DEFAULT 'draft'::"public"."enum_checkout_intents_status";
  ALTER TABLE "checkout_intents" ALTER COLUMN "status" SET DATA TYPE "public"."enum_checkout_intents_status" USING "status"::"public"."enum_checkout_intents_status";
  DROP INDEX "checkout_intents_checkout_attempt_id_idx";
  DROP INDEX "checkout_intents_stripe_checkout_session_id_idx";
  ALTER TABLE "checkout_intents" DROP COLUMN "checkout_attempt_id";
  ALTER TABLE "checkout_intents" DROP COLUMN "checkout_started_at";
  ALTER TABLE "checkout_intents" DROP COLUMN "shipping_amount_cents";
  ALTER TABLE "checkout_intents" DROP COLUMN "total_amount_cents";
  ALTER TABLE "checkout_intents" DROP COLUMN "stripe_checkout_session_id";
  ALTER TABLE "checkout_intents" DROP COLUMN "stripe_checkout_session_expires_at";
  ALTER TABLE "checkout_settings" DROP COLUMN "shipping_fee_cents";`)
}
