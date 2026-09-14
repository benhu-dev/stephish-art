import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_orders_currency" AS ENUM('usd');
  CREATE TYPE "public"."enum_orders_order_status" AS ENUM('new', 'in_progress', 'ready_to_ship', 'shipped', 'completed', 'cancelled');
  CREATE TYPE "public"."enum_orders_payment_status" AS ENUM('paid', 'partially_refunded', 'refunded', 'disputed');
  CREATE TABLE "orders" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"customer_id" integer NOT NULL,
  	"contact_email" varchar NOT NULL,
  	"amount_cents" numeric NOT NULL,
  	"currency" "enum_orders_currency" DEFAULT 'usd' NOT NULL,
  	"stripe_checkout_session_id" varchar NOT NULL,
  	"stripe_payment_intent_id" varchar NOT NULL,
  	"paid_at" timestamp(3) with time zone NOT NULL,
  	"order_status" "enum_orders_order_status" DEFAULT 'new' NOT NULL,
  	"payment_status" "enum_orders_payment_status" DEFAULT 'paid' NOT NULL,
  	"shipping_address_recipient_name" varchar NOT NULL,
  	"shipping_address_line1" varchar NOT NULL,
  	"shipping_address_line2" varchar,
  	"shipping_address_city" varchar NOT NULL,
  	"shipping_address_state" varchar,
  	"shipping_address_postal_code" varchar,
  	"shipping_address_country" varchar NOT NULL,
  	"tracking_carrier" varchar,
  	"tracking_number" varchar,
  	"tracking_url" varchar,
  	"shipped_at" timestamp(3) with time zone,
  	"completed_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "orders_id" integer;
  ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("customer_id");
  CREATE UNIQUE INDEX "orders_stripe_checkout_session_id_idx" ON "orders" USING btree ("stripe_checkout_session_id");
  CREATE UNIQUE INDEX "orders_stripe_payment_intent_id_idx" ON "orders" USING btree ("stripe_payment_intent_id");
  CREATE INDEX "orders_updated_at_idx" ON "orders" USING btree ("updated_at");
  CREATE INDEX "orders_created_at_idx" ON "orders" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_orders_fk" FOREIGN KEY ("orders_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_orders_id_idx" ON "payload_locked_documents_rels" USING btree ("orders_id");
  ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_orders_fk";
  
  DROP INDEX "payload_locked_documents_rels_orders_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "orders_id";
  DROP TABLE "orders" CASCADE;
  DROP TYPE "public"."enum_orders_currency";
  DROP TYPE "public"."enum_orders_order_status";
  DROP TYPE "public"."enum_orders_payment_status";`)
}
