import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_checkout_intents_status" AS ENUM('draft', 'checkout_created', 'completed', 'expired');
  CREATE TABLE "checkout_intents" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"status" "enum_checkout_intents_status" DEFAULT 'draft' NOT NULL,
  	"amount_cents" numeric NOT NULL,
  	"access_token_hash" varchar NOT NULL,
  	"expires_at" timestamp(3) with time zone NOT NULL,
  	"delete_after" timestamp(3) with time zone NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "public"."checkout_intents" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "public"."checkout_intents" ADD CONSTRAINT "checkout_intents_amount_cents_check" CHECK ("amount_cents" >= 1 AND "amount_cents" = trunc("amount_cents"));
  ALTER TABLE "public"."checkout_intents" ADD CONSTRAINT "checkout_intents_access_token_hash_check" CHECK ("access_token_hash" ~ '^[0-9a-f]{64}$');
  ALTER TABLE "public"."checkout_intents" ADD CONSTRAINT "checkout_intents_deadlines_check" CHECK ("delete_after" > "expires_at");
  ALTER TABLE "order_uploads" ADD COLUMN "checkout_intent_id" integer NOT NULL;
  ALTER TABLE "order_uploads" ADD COLUMN "position" numeric NOT NULL;
  ALTER TABLE "public"."order_uploads" ADD CONSTRAINT "order_uploads_position_check" CHECK ("position" >= 1 AND "position" <= 3 AND "position" = trunc("position"));
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "checkout_intents_id" integer;
  CREATE UNIQUE INDEX "checkout_intents_access_token_hash_idx" ON "checkout_intents" USING btree ("access_token_hash");
  CREATE INDEX "checkout_intents_expires_at_idx" ON "checkout_intents" USING btree ("expires_at");
  CREATE INDEX "checkout_intents_delete_after_idx" ON "checkout_intents" USING btree ("delete_after");
  CREATE INDEX "checkout_intents_updated_at_idx" ON "checkout_intents" USING btree ("updated_at");
  CREATE INDEX "checkout_intents_created_at_idx" ON "checkout_intents" USING btree ("created_at");
  ALTER TABLE "order_uploads" ADD CONSTRAINT "order_uploads_checkout_intent_id_checkout_intents_id_fk" FOREIGN KEY ("checkout_intent_id") REFERENCES "public"."checkout_intents"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_checkout_intents_fk" FOREIGN KEY ("checkout_intents_id") REFERENCES "public"."checkout_intents"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "order_uploads_checkout_intent_idx" ON "order_uploads" USING btree ("checkout_intent_id");
  CREATE UNIQUE INDEX "checkoutIntent_position_idx" ON "order_uploads" USING btree ("checkout_intent_id","position");
  CREATE INDEX "payload_locked_documents_rels_checkout_intents_id_idx" ON "payload_locked_documents_rels" USING btree ("checkout_intents_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "checkout_intents" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "checkout_intents" CASCADE;
  ALTER TABLE "order_uploads" DROP CONSTRAINT "order_uploads_checkout_intent_id_checkout_intents_id_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_checkout_intents_fk";
  
  DROP INDEX "order_uploads_checkout_intent_idx";
  DROP INDEX "checkoutIntent_position_idx";
  DROP INDEX "payload_locked_documents_rels_checkout_intents_id_idx";
  ALTER TABLE "order_uploads" DROP COLUMN "checkout_intent_id";
  ALTER TABLE "order_uploads" DROP COLUMN "position";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "checkout_intents_id";
  DROP TYPE "public"."enum_checkout_intents_status";`)
}
