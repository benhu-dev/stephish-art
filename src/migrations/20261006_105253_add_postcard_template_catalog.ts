import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "template_media" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"alt" varchar NOT NULL,
  	"prefix" varchar DEFAULT 'template-media',
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"url" varchar,
  	"thumbnail_u_r_l" varchar,
  	"filename" varchar,
  	"mime_type" varchar,
  	"filesize" numeric,
  	"width" numeric,
  	"height" numeric,
  	"focal_x" numeric,
  	"focal_y" numeric
  );
  
  CREATE TABLE "postcard_templates" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"description" varchar,
  	"preview_media_id" integer NOT NULL,
  	"sort_order" numeric DEFAULT 100 NOT NULL,
  	"available" boolean DEFAULT true NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  ALTER TABLE "public"."template_media" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "public"."postcard_templates" ENABLE ROW LEVEL SECURITY;
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "template_media_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "postcard_templates_id" integer;
  ALTER TABLE "postcard_templates" ADD CONSTRAINT "postcard_templates_preview_media_id_template_media_id_fk" FOREIGN KEY ("preview_media_id") REFERENCES "public"."template_media"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "template_media_updated_at_idx" ON "template_media" USING btree ("updated_at");
  CREATE INDEX "template_media_created_at_idx" ON "template_media" USING btree ("created_at");
  CREATE UNIQUE INDEX "template_media_filename_idx" ON "template_media" USING btree ("filename");
  CREATE UNIQUE INDEX "postcard_templates_name_idx" ON "postcard_templates" USING btree ("name");
  CREATE INDEX "postcard_templates_preview_media_idx" ON "postcard_templates" USING btree ("preview_media_id");
  CREATE INDEX "postcard_templates_available_idx" ON "postcard_templates" USING btree ("available");
  CREATE INDEX "postcard_templates_updated_at_idx" ON "postcard_templates" USING btree ("updated_at");
  CREATE INDEX "postcard_templates_created_at_idx" ON "postcard_templates" USING btree ("created_at");
  CREATE INDEX "available_sortOrder_idx" ON "postcard_templates" USING btree ("available","sort_order");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_template_media_fk" FOREIGN KEY ("template_media_id") REFERENCES "public"."template_media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_postcard_templates_fk" FOREIGN KEY ("postcard_templates_id") REFERENCES "public"."postcard_templates"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_template_media_id_idx" ON "payload_locked_documents_rels" USING btree ("template_media_id");
  CREATE INDEX "payload_locked_documents_rels_postcard_templates_id_idx" ON "payload_locked_documents_rels" USING btree ("postcard_templates_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "template_media" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "postcard_templates" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "template_media" CASCADE;
  DROP TABLE "postcard_templates" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_template_media_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_postcard_templates_fk";
  
  DROP INDEX "payload_locked_documents_rels_template_media_id_idx";
  DROP INDEX "payload_locked_documents_rels_postcard_templates_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "template_media_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "postcard_templates_id";`)
}
