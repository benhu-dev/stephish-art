import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_email_outbox_kind" AS ENUM('customer_order_confirmation', 'artist_new_order');
  CREATE TYPE "public"."enum_email_outbox_status" AS ENUM('pending', 'processing', 'sent', 'failed');
  CREATE TABLE "email_outbox" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order_id" integer NOT NULL,
  	"kind" "enum_email_outbox_kind" NOT NULL,
  	"status" "enum_email_outbox_status" DEFAULT 'pending' NOT NULL,
  	"attempts" numeric DEFAULT 0 NOT NULL,
  	"next_attempt_at" timestamp(3) with time zone,
  	"locked_at" timestamp(3) with time zone,
  	"sent_at" timestamp(3) with time zone,
  	"provider_message_id" varchar,
  	"last_error_code" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "email_outbox_id" integer;
  ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "email_outbox_order_idx" ON "email_outbox" USING btree ("order_id");
  CREATE INDEX "email_outbox_updated_at_idx" ON "email_outbox" USING btree ("updated_at");
  CREATE INDEX "email_outbox_created_at_idx" ON "email_outbox" USING btree ("created_at");
  CREATE UNIQUE INDEX "order_kind_idx" ON "email_outbox" USING btree ("order_id","kind");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_email_outbox_fk" FOREIGN KEY ("email_outbox_id") REFERENCES "public"."email_outbox"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_email_outbox_id_idx" ON "payload_locked_documents_rels" USING btree ("email_outbox_id");
  ALTER TABLE "public"."email_outbox" ENABLE ROW LEVEL SECURITY;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "email_outbox" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "email_outbox" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_email_outbox_fk";
  
  DROP INDEX "payload_locked_documents_rels_email_outbox_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "email_outbox_id";
  DROP TYPE "public"."enum_email_outbox_kind";
  DROP TYPE "public"."enum_email_outbox_status";`)
}
