import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TABLE "public"."storefront_rate_limits" (
      "action" varchar(64) NOT NULL,
      "subject_hash" char(64) NOT NULL,
      "window_started_at" timestamp(3) with time zone NOT NULL,
      "request_count" integer DEFAULT 1 NOT NULL,
      "expires_at" timestamp(3) with time zone NOT NULL,
      CONSTRAINT "storefront_rate_limits_pkey"
        PRIMARY KEY ("action","subject_hash","window_started_at"),
      CONSTRAINT "storefront_rate_limits_action_check"
        CHECK ("action" ~ '^[A-Za-z]+:(network|credential)$'),
      CONSTRAINT "storefront_rate_limits_subject_hash_check"
        CHECK ("subject_hash" ~ '^[0-9a-f]{64}$'),
      CONSTRAINT "storefront_rate_limits_request_count_check"
        CHECK ("request_count" >= 1 AND "request_count" <= 2147483647),
      CONSTRAINT "storefront_rate_limits_expiration_check"
        CHECK ("expires_at" > "window_started_at")
    );
    CREATE INDEX "storefront_rate_limits_expires_at_idx"
      ON "public"."storefront_rate_limits" USING btree ("expires_at");
    ALTER TABLE "public"."storefront_rate_limits" ENABLE ROW LEVEL SECURITY;
  `)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TABLE "public"."storefront_rate_limits";
  `)
}
