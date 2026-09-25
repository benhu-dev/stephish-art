import {
  MAX_PHOTO_BYTES,
  MAX_PHOTO_COUNT,
  MAX_TOTAL_PHOTO_BYTES,
  SUPPORTED_PHOTO_MIME_TYPES,
  type CheckoutLimits,
} from "./clientCheckoutDraft";

const CHECKOUT_INTENT_ENDPOINT = "/api/storefront/checkout-intents";
const ARTIST_NOTE_ENDPOINT = `${CHECKOUT_INTENT_ENDPOINT}/current/artist-note`;
const GENERIC_ERROR = "We couldn't save your amount right now. Please try again.";
const GENERIC_NOTE_ERROR = "We couldn't save your note right now. Please try again.";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type SubmitOptions = { fetchImpl?: FetchLike; signal?: AbortSignal };
type SubmissionResult =
  | { ok: true; value: SafeIntentState & { created: boolean } }
  | { message: string; ok: false; reason?: "conflict" | "fresh" };

export type SafeUpload = { id: number; position: number; mimeType: string | null; sizeBytes: number | null };
export type SafeIntentState = { amountCents: number; artistNote: string; limits: CheckoutLimits; uploads: SafeUpload[] };
export type SafeCurrentIntentState = SafeIntentState & {
  status: "checkout_created" | "checkout_pending" | "completed" | "draft" | "expired";
};

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
    || value.maxFileBytes > MAX_PHOTO_BYTES
    || value.maxFiles > MAX_PHOTO_COUNT
    || value.maxTotalBytes > MAX_TOTAL_PHOTO_BYTES
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

const hasValidUploads = (value: unknown, limits: CheckoutLimits): value is SafeUpload[] =>
  Array.isArray(value) && value.length <= limits.maxFiles && value.every((upload) => {
    if (!isRecord(upload) || !hasExactKeys(upload, ["id", "mimeType", "position", "sizeBytes"])) return false;
    const validId = isPositiveInteger(upload.id);
    const validMime = upload.mimeType === null
      || (typeof upload.mimeType === "string" && limits.allowedMimeTypes.includes(upload.mimeType));
    const validSize = upload.sizeBytes === null || isPositiveInteger(upload.sizeBytes);
    return validId && validMime && validSize
      && isPositiveInteger(upload.position) && upload.position <= limits.maxFiles;
  }) && new Set(value.map((upload: SafeUpload) => upload.position)).size === value.length;

export const parseSafeCurrentResponse = (value: unknown): SafeCurrentIntentState | null => {
  if (!isRecord(value)) return null;
  const baseKeys = ["amountCents", "artistNote", "expiresAt", "limits", "status", "uploads"];
  const snapshotKeys = [...baseKeys, "shippingAmountCents", "totalAmountCents"];
  if (!hasExactKeys(value, baseKeys) && !hasExactKeys(value, snapshotKeys)) return null;
  const limits = parseLimits(value.limits);
  if (
    !limits
    || !["checkout_created", "checkout_pending", "completed", "draft", "expired"].includes(String(value.status))
    || !isPositiveInteger(value.amountCents)
    || value.amountCents < limits.minimumAmountCents
    || typeof value.artistNote !== "string"
    || value.artistNote.length > 1_000
    || value.artistNote.includes("\r")
    || value.artistNote !== value.artistNote.trim()
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
  if (
    value.status !== "draft" &&
    value.status !== "expired" &&
    !hasExactKeys(value, snapshotKeys)
  ) return null;
  return {
    amountCents: value.amountCents,
    artistNote: value.artistNote,
    limits,
    status: value.status as SafeCurrentIntentState["status"],
    uploads: value.uploads,
  };
};

export const parseSafeResponse = (value: unknown): SafeIntentState | null => {
  const parsed = parseSafeCurrentResponse(value);
  if (!parsed || parsed.status !== "draft") return null;
  return {
    amountCents: parsed.amountCents,
    artistNote: parsed.artistNote,
    limits: parsed.limits,
    uploads: parsed.uploads,
  };
};

const errorMessage = (status: number) => {
  if (status === 400) return "Check the amount and try again.";
  if (status === 422) return "That amount is below the current minimum. Try a larger amount.";
  if (status === 401) return "This checkout is unavailable in this browser. Please try again.";
  if (status === 403) return "This request couldn't be verified. Please try again.";
  if (status === 409) return "This checkout can no longer be changed. Please close it and start again.";
  return GENERIC_ERROR;
};

const artistNoteErrorMessage = (status: number) => {
  if (status === 422) return "Keep your note to 1,000 characters or fewer.";
  if (status === 401) return "This checkout is unavailable in this browser. Please try again.";
  if (status === 403) return "This request couldn't be verified. Please try again.";
  if (status === 409) return "This checkout can no longer be changed. Please close it and start again.";
  return GENERIC_NOTE_ERROR;
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
      return {
        message: errorMessage(response.status),
        ok: false,
        ...(response.status === 409 ? { reason: "conflict" as const } : {}),
        ...([401, 410].includes(response.status) ? { reason: "fresh" as const } : {}),
      };
    }
    const value = parseSafeResponse(await response.json());
    return value ? { ok: true, value: { ...value, created: response.status === 201 } } : { message: GENERIC_ERROR, ok: false };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { message: "Saving was cancelled. Please try again.", ok: false };
    }
    return { message: "We couldn't save your amount. Check your connection and try again.", ok: false };
  }
}

export async function saveCheckoutArtistNote(
  artistNote: string,
  { fetchImpl = globalThis.fetch, signal }: SubmitOptions = {},
): Promise<
  | { ok: true; value: { artistNote: string } }
  | { message: string; ok: false }
> {
  if (typeof artistNote !== "string" || artistNote.length > 1_000) {
    return { message: "Keep your note to 1,000 characters or fewer.", ok: false };
  }
  try {
    const response = await fetchImpl(ARTIST_NOTE_ENDPOINT, {
      body: JSON.stringify({ artistNote }),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "PUT",
      ...(signal ? { signal } : {}),
    });
    if (response.status !== 200) {
      return { message: artistNoteErrorMessage(response.status), ok: false };
    }
    const value = await response.json() as unknown;
    if (
      !isRecord(value) ||
      !hasExactKeys(value, ["artistNote"]) ||
      typeof value.artistNote !== "string" ||
      value.artistNote.length > 1_000 ||
      value.artistNote.includes("\r") ||
      value.artistNote !== value.artistNote.trim()
    ) {
      return { message: GENERIC_NOTE_ERROR, ok: false };
    }
    return { ok: true, value: { artistNote: value.artistNote } };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { message: "Saving was cancelled. Please try again.", ok: false };
    }
    return { message: "We couldn't save your note. Check your connection and try again.", ok: false };
  }
}
