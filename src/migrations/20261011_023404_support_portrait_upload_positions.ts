import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "checkoutIntent_position_idx";
  CREATE UNIQUE INDEX "checkoutPortrait_position_idx" ON "order_uploads" USING btree ("checkout_portrait_id","position");
  CREATE UNIQUE INDEX "order_uploads_legacy_intent_position_idx" ON "order_uploads" USING btree ("checkout_intent_id","position") WHERE "checkout_portrait_id" IS NULL;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "order_uploads_legacy_intent_position_idx";
   DROP INDEX "checkoutPortrait_position_idx";
  CREATE UNIQUE INDEX "checkoutIntent_position_idx" ON "order_uploads" USING btree ("checkout_intent_id","position");`)
}
