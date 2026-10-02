import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  CREATE TYPE "public"."enum_orders_tracking_carrier" AS ENUM('usps', 'ups', 'fedex', 'other');
  ALTER TABLE "orders" RENAME COLUMN "completed_at" TO "delivered_at";
  ALTER TABLE "orders" ALTER COLUMN "order_status" SET DATA TYPE text;
  UPDATE "orders"
    SET "order_status" = CASE
      WHEN "order_status" = 'new' THEN 'unfulfilled'
      WHEN "order_status" = 'completed' THEN 'delivered'
      ELSE "order_status"
    END;
  ALTER TABLE "orders" ALTER COLUMN "order_status" SET DEFAULT 'unfulfilled'::text;
  DROP TYPE "public"."enum_orders_order_status";
  CREATE TYPE "public"."enum_orders_order_status" AS ENUM('unfulfilled', 'in_progress', 'ready_to_ship', 'shipped', 'delivered');
  ALTER TABLE "orders" ALTER COLUMN "order_status" SET DEFAULT 'unfulfilled'::"public"."enum_orders_order_status";
  ALTER TABLE "orders" ALTER COLUMN "order_status" SET DATA TYPE "public"."enum_orders_order_status" USING "order_status"::"public"."enum_orders_order_status";
  ALTER TABLE "orders" ALTER COLUMN "tracking_carrier" SET DATA TYPE "public"."enum_orders_tracking_carrier" USING "tracking_carrier"::"public"."enum_orders_tracking_carrier";
  ALTER TABLE "orders" DROP COLUMN "tracking_url";
  ALTER TABLE "orders" ADD CONSTRAINT "orders_tracking_pair_check"
    CHECK (("tracking_carrier" IS NULL) = ("tracking_number" IS NULL));
  ALTER TABLE "orders" ADD CONSTRAINT "orders_tracking_number_check"
    CHECK (
      "tracking_number" IS NULL
      OR "tracking_number" ~ '^[A-Z0-9]{6,64}$'
    );
  ALTER TABLE "orders" ADD CONSTRAINT "orders_fulfillment_timestamps_check"
    CHECK (
      (
        "order_status" IN ('unfulfilled', 'in_progress', 'ready_to_ship')
        AND "shipped_at" IS NULL
        AND "delivered_at" IS NULL
      )
      OR (
        "order_status" = 'shipped'
        AND "shipped_at" IS NOT NULL
        AND "delivered_at" IS NULL
      )
      OR (
        "order_status" = 'delivered'
        AND "shipped_at" IS NOT NULL
        AND "delivered_at" IS NOT NULL
      )
    );`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "orders" DROP CONSTRAINT "orders_fulfillment_timestamps_check";
  ALTER TABLE "orders" DROP CONSTRAINT "orders_tracking_number_check";
  ALTER TABLE "orders" DROP CONSTRAINT "orders_tracking_pair_check";
   ALTER TABLE "orders" RENAME COLUMN "delivered_at" TO "completed_at";
  ALTER TABLE "orders" ALTER COLUMN "order_status" SET DATA TYPE text;
  UPDATE "orders"
    SET "order_status" = CASE
      WHEN "order_status" = 'unfulfilled' THEN 'new'
      WHEN "order_status" = 'delivered' THEN 'completed'
      ELSE "order_status"
    END;
  ALTER TABLE "orders" ALTER COLUMN "order_status" SET DEFAULT 'new'::text;
  DROP TYPE "public"."enum_orders_order_status";
  CREATE TYPE "public"."enum_orders_order_status" AS ENUM('new', 'in_progress', 'ready_to_ship', 'shipped', 'completed', 'cancelled');
  ALTER TABLE "orders" ALTER COLUMN "order_status" SET DEFAULT 'new'::"public"."enum_orders_order_status";
  ALTER TABLE "orders" ALTER COLUMN "order_status" SET DATA TYPE "public"."enum_orders_order_status" USING "order_status"::"public"."enum_orders_order_status";
  ALTER TABLE "orders" ALTER COLUMN "tracking_carrier" SET DATA TYPE varchar;
  ALTER TABLE "orders" ADD COLUMN "tracking_url" varchar;
  DROP TYPE "public"."enum_orders_tracking_carrier";`)
}
