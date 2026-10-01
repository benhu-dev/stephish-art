import nextEnvironment from "@next/env";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { cleanupExpiredRateLimitBuckets } from "../../src/server/checkout-cleanup/rateLimitCleanupRepository.ts";
import { consumeRateLimitBucket } from "../../src/server/storefront/storefrontRateLimitRepository.ts";

const { loadEnvConfig } = nextEnvironment;
loadEnvConfig(fileURLToPath(new URL("../../", import.meta.url)), true, {
  error() {},
  info() {},
});

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const runId = randomUUID();
const subjectHash = (label) => createHmac("sha256", runId).update(label).digest("hex");
const concurrentHash = subjectHash("concurrent");
const concurrentScope = "amountSave:network";
const requestFor = (database) => ({ payload: { db: { pool: database } } });

const applicationCounts = async () => (
  await pool.query(
    `SELECT
      (SELECT count(*)::integer FROM public.checkout_intents) AS checkout_intents,
      (SELECT count(*)::integer FROM public.order_uploads) AS order_uploads,
      (SELECT count(*)::integer FROM public.customers) AS customers,
      (SELECT count(*)::integer FROM public.orders) AS orders`,
  )
).rows[0];

let baselineApplication;
let baselineRateLimits;
let completed = false;
let stage = "INITIALIZE";

try {
  baselineApplication = await applicationCounts();
  baselineRateLimits = Number((await pool.query(
    "SELECT count(*)::integer AS count FROM public.storefront_rate_limits",
  )).rows[0].count);
  console.log(`START_COUNTS=${JSON.stringify({
    ...baselineApplication,
    storefrontRateLimits: baselineRateLimits,
  })}`);

  stage = "RLS_INSPECTION";
  const accessState = await pool.query(
    `SELECT
      c.relrowsecurity AS rls_enabled,
      (SELECT count(*)::integer FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'storefront_rate_limits') AS policy_count,
      (SELECT count(*)::integer FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'storefront_rate_limits') AS column_count
    FROM pg_class AS c
    INNER JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'storefront_rate_limits'`,
  );
  assert.deepEqual(accessState.rows, [{
    column_count: 5,
    policy_count: 0,
    rls_enabled: true,
  }]);

  stage = "CONCURRENT_INCREMENT";
  const request = requestFor(pool);
  const settledDecisions = await Promise.allSettled(Array.from({ length: 31 }, () =>
    consumeRateLimitBucket({
      limit: 30,
      request,
      scope: concurrentScope,
      subjectHash: concurrentHash,
      windowSeconds: 900,
    }),
  ));
  assert.equal(settledDecisions.every(({ status }) => status === "fulfilled"), true);
  const decisions = settledDecisions.map((result) => result.value);
  assert.equal(decisions.filter(({ allowed }) => allowed).length, 30);
  assert.equal(decisions.filter(({ allowed }) => !allowed).length, 1);
  assert.equal(decisions.every(({ retryAfterSeconds }) =>
    Number.isInteger(retryAfterSeconds) && retryAfterSeconds >= 1 && retryAfterSeconds <= 900
  ), true);
  const persisted = await pool.query(
    `SELECT request_count::integer AS request_count
    FROM public.storefront_rate_limits
    WHERE action = $1 AND subject_hash = $2`,
    [concurrentScope, concurrentHash],
  );
  assert.deepEqual(persisted.rows, [{ request_count: 31 }]);

  stage = "ISOLATED_CLEANUP";
  const cleanupClient = await pool.connect();
  try {
    await cleanupClient.query("BEGIN");
    const cleanupRows = [
      ["currentRead:network", subjectHash("expired-one"), "2000-01-01T00:00:00.000Z", "2000-01-01T00:01:00.000Z"],
      ["currentRead:network", subjectHash("expired-two"), "2000-01-01T00:02:00.000Z", "2000-01-01T00:03:00.000Z"],
      ["currentRead:network", subjectHash("future"), "2099-01-01T00:00:00.000Z", "2099-01-01T00:01:00.000Z"],
    ];
    for (const [action, hash, startedAt, expiresAt] of cleanupRows) {
      await cleanupClient.query(
        `INSERT INTO public.storefront_rate_limits
          (action, subject_hash, window_started_at, request_count, expires_at)
        VALUES ($1, $2, $3, 1, $4)`,
        [action, hash, startedAt, expiresAt],
      );
    }
    const cleanupRequest = requestFor(cleanupClient);
    const beforeDryRun = Number((await cleanupClient.query(
      "SELECT count(*)::integer AS count FROM public.storefront_rate_limits",
    )).rows[0].count);
    const dryRunCount = await cleanupExpiredRateLimitBuckets(cleanupRequest, {
      execute: false,
      limit: 500,
    });
    const afterDryRun = Number((await cleanupClient.query(
      "SELECT count(*)::integer AS count FROM public.storefront_rate_limits",
    )).rows[0].count);
    assert.equal(afterDryRun, beforeDryRun);
    assert.equal(dryRunCount >= 2 && dryRunCount <= 500, true);

    const deleted = await cleanupExpiredRateLimitBuckets(cleanupRequest, {
      execute: true,
      limit: 500,
    });
    assert.equal(deleted, dryRunCount);
    const fixtureRows = await cleanupClient.query(
      `SELECT subject_hash
      FROM public.storefront_rate_limits
      WHERE subject_hash = ANY($1::text[])
      ORDER BY subject_hash`,
      [cleanupRows.map(([, hash]) => hash)],
    );
    assert.deepEqual(
      fixtureRows.rows.map(({ subject_hash }) => subject_hash.trim()),
      [subjectHash("future")],
    );
    await cleanupClient.query("ROLLBACK");
  } catch (error) {
    await cleanupClient.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    cleanupClient.release();
  }
  completed = true;
} catch (error) {
  console.error(`STOREFRONT_RATE_LIMIT_LIFECYCLE_FAILURE_STAGE=${stage}`);
  console.error(`STOREFRONT_RATE_LIMIT_LIFECYCLE_FAILURE=${JSON.stringify({
    code: typeof error?.code === "string" ? error.code : "unknown",
    constraint: typeof error?.constraint === "string" ? error.constraint : "none",
    table: typeof error?.table === "string" ? error.table : "none",
  })}`);
  process.exitCode = 1;
} finally {
  await pool.query(
    "DELETE FROM public.storefront_rate_limits WHERE action = $1 AND subject_hash = $2",
    [concurrentScope, concurrentHash],
  ).catch(() => {});
  try {
    const finalApplication = await applicationCounts();
    const finalRateLimits = Number((await pool.query(
      "SELECT count(*)::integer AS count FROM public.storefront_rate_limits",
    )).rows[0].count);
    assert.deepEqual(finalApplication, baselineApplication);
    assert.equal(finalRateLimits, baselineRateLimits);
    console.log(`FINAL_COUNTS=${JSON.stringify({
      ...finalApplication,
      storefrontRateLimits: finalRateLimits,
    })}`);
  } catch {
    process.exitCode = 1;
    console.error("STOREFRONT_RATE_LIMIT_SYNTHETIC_CLEANUP=FAIL");
  }
  await pool.end().catch(() => { process.exitCode = 1; });
  if (completed && !process.exitCode) {
    console.log("STOREFRONT_RATE_LIMIT_LIFECYCLE=PASS");
    console.log("CONCURRENT_INCREMENT=PASS");
    console.log("DRY_RUN_MUTATION_FREE=PASS");
    console.log("APPLICATION_DATA_UNCHANGED=PASS");
    console.log("RLS_WITHOUT_PUBLIC_POLICIES=PASS");
  }
}
