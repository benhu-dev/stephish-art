import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "public"."users_sessions" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "public"."payload_kv" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "public"."payload_locked_documents" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "public"."payload_locked_documents_rels" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "public"."payload_preferences" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "public"."payload_preferences_rels" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "public"."payload_migrations" ENABLE ROW LEVEL SECURITY;
  `)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "public"."users" DISABLE ROW LEVEL SECURITY;
    ALTER TABLE "public"."users_sessions" DISABLE ROW LEVEL SECURITY;
    ALTER TABLE "public"."payload_kv" DISABLE ROW LEVEL SECURITY;
    ALTER TABLE "public"."payload_locked_documents" DISABLE ROW LEVEL SECURITY;
    ALTER TABLE "public"."payload_locked_documents_rels" DISABLE ROW LEVEL SECURITY;
    ALTER TABLE "public"."payload_preferences" DISABLE ROW LEVEL SECURITY;
    ALTER TABLE "public"."payload_preferences_rels" DISABLE ROW LEVEL SECURITY;
    ALTER TABLE "public"."payload_migrations" DISABLE ROW LEVEL SECURITY;
  `)
}
