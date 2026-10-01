import type { PayloadRequest } from "payload";

type QueryResult = {
  rows: Record<string, unknown>[];
};

type DatabasePool = {
  query: (text: string, values?: unknown[]) => Promise<QueryResult>;
};

export type RateLimitBucketInput = {
  limit: number;
  request: PayloadRequest;
  scope: string;
  subjectHash: string;
  windowSeconds: number;
};

export type RateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
};

const poolFor = (request: PayloadRequest) => {
  const pool = request.payload.db.pool as DatabasePool | undefined;
  if (!pool) throw new Error("RATE_LIMIT_DATABASE_UNAVAILABLE");
  return pool;
};

export const consumeRateLimitBucket = async ({
  limit,
  request,
  scope,
  subjectHash,
  windowSeconds,
}: RateLimitBucketInput): Promise<RateLimitDecision> => {
  const result = await poolFor(request).query(
    `WITH bucket_time AS (
      SELECT
        statement_timestamp() AS checked_at,
        to_timestamp(
          floor(extract(epoch FROM statement_timestamp()) / $3::integer)
          * $3::integer
        ) AS window_started_at
    )
    INSERT INTO public.storefront_rate_limits (
      action, subject_hash, window_started_at, request_count, expires_at
    )
    SELECT
      $1, $2, window_started_at, 1,
      window_started_at + make_interval(secs => $3::integer)
    FROM bucket_time
    ON CONFLICT (action, subject_hash, window_started_at)
    DO UPDATE SET
      request_count = CASE
        WHEN storefront_rate_limits.request_count < 2147483647
          THEN storefront_rate_limits.request_count + 1
        ELSE 2147483647
      END,
      expires_at = GREATEST(
        storefront_rate_limits.expires_at,
        EXCLUDED.expires_at
      )
    RETURNING
      request_count,
      GREATEST(
        1,
        LEAST(
          $3::integer,
          ceil(extract(epoch FROM expires_at - statement_timestamp()))::integer
        )
      ) AS retry_after_seconds`,
    [scope, subjectHash, windowSeconds],
  );
  const row = result.rows[0];
  const count = Number(row?.request_count);
  const retryAfterSeconds = Number(row?.retry_after_seconds);
  if (
    !Number.isSafeInteger(count) ||
    count < 1 ||
    !Number.isSafeInteger(retryAfterSeconds) ||
    retryAfterSeconds < 1 ||
    retryAfterSeconds > windowSeconds
  ) {
    throw new Error("RATE_LIMIT_DECISION_INVALID");
  }
  return { allowed: count <= limit, retryAfterSeconds };
};
