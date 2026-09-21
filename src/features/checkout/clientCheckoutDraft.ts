export const MIN_AMOUNT_CENTS = 500;
export const SHIPPING_AMOUNT_CENTS = 100;
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
export const MAX_TOTAL_PHOTO_BYTES = 30 * 1024 * 1024;
export const MAX_PHOTO_COUNT = 3;

const ALLOWED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type LocalPhoto = { name: string; size: number; type: string };

export function parseUsdAmount(value: string): { cents: number | null; error: string | null } {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    return { cents: null, error: "Enter a valid dollar amount with no more than two decimal places." };
  }
  const [dollars, fraction = ""] = normalized.split(".");
  const cents = Number(dollars) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return { cents: null, error: "Enter a smaller dollar amount." };
  if (cents < MIN_AMOUNT_CENTS) return { cents: null, error: "Choose an amount of at least $5.00." };
  return { cents, error: null };
}

export function validatePhotoSelection(existing: LocalPhoto[], incoming: LocalPhoto[]) {
  if (incoming.length === 0) return { error: "Choose at least one photo." };
  if (existing.length + incoming.length > MAX_PHOTO_COUNT) {
    return { error: "Choose up to 3 photos." };
  }
  if (incoming.some(({ type }) => !ALLOWED_PHOTO_TYPES.has(type))) {
    return { error: "Photos must be JPEG, PNG, or WebP." };
  }
  if (incoming.some(({ size }) => size <= 0 || size > MAX_PHOTO_BYTES)) {
    return { error: "Each photo must be 15 MiB or smaller." };
  }
  const totalBytes = [...existing, ...incoming].reduce((sum, { size }) => sum + size, 0);
  if (totalBytes > MAX_TOTAL_PHOTO_BYTES) return { error: "Photos must total 30 MiB or less." };
  return { error: null };
}

export function formatUsd(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}
