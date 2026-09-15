import { ORDER_UPLOAD_MAX_FILE_SIZE_BYTES } from "../storage/orderUploadStorage";

const HOUR_IN_MILLISECONDS = 60 * 60 * 1000;

export const CHECKOUT_INTENT_POLICY = Object.freeze({
  activeLifetimeMs: 24 * HOUR_IN_MILLISECONDS,
  combinedUploadLimitBytes: 30 * 1024 * 1024,
  deletionEligibilityMs: 48 * HOUR_IN_MILLISECONDS,
  maximumUploads: 3,
  perFileUploadLimitBytes: ORDER_UPLOAD_MAX_FILE_SIZE_BYTES,
});

export const calculateCheckoutIntentDeadlines = (createdAt: Date) => {
  const createdAtMilliseconds = createdAt.getTime();

  if (!Number.isFinite(createdAtMilliseconds)) {
    throw new Error("Checkout Intent requires a valid creation time.");
  }

  return {
    expiresAt: new Date(
      createdAtMilliseconds + CHECKOUT_INTENT_POLICY.activeLifetimeMs,
    ),
    deleteAfter: new Date(
      createdAtMilliseconds + CHECKOUT_INTENT_POLICY.deletionEligibilityMs,
    ),
  };
};
