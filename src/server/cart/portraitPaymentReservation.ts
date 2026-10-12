import { sql } from "@payloadcms/db-postgres";
import { randomUUID } from "node:crypto";
import { StorefrontApiError } from "../storefront/storefrontApiError";
import type {
  LockedCheckoutIntent,
  StorefrontTransaction,
} from "../storefront/storefrontTransaction";
import type { CheckoutSessionReservation } from "../storefront/checkoutSessionReservation";
import {
  buildPortraitPaymentSnapshot,
  validatePortraitPaymentSnapshot,
} from "./portraitPaymentSnapshot";
import {
  parsePortraitCheckoutRequest,
  type PortraitCheckoutRequest,
} from "./portraitShippingPolicy";

export const reservePortraitPayment = async ({
  transaction,
  intent,
  input,
  now,
}: {
  transaction: StorefrontTransaction;
  intent: LockedCheckoutIntent;
  input?: PortraitCheckoutRequest;
  now: Date;
}): Promise<CheckoutSessionReservation> => {
  const request = transaction.request;
  if (input) input = parsePortraitCheckoutRequest(input);
  const expiresAtEpochSeconds = Math.floor(Date.parse(intent.expiresAt) / 1000);
  if (intent.status !== "draft") {
    if (
      intent.status !== "checkout_pending" &&
      intent.status !== "checkout_created"
    )
      throw new StorefrontApiError(409, "CHECKOUT_PROCESSING");
    const snapshot = validatePortraitPaymentSnapshot(
      intent.portraitPaymentSnapshot,
    );
    if (input && input.shippingRegion !== snapshot.shipping.region)
      throw new StorefrontApiError(409, "SHIPPING_REGION_LOCKED");
    if (
      !intent.checkoutAttemptId ||
      intent.amountCents !== snapshot.subtotalCents ||
      intent.shippingAmountCents !== snapshot.shipping.amountCents ||
      intent.totalAmountCents !== snapshot.totalCents ||
      (intent.status === "checkout_created" &&
        (!intent.stripeCheckoutSessionId ||
          !intent.stripeCheckoutSessionExpiresAt))
    ) {
      throw new StorefrontApiError(500, "INVALID_CHECKOUT_RESERVATION");
    }
    return {
      amountCents: snapshot.subtotalCents,
      shippingAmountCents: snapshot.shipping.amountCents,
      attemptId: intent.checkoutAttemptId,
      createdAttempt: false,
      expiresAtEpochSeconds,
      intentId: intent.id,
      storedSessionId: intent.stripeCheckoutSessionId,
      portraitSnapshot: snapshot,
    };
  }
  if (!input) throw new StorefrontApiError(409, "PORTRAIT_CHECKOUT_NOT_READY");
  if (Date.parse(intent.expiresAt) - now.getTime() < 30 * 60 * 1000)
    throw new StorefrontApiError(410, "INTENT_EXPIRED", { clearCookie: true });
  if (intent.portraitPaymentSnapshot)
    throw new StorefrontApiError(500, "INVALID_CHECKOUT_RESERVATION");
  // Serialize catalog edits until the text/preview selection is frozen.
  await transaction.database.execute(sql`
    SELECT t.id FROM public.postcard_templates t
    WHERE t.id IN (SELECT template_id FROM public.checkout_portraits WHERE intent_id = ${intent.id})
    ORDER BY t.id FOR SHARE
  `);
  await transaction.database.execute(sql`
    SELECT m.id FROM public.template_media m
    WHERE m.id IN (SELECT t.preview_media_id FROM public.postcard_templates t
      JOIN public.checkout_portraits p ON p.template_id = t.id WHERE p.intent_id = ${intent.id})
    ORDER BY m.id FOR SHARE
  `);
  const portraits = await request.payload.find({
    collection: "checkout-portraits",
    depth: 2,
    limit: 6,
    pagination: false,
    sort: "position",
    where: { intent: { equals: intent.id } },
    overrideAccess: true,
    req: request,
  });
  const uploads = await request.payload.find({
    collection: "order-uploads",
    depth: 0,
    limit: 16,
    pagination: false,
    sort: ["checkoutPortrait", "position"],
    where: { checkoutIntent: { equals: intent.id } },
    overrideAccess: true,
    req: request,
  });
  if (
    uploads.docs.some((u) => u.order || u.orderPortrait || !u.checkoutPortrait)
  )
    throw new StorefrontApiError(422, "INVALID_CART_UPLOAD_STATE");
  const snapshot = buildPortraitPaymentSnapshot({
    portraits: portraits.docs as unknown as Record<string, unknown>[],
    uploads: uploads.docs as unknown as Record<string, unknown>[],
    region: input.shippingRegion,
    now,
  });
  if (intent.amountCents !== snapshot.subtotalCents)
    throw new StorefrontApiError(500, "INVALID_CART_SUBTOTAL");
  for (const portrait of snapshot.portraits) {
    await request.payload.update({
      collection: "checkout-portraits",
      id: portrait.checkoutPortraitId,
      data: { reservedPreviewMedia: portrait.templatePreviewMedia },
      depth: 0,
      overrideAccess: true,
      req: request,
    });
  }
  const attemptId = randomUUID();
  await request.payload.update({
    collection: "checkout-intents",
    id: intent.id,
    data: {
      checkoutAttemptId: attemptId,
      checkoutStartedAt: now.toISOString(),
      portraitPaymentSnapshot: snapshot,
      shippingAmountCents: snapshot.shipping.amountCents,
      status: "checkout_pending",
      totalAmountCents: snapshot.totalCents,
    },
    depth: 0,
    overrideAccess: true,
    req: request,
  });
  return {
    amountCents: snapshot.subtotalCents,
    shippingAmountCents: snapshot.shipping.amountCents,
    attemptId,
    createdAttempt: true,
    expiresAtEpochSeconds,
    intentId: intent.id,
    storedSessionId: null,
    portraitSnapshot: snapshot,
  };
};
