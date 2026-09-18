import type { PayloadRequest } from "payload";

import { CHECKOUT_INTENT_POLICY } from "../checkout-intents/checkoutIntentPolicy";
import type { StripeWebhookCode } from "./stripeWebhookContract";
import {
  createWebhookLedgerEntry,
  type WebhookEventEnvelope,
  type WebhookIntent,
  type WebhookUpload,
} from "./stripeWebhookPersistence";
import type { ValidatedSessionBase } from "./stripeWebhookSession";

const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export const storedSessionConflict = (
  intent: WebhookIntent,
  session: ValidatedSessionBase,
): StripeWebhookCode | null => {
  if (
    intent.attemptId !== session.attemptId ||
    intent.sessionId !== session.sessionId ||
    !intent.sessionExpiresAt ||
    !intent.checkoutStartedAt
  ) {
    return "reconciliation_mismatch";
  }
  const storedSessionExpiry = new Date(intent.sessionExpiresAt).getTime();
  const intentExpiry = new Date(intent.expiresAt).getTime();
  const checkoutStartedAt = new Date(intent.checkoutStartedAt).getTime();
  if (
    !Number.isFinite(storedSessionExpiry) ||
    !Number.isFinite(intentExpiry) ||
    !Number.isFinite(checkoutStartedAt) ||
    storedSessionExpiry !== session.expiresAtEpochSeconds * 1000 ||
    storedSessionExpiry > intentExpiry ||
    checkoutStartedAt >= storedSessionExpiry
  ) {
    return "session_mismatch";
  }
  if (
    intent.amountCents !== session.amountSubtotal ||
    intent.shippingAmountCents !== session.shippingAmount ||
    intent.totalAmountCents !== session.amountTotal
  ) {
    return "amount_mismatch";
  }
  return null;
};

export const webhookUploadsAreValid = (uploads: WebhookUpload[]) => {
  if (
    uploads.length < 1 ||
    uploads.length > CHECKOUT_INTENT_POLICY.maximumUploads
  ) {
    return false;
  }
  const positions = new Set<number>();
  return uploads.every((upload) => {
    const valid =
      Number.isSafeInteger(upload.id) &&
      Number.isSafeInteger(upload.position) &&
      upload.position >= 1 &&
      upload.position <= CHECKOUT_INTENT_POLICY.maximumUploads &&
      !positions.has(upload.position) &&
      typeof upload.filename === "string" &&
      upload.filename.length > 0 &&
      typeof upload.mimeType === "string" &&
      allowedMimeTypes.has(upload.mimeType) &&
      Number.isSafeInteger(upload.filesize) &&
      upload.filesize > 0 &&
      upload.filesize <= CHECKOUT_INTENT_POLICY.perFileUploadLimitBytes;
    positions.add(upload.position);
    return valid;
  });
};

export const recordWebhookDecision = async (
  request: PayloadRequest,
  event: WebhookEventEnvelope,
  now: Date,
  disposition: "ignored" | "processed" | "rejected",
  code: StripeWebhookCode,
  intentId?: number,
) => {
  await createWebhookLedgerEntry({
    code,
    disposition,
    event,
    intentId,
    now,
    request,
  });
  return disposition;
};
