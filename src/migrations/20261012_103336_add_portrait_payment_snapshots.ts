import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "orders" ADD COLUMN "portrait_payment_facts" jsonb;
  ALTER TABLE "checkout_intents" ADD COLUMN "portrait_payment_snapshot" jsonb;
  ALTER TABLE "checkout_portraits" ADD COLUMN "reserved_preview_media_id" integer;
  ALTER TABLE "order_uploads" ADD COLUMN "order_portrait_id" integer;
  ALTER TABLE "checkout_portraits" ADD CONSTRAINT "checkout_portraits_reserved_preview_media_id_template_media_id_fk" FOREIGN KEY ("reserved_preview_media_id") REFERENCES "public"."template_media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "order_uploads" ADD CONSTRAINT "order_uploads_order_portrait_id_order_portraits_id_fk" FOREIGN KEY ("order_portrait_id") REFERENCES "public"."order_portraits"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "checkout_portraits_reserved_preview_media_idx" ON "checkout_portraits" USING btree ("reserved_preview_media_id");
  CREATE INDEX "order_uploads_order_portrait_idx" ON "order_uploads" USING btree ("order_portrait_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "checkout_portraits" DROP CONSTRAINT "checkout_portraits_reserved_preview_media_id_template_media_id_fk";
  
  ALTER TABLE "order_uploads" DROP CONSTRAINT "order_uploads_order_portrait_id_order_portraits_id_fk";
  
  DROP INDEX "checkout_portraits_reserved_preview_media_idx";
  DROP INDEX "order_uploads_order_portrait_idx";
  ALTER TABLE "orders" DROP COLUMN "portrait_payment_facts";
  ALTER TABLE "checkout_intents" DROP COLUMN "portrait_payment_snapshot";
  ALTER TABLE "checkout_portraits" DROP COLUMN "reserved_preview_media_id";
  ALTER TABLE "order_uploads" DROP COLUMN "order_portrait_id";`)
}
