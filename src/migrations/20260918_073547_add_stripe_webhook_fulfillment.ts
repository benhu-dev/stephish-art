import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_stripe_events_event_type" AS ENUM('checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired');
  CREATE TYPE "public"."enum_stripe_events_disposition" AS ENUM('processed', 'ignored', 'rejected');
  CREATE TYPE "public"."enum_stripe_events_code" AS ENUM('already_expired', 'already_fulfilled', 'amount_mismatch', 'async_payment_failed', 'currency_mismatch', 'identity_conflict', 'intent_not_found', 'intent_state_conflict', 'invalid_customer', 'invalid_metadata', 'invalid_shipping', 'invalid_uploads', 'payment_mismatch', 'reconciliation_mismatch', 'session_expired', 'session_mismatch', 'session_unpaid');
  CREATE TABLE "stripe_events" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"stripe_event_id" varchar NOT NULL,
  	"event_type" "enum_stripe_events_event_type" NOT NULL,
  	"disposition" "enum_stripe_events_disposition" NOT NULL,
  	"checkout_intent_id" integer,
  	"stripe_created_at" timestamp(3) with time zone NOT NULL,
  	"processed_at" timestamp(3) with time zone NOT NULL,
  	"code" "enum_stripe_events_code",
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "orders" ADD COLUMN "checkout_intent_id" integer NOT NULL;
  ALTER TABLE "order_uploads" ADD COLUMN "order_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "stripe_events_id" integer;
  ALTER TABLE "stripe_events" ADD CONSTRAINT "stripe_events_checkout_intent_id_checkout_intents_id_fk" FOREIGN KEY ("checkout_intent_id") REFERENCES "public"."checkout_intents"("id") ON DELETE set null ON UPDATE no action;
  CREATE UNIQUE INDEX "stripe_events_stripe_event_id_idx" ON "stripe_events" USING btree ("stripe_event_id");
  CREATE INDEX "stripe_events_checkout_intent_idx" ON "stripe_events" USING btree ("checkout_intent_id");
  CREATE INDEX "stripe_events_updated_at_idx" ON "stripe_events" USING btree ("updated_at");
  CREATE INDEX "stripe_events_created_at_idx" ON "stripe_events" USING btree ("created_at");
  ALTER TABLE "orders" ADD CONSTRAINT "orders_checkout_intent_id_checkout_intents_id_fk" FOREIGN KEY ("checkout_intent_id") REFERENCES "public"."checkout_intents"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "order_uploads" ADD CONSTRAINT "order_uploads_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_stripe_events_fk" FOREIGN KEY ("stripe_events_id") REFERENCES "public"."stripe_events"("id") ON DELETE cascade ON UPDATE no action;
  CREATE UNIQUE INDEX "orders_checkout_intent_idx" ON "orders" USING btree ("checkout_intent_id");
  CREATE INDEX "order_uploads_order_idx" ON "order_uploads" USING btree ("order_id");
  CREATE INDEX "payload_locked_documents_rels_stripe_events_id_idx" ON "payload_locked_documents_rels" USING btree ("stripe_events_id");
  ALTER TABLE "public"."stripe_events" ENABLE ROW LEVEL SECURITY;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "stripe_events" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "stripe_events" CASCADE;
  ALTER TABLE "orders" DROP CONSTRAINT "orders_checkout_intent_id_checkout_intents_id_fk";
  
  ALTER TABLE "order_uploads" DROP CONSTRAINT "order_uploads_order_id_orders_id_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_stripe_events_fk";
  
  DROP INDEX "orders_checkout_intent_idx";
  DROP INDEX "order_uploads_order_idx";
  DROP INDEX "payload_locked_documents_rels_stripe_events_id_idx";
  ALTER TABLE "orders" DROP COLUMN "checkout_intent_id";
  ALTER TABLE "order_uploads" DROP COLUMN "order_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "stripe_events_id";
  DROP TYPE "public"."enum_stripe_events_event_type";
  DROP TYPE "public"."enum_stripe_events_disposition";
  DROP TYPE "public"."enum_stripe_events_code";`)
}
