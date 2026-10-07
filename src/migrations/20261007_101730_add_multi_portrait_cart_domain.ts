import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_order_portraits_subjects_kind" AS ENUM('person', 'pet');
  CREATE TYPE "public"."enum_checkout_portraits_subjects_kind" AS ENUM('person', 'pet');
  CREATE TABLE "order_portraits_subjects" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"subject_id" varchar NOT NULL,
  	"name" varchar NOT NULL,
  	"kind" "enum_order_portraits_subjects_kind" NOT NULL,
  	"position" numeric NOT NULL
  );
  
  CREATE TABLE "order_portraits" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order_id" integer NOT NULL,
  	"source_checkout_portrait_id" varchar NOT NULL,
  	"position" numeric NOT NULL,
  	"template_id" numeric NOT NULL,
  	"template_name" varchar NOT NULL,
  	"template_description" varchar,
  	"template_preview_media_id" integer NOT NULL,
  	"template_preview_alt" varchar NOT NULL,
  	"artist_note" varchar,
  	"amount_cents" numeric NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "checkout_portraits_subjects" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"subject_id" varchar NOT NULL,
  	"name" varchar NOT NULL,
  	"kind" "enum_checkout_portraits_subjects_kind" NOT NULL,
  	"position" numeric NOT NULL
  );
  
  CREATE TABLE "checkout_portraits" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"intent_id" integer NOT NULL,
  	"public_id" varchar NOT NULL,
  	"template_id" integer NOT NULL,
  	"position" numeric NOT NULL,
  	"artist_note" varchar,
  	"amount_cents" numeric NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
   	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  ALTER TABLE "public"."order_portraits_subjects" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "public"."order_portraits" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "public"."checkout_portraits_subjects" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "public"."checkout_portraits" ENABLE ROW LEVEL SECURITY;
  
  ALTER TABLE "order_uploads" ADD COLUMN "checkout_portrait_id" integer;
  ALTER TABLE "order_uploads" ADD COLUMN "subject_ids" jsonb;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "order_portraits_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "checkout_portraits_id" integer;
  ALTER TABLE "order_portraits_subjects" ADD CONSTRAINT "order_portraits_subjects_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."order_portraits"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "order_portraits" ADD CONSTRAINT "order_portraits_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "order_portraits" ADD CONSTRAINT "order_portraits_template_preview_media_id_template_media_id_fk" FOREIGN KEY ("template_preview_media_id") REFERENCES "public"."template_media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "checkout_portraits_subjects" ADD CONSTRAINT "checkout_portraits_subjects_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."checkout_portraits"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "checkout_portraits" ADD CONSTRAINT "checkout_portraits_intent_id_checkout_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."checkout_intents"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "checkout_portraits" ADD CONSTRAINT "checkout_portraits_template_id_postcard_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."postcard_templates"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "order_portraits_subjects_order_idx" ON "order_portraits_subjects" USING btree ("_order");
  CREATE INDEX "order_portraits_subjects_parent_id_idx" ON "order_portraits_subjects" USING btree ("_parent_id");
  CREATE INDEX "order_portraits_order_idx" ON "order_portraits" USING btree ("order_id");
  CREATE UNIQUE INDEX "order_portraits_source_checkout_portrait_id_idx" ON "order_portraits" USING btree ("source_checkout_portrait_id");
  CREATE INDEX "order_portraits_template_preview_media_idx" ON "order_portraits" USING btree ("template_preview_media_id");
  CREATE INDEX "order_portraits_updated_at_idx" ON "order_portraits" USING btree ("updated_at");
  CREATE INDEX "order_portraits_created_at_idx" ON "order_portraits" USING btree ("created_at");
  CREATE UNIQUE INDEX "order_position_idx" ON "order_portraits" USING btree ("order_id","position");
  CREATE INDEX "checkout_portraits_subjects_order_idx" ON "checkout_portraits_subjects" USING btree ("_order");
  CREATE INDEX "checkout_portraits_subjects_parent_id_idx" ON "checkout_portraits_subjects" USING btree ("_parent_id");
  CREATE INDEX "checkout_portraits_intent_idx" ON "checkout_portraits" USING btree ("intent_id");
  CREATE UNIQUE INDEX "checkout_portraits_public_id_idx" ON "checkout_portraits" USING btree ("public_id");
  CREATE INDEX "checkout_portraits_template_idx" ON "checkout_portraits" USING btree ("template_id");
  CREATE INDEX "checkout_portraits_updated_at_idx" ON "checkout_portraits" USING btree ("updated_at");
  CREATE INDEX "checkout_portraits_created_at_idx" ON "checkout_portraits" USING btree ("created_at");
  CREATE UNIQUE INDEX "intent_position_idx" ON "checkout_portraits" USING btree ("intent_id","position");
  ALTER TABLE "order_uploads" ADD CONSTRAINT "order_uploads_checkout_portrait_id_checkout_portraits_id_fk" FOREIGN KEY ("checkout_portrait_id") REFERENCES "public"."checkout_portraits"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_order_portraits_fk" FOREIGN KEY ("order_portraits_id") REFERENCES "public"."order_portraits"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_checkout_portraits_fk" FOREIGN KEY ("checkout_portraits_id") REFERENCES "public"."checkout_portraits"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "order_uploads_checkout_portrait_idx" ON "order_uploads" USING btree ("checkout_portrait_id");
  CREATE INDEX "payload_locked_documents_rels_order_portraits_id_idx" ON "payload_locked_documents_rels" USING btree ("order_portraits_id");
  CREATE INDEX "payload_locked_documents_rels_checkout_portraits_id_idx" ON "payload_locked_documents_rels" USING btree ("checkout_portraits_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "order_portraits_subjects" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "order_portraits" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "checkout_portraits_subjects" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "checkout_portraits" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "order_uploads" DROP CONSTRAINT "order_uploads_checkout_portrait_id_checkout_portraits_id_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_order_portraits_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_checkout_portraits_fk";
  
  DROP INDEX "order_uploads_checkout_portrait_idx";
  DROP INDEX "payload_locked_documents_rels_order_portraits_id_idx";
  DROP INDEX "payload_locked_documents_rels_checkout_portraits_id_idx";
  ALTER TABLE "order_uploads" DROP COLUMN "checkout_portrait_id";
  ALTER TABLE "order_uploads" DROP COLUMN "subject_ids";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "order_portraits_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "checkout_portraits_id";
  DROP TABLE "order_portraits_subjects" CASCADE;
  DROP TABLE "order_portraits" CASCADE;
  DROP TABLE "checkout_portraits_subjects" CASCADE;
  DROP TABLE "checkout_portraits" CASCADE;
  DROP TYPE "public"."enum_order_portraits_subjects_kind";
  DROP TYPE "public"."enum_checkout_portraits_subjects_kind";`)
}
