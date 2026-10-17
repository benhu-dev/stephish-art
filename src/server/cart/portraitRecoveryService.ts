import type { PayloadRequest } from "payload";
import { authorizeCheckoutIntent } from "../storefront/checkoutIntentAccess";
import type { CheckoutIntentCredential } from "../storefront/checkoutIntentCookie";
import { validatePortraitPaymentSnapshot } from "./portraitPaymentSnapshot";
import { StorefrontApiError } from "../storefront/storefrontApiError";

export const readPortraitRecovery = async ({
  credential,
  request,
}: {
  credential: CheckoutIntentCredential;
  request: PayloadRequest;
}) => {
  const intent = await authorizeCheckoutIntent(request, credential);
  const document = await request.payload.findByID({
    collection: "checkout-intents",
    id: intent.id,
    depth: 0,
    overrideAccess: true,
    req: request,
    select: { portraitPaymentSnapshot: true },
  });
  const raw = document.portraitPaymentSnapshot;
  if (raw != null) {
    const snapshot = validatePortraitPaymentSnapshot(raw);
    if (
      intent.status === "draft" ||
      intent.amountCents !== snapshot.subtotalCents ||
      intent.shippingAmountCents !== snapshot.shipping.amountCents ||
      intent.totalAmountCents !== snapshot.totalCents
    )
      throw new StorefrontApiError(500, "INVALID_CHECKOUT_RESERVATION");
    return {
      status: intent.status,
      checkoutKind: "portrait" as const,
      shippingRegion: snapshot.shipping.region,
      totalAmountCents: snapshot.totalCents,
    };
  }
  const portraits = await request.payload.count({
    collection: "checkout-portraits",
    overrideAccess: true,
    req: request,
    where: { intent: { equals: intent.id } },
  });
  if (
    portraits.totalDocs > 0 &&
    ["checkout_pending", "checkout_created", "completed"].includes(
      intent.status,
    )
  )
    throw new StorefrontApiError(500, "INVALID_CHECKOUT_RESERVATION");
  return {
    status: intent.status,
    checkoutKind:
      portraits.totalDocs > 0 ? ("portrait" as const) : ("legacy" as const),
    shippingRegion: null,
    totalAmountCents: null,
  };
};
