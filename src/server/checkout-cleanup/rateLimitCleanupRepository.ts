import type { PayloadRequest } from "payload";

type QueryResult = {
  rows: Record<string, unknown>[];
};

type DatabasePool = {
  query: (text: string, values?: unknown[]) => Promise<QueryResult>;
};

const poolFor = (request: PayloadRequest) => {
  const pool = request.payload.db.pool as DatabasePool | undefined;
  if (!pool) throw new Error("RATE_LIMIT_CLEANUP_DATABASE_UNAVAILABLE");
  return pool;
};

export const cleanupExpiredRateLimitBuckets = async (
  request: PayloadRequest,
  { execute, limit }: { execute: boolean; limit: number },
) => {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error("RATE_LIMIT_CLEANUP_LIMIT_INVALID");
  }
  const pool = poolFor(request);
  if (!execute) {
    const result = await pool.query(
      `SELECT count(*)::integer AS count
      FROM (
        SELECT 1
        FROM public.storefront_rate_limits
        WHERE expires_at <= statement_timestamp()
        ORDER BY expires_at, action, subject_hash, window_started_at
        LIMIT $1
      ) AS candidates`,
      [limit],
    );
    const count = Number(result.rows[0]?.count);
    if (!Number.isSafeInteger(count) || count < 0 || count > limit) {
      throw new Error("RATE_LIMIT_CLEANUP_RESULT_INVALID");
    }
    return count;
  }

  const result = await pool.query(
    `WITH candidates AS (
      SELECT action, subject_hash, window_started_at
      FROM public.storefront_rate_limits
      WHERE expires_at <= statement_timestamp()
      ORDER BY expires_at, action, subject_hash, window_started_at
      FOR UPDATE SKIP LOCKED
      LIMIT $1
    )
    DELETE FROM public.storefront_rate_limits AS buckets
    USING candidates
    WHERE buckets.action = candidates.action
      AND buckets.subject_hash = candidates.subject_hash
      AND buckets.window_started_at = candidates.window_started_at
    RETURNING buckets.action`,
    [limit],
  );
  return result.rows.length;
};
