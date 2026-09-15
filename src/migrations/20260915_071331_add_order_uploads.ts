import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "order_uploads" (
  	"id" serial PRIMARY KEY NOT NULL,
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
  
  ALTER TABLE "public"."order_uploads" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "order_uploads_id" integer;
  CREATE INDEX "order_uploads_updated_at_idx" ON "order_uploads" USING btree ("updated_at");
  CREATE INDEX "order_uploads_created_at_idx" ON "order_uploads" USING btree ("created_at");
  CREATE UNIQUE INDEX "order_uploads_filename_idx" ON "order_uploads" USING btree ("filename");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_order_uploads_fk" FOREIGN KEY ("order_uploads_id") REFERENCES "public"."order_uploads"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_order_uploads_id_idx" ON "payload_locked_documents_rels" USING btree ("order_uploads_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "order_uploads" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "order_uploads" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_order_uploads_fk";
  
  DROP INDEX "payload_locked_documents_rels_order_uploads_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "order_uploads_id";`)
}
