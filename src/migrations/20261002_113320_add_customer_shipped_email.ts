import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_email_outbox_kind" ADD VALUE 'customer_shipped';`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "email_outbox" ALTER COLUMN "kind" SET DATA TYPE text;
  DROP TYPE "public"."enum_email_outbox_kind";
  CREATE TYPE "public"."enum_email_outbox_kind" AS ENUM('customer_order_confirmation', 'artist_new_order');
  ALTER TABLE "email_outbox" ALTER COLUMN "kind" SET DATA TYPE "public"."enum_email_outbox_kind" USING "kind"::"public"."enum_email_outbox_kind";`)
}
