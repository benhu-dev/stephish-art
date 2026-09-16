import { CHECKOUT_INTENT_POLICY } from "../checkout-intents/checkoutIntentPolicy";

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
  expiresAt: string;
  status: string;
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
}) => ({
  status: intent.status,
  amountCents: intent.amountCents,
  expiresAt: intent.expiresAt,
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
});
