import type { PayloadRequest } from "payload";

import { issueCheckoutIntentCredential } from "../checkout-intents/checkoutIntentCredentials";
import { buildSafeCheckoutIntentResponse } from "./checkoutIntentApiContract";
import { authorizeCheckoutIntent } from "./checkoutIntentAccess";
import type { CheckoutIntentCredential } from "./checkoutIntentCookie";
import { StorefrontApiError } from "./storefrontApiError";

export const readMinimumAmountCents = async (request: PayloadRequest) => {
  const settings = await request.payload.findGlobal({
    overrideAccess: true,
    req: request,
    slug: "checkout-settings",
  });
  const minimumAmountCents = Number(settings.minimumAmountCents);
  if (!Number.isSafeInteger(minimumAmountCents) || minimumAmountCents <= 0) {
    throw new Error("INVALID_CHECKOUT_SETTINGS");
  }
  return minimumAmountCents;
};

export const readIntentUploads = async (
  request: PayloadRequest,
  intentId: number,
) => {
  const result = await request.payload.find({
    collection: "order-uploads",
    depth: 0,
    limit: 3,
    overrideAccess: true,
    pagination: false,
    req: request,
    sort: "position",
    where: { checkoutIntent: { equals: intentId } },
  });
  return result.docs as unknown as Array<Record<string, unknown> & {
    filesize?: number | null;
    id: number | string;
    mimeType?: string | null;
    position: number;
  }>;
};

const safeState = async (
  request: PayloadRequest,
  intent: {
    amountCents: number;
    expiresAt: string;
    id: number;
    shippingAmountCents?: number | null;
    status: string;
    totalAmountCents?: number | null;
  },
  minimumAmountCents: number,
) =>
  buildSafeCheckoutIntentResponse({
    intent,
    minimumAmountCents,
    uploads: await readIntentUploads(request, intent.id),
  });

export const createCheckoutIntent = async (
  request: PayloadRequest,
  amountCents: number,
) => {
  const issued = issueCheckoutIntentCredential();
  const document = await request.payload.create({
    collection: "checkout-intents",
    data: {
      amountCents,
      status: "draft",
      ...issued.createData,
    },
    depth: 0,
    overrideAccess: true,
    req: request,
  });
  const intent = {
    amountCents: Number(document.amountCents),
    expiresAt: String(document.expiresAt),
    id: Number(document.id),
    status: String(document.status),
  };

  return {
    credential: { intentId: intent.id, rawToken: issued.rawToken },
    intent,
  };
};

export const createOrResumeCheckoutIntent = async ({
  amountCents,
  credential,
  minimumAmountCents,
  request,
}: {
  amountCents: number;
  credential?: CheckoutIntentCredential;
  minimumAmountCents: number;
  request: PayloadRequest;
}) => {
  if (credential) {
    const existing = await authorizeCheckoutIntent(request, credential);
    if (existing.status === "draft") {
      const updated = await request.payload.update({
        collection: "checkout-intents",
        data: { amountCents },
        depth: 0,
        id: existing.id,
        overrideAccess: true,
        req: request,
      });
      const intent = {
        amountCents: Number(updated.amountCents),
        expiresAt: String(updated.expiresAt),
        id: Number(updated.id),
        status: String(updated.status),
      };
      return {
        credential,
        created: false,
        response: await safeState(request, intent, minimumAmountCents),
      };
    }
    if (
      existing.status === "checkout_pending" ||
      existing.status === "checkout_created"
    ) {
      throw new StorefrontApiError(409, "CHECKOUT_ALREADY_STARTED");
    }
  }

  const created = await createCheckoutIntent(request, amountCents);
  return {
    credential: created.credential,
    created: true,
    response: await safeState(request, created.intent, minimumAmountCents),
  };
};

export const readCurrentCheckoutIntent = async (
  request: PayloadRequest,
  credential: CheckoutIntentCredential,
) => {
  const [intent, minimumAmountCents] = await Promise.all([
    authorizeCheckoutIntent(request, credential),
    readMinimumAmountCents(request),
  ]);
  return safeState(request, intent, minimumAmountCents);
};
