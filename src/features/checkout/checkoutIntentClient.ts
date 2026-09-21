import {
  SUPPORTED_PHOTO_MIME_TYPES,
  type CheckoutLimits,
} from "./clientCheckoutDraft";

const CHECKOUT_INTENT_ENDPOINT = "/api/storefront/checkout-intents";
const GENERIC_ERROR = "We couldn't save your amount right now. Please try again.";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type SubmitOptions = { fetchImpl?: FetchLike; signal?: AbortSignal };
type SubmissionResult =
  | { ok: true; value: { amountCents: number; limits: CheckoutLimits } }
  | { message: string; ok: false };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: string[]) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
};

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const supportedPhotoTypes = new Set(SUPPORTED_PHOTO_MIME_TYPES);

const parseLimits = (value: unknown): CheckoutLimits | null => {
  if (!isRecord(value) || !hasExactKeys(value, [
    "allowedMimeTypes",
    "maxFileBytes",
    "maxFiles",
    "maxTotalBytes",
    "minimumAmountCents",
  ])) return null;
  if (
    !Array.isArray(value.allowedMimeTypes)
    || value.allowedMimeTypes.length === 0
    || !value.allowedMimeTypes.every((mimeType) => typeof mimeType === "string" && /^image\/[a-z0-9.+-]+$/.test(mimeType))
    || !value.allowedMimeTypes.every((mimeType) => supportedPhotoTypes.has(mimeType))
    || new Set(value.allowedMimeTypes).size !== value.allowedMimeTypes.length
    || !isPositiveInteger(value.maxFileBytes)
    || !isPositiveInteger(value.maxFiles)
    || !isPositiveInteger(value.maxTotalBytes)
    || value.maxTotalBytes < value.maxFileBytes
    || !isPositiveInteger(value.minimumAmountCents)
  ) return null;
  return {
    allowedMimeTypes: [...value.allowedMimeTypes],
    maxFileBytes: value.maxFileBytes,
    maxFiles: value.maxFiles,
    maxTotalBytes: value.maxTotalBytes,
    minimumAmountCents: value.minimumAmountCents,
  };
};

const hasValidUploads = (value: unknown, limits: CheckoutLimits) =>
  Array.isArray(value) && value.length <= limits.maxFiles && value.every((upload) => {
    if (!isRecord(upload) || !hasExactKeys(upload, ["id", "mimeType", "position", "sizeBytes"])) return false;
    const validId = isPositiveInteger(upload.id)
      || (typeof upload.id === "string" && upload.id.length > 0);
    const validMime = upload.mimeType === null
      || (typeof upload.mimeType === "string" && limits.allowedMimeTypes.includes(upload.mimeType));
    const validSize = upload.sizeBytes === null || isPositiveInteger(upload.sizeBytes);
    return validId && validMime && validSize
      && isPositiveInteger(upload.position) && upload.position <= limits.maxFiles;
  });

const parseSafeResponse = (value: unknown) => {
  if (!isRecord(value)) return null;
  const baseKeys = ["amountCents", "expiresAt", "limits", "status", "uploads"];
  const snapshotKeys = [...baseKeys, "shippingAmountCents", "totalAmountCents"];
  if (!hasExactKeys(value, baseKeys) && !hasExactKeys(value, snapshotKeys)) return null;
  const limits = parseLimits(value.limits);
  if (
    !limits
    || value.status !== "draft"
    || !isPositiveInteger(value.amountCents)
    || value.amountCents < limits.minimumAmountCents
    || typeof value.expiresAt !== "string"
    || !Number.isFinite(Date.parse(value.expiresAt))
    || !hasValidUploads(value.uploads, limits)
  ) return null;
  if (hasExactKeys(value, snapshotKeys)) {
    if (
      typeof value.shippingAmountCents !== "number"
      || !Number.isSafeInteger(value.shippingAmountCents)
      || value.shippingAmountCents < 0
      || !isPositiveInteger(value.totalAmountCents)
      || value.totalAmountCents !== value.amountCents + value.shippingAmountCents
    ) return null;
  }
  return { amountCents: value.amountCents, limits };
};

const errorMessage = (status: number) => {
  if (status === 400) return "Check the amount and try again.";
  if (status === 422) return "That amount is below the current minimum. Try a larger amount.";
  if (status === 401) return "This checkout is unavailable in this browser. Please try again.";
  if (status === 403) return "This request couldn't be verified. Please try again.";
  if (status === 409) return "This checkout can no longer be changed. Please close it and start again.";
  return GENERIC_ERROR;
};

export async function submitCheckoutAmount(
  amountCents: number,
  { fetchImpl = globalThis.fetch, signal }: SubmitOptions = {},
): Promise<SubmissionResult> {
  if (!isPositiveInteger(amountCents)) {
    return { message: "Enter a valid positive dollar amount.", ok: false };
  }
  try {
    const response = await fetchImpl(CHECKOUT_INTENT_ENDPOINT, {
      body: JSON.stringify({ amountCents }),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "POST",
      ...(signal ? { signal } : {}),
    });
    if (response.status !== 200 && response.status !== 201) {
      return { message: errorMessage(response.status), ok: false };
    }
    const value = parseSafeResponse(await response.json());
    return value ? { ok: true, value } : { message: GENERIC_ERROR, ok: false };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { message: "Saving was cancelled. Please try again.", ok: false };
    }
    return { message: "We couldn't save your amount. Check your connection and try again.", ok: false };
  }
}
