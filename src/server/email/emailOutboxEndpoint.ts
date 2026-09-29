import { timingSafeEqual } from "node:crypto";

import type { EmailOutboxSummary } from "./emailDeliveryTypes";

const headers = { "Cache-Control": "no-store" };
const response = (status: number, error: string) =>
  Response.json({ error }, { headers, status });

const validSecret = (secret: string | undefined): secret is string =>
  Boolean(secret && secret.length >= 32 && secret.trim() === secret);

const authorized = (actual: string | null, secret: string) => {
  if (actual === null) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(`Bearer ${secret}`);
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
};

export const handleEmailOutboxCronRequest = async (
  request: Request,
  {
    cronSecret,
    runProcessor,
  }: {
    cronSecret: string | undefined;
    runProcessor: () => Promise<EmailOutboxSummary>;
  },
) => {
  if (!validSecret(cronSecret)) return response(500, "Email delivery unavailable.");
  if (!authorized(request.headers.get("authorization"), cronSecret)) {
    return response(401, "Unauthorized.");
  }
  if (new URL(request.url).search) return response(400, "Invalid request.");

  try {
    return Response.json(await runProcessor(), { headers, status: 200 });
  } catch {
    return response(500, "Email delivery failed.");
  }
};
