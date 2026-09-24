import { CHECKOUT_INTENT_POLICY } from "../checkout-intents/checkoutIntentPolicy";
import { normalizeArtistNote } from "./artistNote";

export const STOREFRONT_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const STOREFRONT_SAFE_LIMITS = Object.freeze({
  allowedMimeTypes: [...STOREFRONT_ALLOWED_MIME_TYPES],
  maxFileBytes: CHECKOUT_INTENT_POLICY.perFileUploadLimitBytes,
  maxFiles: CHECKOUT_INTENT_POLICY.maximumUploads,
  maxTotalBytes: CHECKOUT_INTENT_POLICY.combinedUploadLimitBytes,
});

type SafeIntentSource = {
  amountCents: number;
  artistNote?: string | null;
  expiresAt: string;
  shippingAmountCents?: number | null;
  status: string;
  totalAmountCents?: number | null;
};

type SafeUploadSource = {
  filesize?: number | null;
  id: number | string;
  mimeType?: string | null;
  position: number;
};

export const buildSafeCheckoutIntentResponse = ({
  intent,
  minimumAmountCents,
  uploads,
}: {
  intent: SafeIntentSource & Record<string, unknown>;
  minimumAmountCents: number;
  uploads: Array<SafeUploadSource & Record<string, unknown>>;
}) => {
  const hasSnapshots =
    Number.isSafeInteger(intent.shippingAmountCents) &&
    Number.isSafeInteger(intent.totalAmountCents);

  return {
    status: intent.status,
    amountCents: intent.amountCents,
    artistNote: normalizeArtistNote(intent.artistNote ?? "") ?? "",
    expiresAt: intent.expiresAt,
    ...(hasSnapshots
      ? {
          shippingAmountCents: intent.shippingAmountCents as number,
          totalAmountCents: intent.totalAmountCents as number,
        }
      : {}),
    uploads: uploads
      .map((upload) => ({
        id: upload.id,
        position: upload.position,
        mimeType: upload.mimeType,
        sizeBytes: upload.filesize,
      }))
      .sort((first, second) => first.position - second.position),
    limits: {
      minimumAmountCents,
      ...STOREFRONT_SAFE_LIMITS,
    },
  };
};
