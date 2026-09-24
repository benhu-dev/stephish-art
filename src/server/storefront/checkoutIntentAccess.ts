import { timingSafeEqual } from "node:crypto";
import type { PayloadRequest } from "payload";

import { hashCheckoutIntentToken } from "../checkout-intents/checkoutIntentCredentials";
import type { CheckoutIntentCredential } from "./checkoutIntentCookie";
import { unauthorizedIntentError } from "./storefrontApiError";

export type AuthorizedCheckoutIntent = {
  amountCents: number;
  artistNote: string | null;
  checkoutAttemptId: string | null;
  deleteAfter: string;
  expiresAt: string;
  id: number;
  shippingAmountCents: number | null;
  status: string;
  stripeCheckoutSessionExpiresAt: string | null;
  stripeCheckoutSessionId: string | null;
  totalAmountCents: number | null;
};

const matchesCredential = (
  persistedHash: unknown,
  credential: CheckoutIntentCredential,
) => {
  const suppliedHash = hashCheckoutIntentToken(credential.rawToken);
  return (
    typeof persistedHash === "string" &&
    persistedHash.length === suppliedHash.length &&
    timingSafeEqual(Buffer.from(persistedHash), Buffer.from(suppliedHash))
  );
};

export const authorizeCheckoutIntent = async (
  request: PayloadRequest,
  credential: CheckoutIntentCredential,
): Promise<AuthorizedCheckoutIntent> => {
  let document: Record<string, unknown>;
  try {
    document = (await request.payload.findByID({
      collection: "checkout-intents",
      depth: 0,
      id: credential.intentId,
      overrideAccess: true,
      req: request,
      showHiddenFields: true,
    })) as unknown as Record<string, unknown>;
  } catch {
    throw unauthorizedIntentError();
  }

  if (!matchesCredential(document.accessTokenHash, credential)) {
    throw unauthorizedIntentError();
  }

  const expiresAt = new Date(String(document.expiresAt));
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date()) {
    throw unauthorizedIntentError(true);
  }

  return {
    amountCents: Number(document.amountCents),
    artistNote:
      typeof document.artistNote === "string" ? document.artistNote : null,
    checkoutAttemptId:
      typeof document.checkoutAttemptId === "string"
        ? document.checkoutAttemptId
        : null,
    deleteAfter: String(document.deleteAfter),
    expiresAt: expiresAt.toISOString(),
    id: Number(document.id),
    shippingAmountCents:
      document.shippingAmountCents === null ||
      document.shippingAmountCents === undefined
        ? null
        : Number(document.shippingAmountCents),
    status: String(document.status),
    stripeCheckoutSessionExpiresAt:
      typeof document.stripeCheckoutSessionExpiresAt === "string"
        ? document.stripeCheckoutSessionExpiresAt
        : null,
    stripeCheckoutSessionId:
      typeof document.stripeCheckoutSessionId === "string"
        ? document.stripeCheckoutSessionId
        : null,
    totalAmountCents:
      document.totalAmountCents === null ||
      document.totalAmountCents === undefined
        ? null
        : Number(document.totalAmountCents),
  };
};
