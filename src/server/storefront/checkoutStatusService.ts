import type { PayloadRequest } from "payload";

import type { CheckoutIntentCredential } from "./checkoutIntentCookie";
import { authorizeCheckoutIntent } from "./checkoutIntentAccess";
import { StorefrontApiError } from "./storefrontApiError";

export type PublicCheckoutStatus =
  | { state: "expired" | "not_started" | "processing" }
  | {
      currency: "usd";
      shippingAmountCents: number;
      state: "confirmed";
      subtotalAmountCents: number;
      totalAmountCents: number;
    };

const unavailable = () =>
  new StorefrontApiError(503, "STATUS_UNAVAILABLE");

const relationshipID = (value: unknown) => {
  if (typeof value === "number") return value;
  if (typeof value === "object" && value !== null && "id" in value) {
    return Number(value.id);
  }
  return Number.NaN;
};

const readConfirmedStatus = async (
  request: PayloadRequest,
  intent: Awaited<ReturnType<typeof authorizeCheckoutIntent>>,
): Promise<PublicCheckoutStatus> => {
  const orders = await request.payload.find({
    collection: "orders",
    depth: 0,
    limit: 2,
    overrideAccess: true,
    req: request,
    select: {
      amountCents: true,
      checkoutIntent: true,
      currency: true,
    },
    where: { checkoutIntent: { equals: intent.id } },
  });
  const order = orders.docs[0];
  const amountsAreSafe =
    Number.isSafeInteger(intent.amountCents) &&
    intent.amountCents > 0 &&
    Number.isSafeInteger(intent.shippingAmountCents) &&
    (intent.shippingAmountCents ?? -1) >= 0 &&
    Number.isSafeInteger(intent.totalAmountCents) &&
    intent.totalAmountCents ===
      intent.amountCents + (intent.shippingAmountCents ?? Number.NaN);
  const orderMatches =
    orders.docs.length === 1 &&
    relationshipID(order?.checkoutIntent) === intent.id &&
    order?.currency === "usd" &&
    order.amountCents === intent.totalAmountCents;

  if (!amountsAreSafe || !orderMatches) throw unavailable();

  return {
    currency: "usd",
    shippingAmountCents: intent.shippingAmountCents as number,
    state: "confirmed",
    subtotalAmountCents: intent.amountCents,
    totalAmountCents: intent.totalAmountCents as number,
  };
};

export const readCheckoutStatus = async (
  request: PayloadRequest,
  credential: CheckoutIntentCredential,
): Promise<PublicCheckoutStatus> => {
  const intent = await authorizeCheckoutIntent(request, credential);

  switch (intent.status) {
    case "draft":
      return { state: "not_started" };
    case "checkout_pending":
    case "checkout_created":
      return { state: "processing" };
    case "expired":
      return { state: "expired" };
    case "completed":
      return readConfirmedStatus(request, intent);
    default:
      throw unavailable();
  }
};
