import { timingSafeEqual } from "node:crypto";

import type { CleanupSummary } from "./checkoutCleanupTypes";
import { validateCheckoutCleanupEnvironment } from "./checkoutCleanupEnvironment";

type RunCleanup = (options: { execute: true }) => Promise<CleanupSummary>;

const noStoreHeaders = { "Cache-Control": "no-store" };

const safeEqual = (actual: string | null, expected: string) => {
  if (actual === null) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
};

const errorResponse = (status: number, error: string) =>
  Response.json(
    { error },
    { headers: noStoreHeaders, status },
  );

export const handleCheckoutCleanupCronRequest = async (
  request: Request,
  {
    cronSecret,
    runCleanup,
  }: {
    cronSecret: string | undefined;
    runCleanup: RunCleanup;
  },
) => {
  let environment;
  try {
    environment = validateCheckoutCleanupEnvironment({ cronSecret });
  } catch {
    return errorResponse(500, "Cleanup unavailable.");
  }

  if (
    !safeEqual(
      request.headers.get("authorization"),
      `Bearer ${environment.cronSecret}`,
    )
  ) {
    return errorResponse(401, "Unauthorized.");
  }
  if (new URL(request.url).search) {
    return errorResponse(400, "Invalid request.");
  }

  try {
    return Response.json(await runCleanup({ execute: true }), {
      headers: noStoreHeaders,
      status: 200,
    });
  } catch {
    return errorResponse(500, "Cleanup failed.");
  }
};
