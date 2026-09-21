export const MIN_AMOUNT_CENTS = 500;
export const SHIPPING_AMOUNT_CENTS = 100;
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
export const MAX_TOTAL_PHOTO_BYTES = 30 * 1024 * 1024;
export const MAX_PHOTO_COUNT = 3;
export const SUPPORTED_PHOTO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

export type CheckoutLimits = {
  allowedMimeTypes: string[];
  maxFileBytes: number;
  maxFiles: number;
  maxTotalBytes: number;
  minimumAmountCents: number;
};

export const INITIAL_CHECKOUT_LIMITS: CheckoutLimits = {
  allowedMimeTypes: [...SUPPORTED_PHOTO_MIME_TYPES],
  maxFileBytes: MAX_PHOTO_BYTES,
  maxFiles: MAX_PHOTO_COUNT,
  maxTotalBytes: MAX_TOTAL_PHOTO_BYTES,
  minimumAmountCents: MIN_AMOUNT_CENTS,
};

type LocalPhoto = { name: string; size: number; type: string };

export function parseUsdAmount(
  value: string,
  minimumAmountCents = MIN_AMOUNT_CENTS,
): { cents: number | null; error: string | null } {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    return { cents: null, error: "Enter a valid dollar amount with no more than two decimal places." };
  }
  const [dollars, fraction = ""] = normalized.split(".");
  const cents = Number(`${dollars}${fraction.padEnd(2, "0")}`);
  if (!Number.isSafeInteger(cents)) return { cents: null, error: "Enter a smaller dollar amount." };
  if (cents < minimumAmountCents) {
    return { cents: null, error: `Choose an amount of at least ${formatUsd(minimumAmountCents)}.` };
  }
  return { cents, error: null };
}

const mimeTypeLabel = (mimeType: string) => {
  const subtype = mimeType.split("/")[1]?.toLowerCase();
  if (subtype === "jpeg") return "JPEG";
  if (subtype === "png") return "PNG";
  if (subtype === "webp") return "WebP";
  return subtype?.toUpperCase() ?? "image";
};

const joinLabels = (labels: string[]) => labels.length < 2
  ? labels[0]
  : `${labels.slice(0, -1).join(", ")}${labels.length > 2 ? "," : ""} or ${labels.at(-1)}`;

export const formatAllowedPhotoTypes = (mimeTypes: string[]) =>
  joinLabels(mimeTypes.map(mimeTypeLabel));
export const formatBytesAsMebibytes = (bytes: number) => `${bytes / (1024 * 1024)} MiB`;
export const formatUsdInput = (cents: number) =>
  `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

export function validatePhotoSelection(
  existing: LocalPhoto[],
  incoming: LocalPhoto[],
  limits: CheckoutLimits = INITIAL_CHECKOUT_LIMITS,
) {
  if (incoming.length === 0) return { error: "Choose at least one photo." };
  if (existing.length + incoming.length > limits.maxFiles) {
    return { error: `Choose up to ${limits.maxFiles} ${limits.maxFiles === 1 ? "photo" : "photos"}.` };
  }
  const allowedPhotoTypes = new Set(limits.allowedMimeTypes);
  if (incoming.some(({ type }) => !allowedPhotoTypes.has(type))) {
    return { error: `Photos must be ${formatAllowedPhotoTypes(limits.allowedMimeTypes)}.` };
  }
  if (incoming.some(({ size }) => size <= 0 || size > limits.maxFileBytes)) {
    return { error: `Each photo must be ${formatBytesAsMebibytes(limits.maxFileBytes)} or smaller.` };
  }
  const totalBytes = [...existing, ...incoming].reduce((sum, { size }) => sum + size, 0);
  if (totalBytes > limits.maxTotalBytes) {
    return { error: `Photos must total ${formatBytesAsMebibytes(limits.maxTotalBytes)} or less.` };
  }
  return { error: null };
}

export function formatUsd(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}
