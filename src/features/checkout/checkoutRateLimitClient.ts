export const GENERIC_RATE_LIMIT_MESSAGE =
  "Please wait a moment, then try again.";

export const readRetryAfterSeconds = (
  response: Pick<Response, "headers">,
): number | null => {
  const value = response.headers.get("retry-after");
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds <= 15 * 60 ? seconds : null;
};
