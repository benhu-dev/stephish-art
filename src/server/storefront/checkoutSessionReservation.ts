import { sql } from "@payloadcms/db-postgres";
import { randomUUID } from "node:crypto";
import type { PayloadRequest } from "payload";

import { CHECKOUT_INTENT_POLICY } from "../checkout-intents/checkoutIntentPolicy";
import type { CheckoutIntentCredential } from "./checkoutIntentCookie";
import { StorefrontApiError } from "./storefrontApiError";
import {
  beginStorefrontTransaction,
  commitStorefrontTransaction,
  lockAndAuthorizeCheckoutIntent,
  rollbackStorefrontTransaction,
  type LockedCheckoutIntent,
  type StorefrontTransaction,
} from "./storefrontTransaction";

const MINIMUM_SESSION_LIFETIME_MS = 30 * 60 * 1000;
const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export type CheckoutSessionReservation = {
  amountCents: number;
  attemptId: string;
  createdAttempt: boolean;
  expiresAtEpochSeconds: number;
  intentId: number;
  shippingAmountCents: number;
  storedSessionId: string | null;
};

const validateSnapshots = (intent: LockedCheckoutIntent) => {
  if (
    !intent.checkoutAttemptId ||
    !Number.isSafeInteger(intent.shippingAmountCents) ||
    intent.shippingAmountCents! < 0 ||
    !Number.isSafeInteger(intent.totalAmountCents) ||
    intent.totalAmountCents !== intent.amountCents + intent.shippingAmountCents!
  ) {
    throw new StorefrontApiError(500, "INVALID_CHECKOUT_RESERVATION");
  }
};

const readAndValidateUploads = async (
  transaction: StorefrontTransaction,
  intentId: number,
) => {
  const result = await transaction.database.execute(sql`
    SELECT position, filename, mime_type, filesize
    FROM public.order_uploads
    WHERE checkout_intent_id = ${intentId}
    ORDER BY position
    FOR SHARE
  `);
  if (
    result.rows.length < 1 ||
    result.rows.length > CHECKOUT_INTENT_POLICY.maximumUploads
  ) {
    throw new StorefrontApiError(422, "VALID_UPLOAD_REQUIRED");
  }

  const positions = new Set<number>();
  for (const row of result.rows) {
    const position = Number(row.position);
    const filesize = Number(row.filesize);
    if (
      !Number.isSafeInteger(position) ||
      position < 1 ||
      position > CHECKOUT_INTENT_POLICY.maximumUploads ||
      positions.has(position) ||
      typeof row.filename !== "string" ||
      row.filename.length === 0 ||
      typeof row.mime_type !== "string" ||
      !allowedMimeTypes.has(row.mime_type) ||
      !Number.isSafeInteger(filesize) ||
      filesize <= 0 ||
      filesize > CHECKOUT_INTENT_POLICY.perFileUploadLimitBytes
    ) {
      throw new StorefrontApiError(422, "INVALID_UPLOAD");
    }
    positions.add(position);
  }
};

const readSettings = async (request: PayloadRequest) => {
  const settings = await request.payload.findGlobal({
    overrideAccess: true,
    req: request,
    slug: "checkout-settings",
  });
  const minimumAmountCents = Number(settings.minimumAmountCents);
  const shippingAmountCents = Number(settings.shippingFeeCents);
  if (
    !Number.isSafeInteger(minimumAmountCents) ||
    minimumAmountCents <= 0 ||
    !Number.isSafeInteger(shippingAmountCents) ||
    shippingAmountCents < 0 ||
    shippingAmountCents > 10_000
  ) {
    throw new StorefrontApiError(500, "INVALID_CHECKOUT_SETTINGS");
  }
  return { minimumAmountCents, shippingAmountCents };
};

const updateIntent = async (
  request: PayloadRequest,
  id: number,
  data: Record<string, unknown>,
) => {
  await request.payload.update({
    collection: "checkout-intents",
    data,
    depth: 0,
    id,
    overrideAccess: true,
    req: request,
  });
};

export const reserveCheckoutAttempt = async (
  request: PayloadRequest,
  credential: CheckoutIntentCredential,
  now: Date,
): Promise<CheckoutSessionReservation> => {
  let transaction: StorefrontTransaction | undefined;
  try {
    transaction = await beginStorefrontTransaction(request);
    const intent = await lockAndAuthorizeCheckoutIntent(transaction, credential);
    const expiresAtMilliseconds = new Date(intent.expiresAt).getTime();
    if (expiresAtMilliseconds - now.getTime() < MINIMUM_SESSION_LIFETIME_MS) {
      await updateIntent(request, intent.id, { status: "expired" });
      await commitStorefrontTransaction(transaction);
      transaction = undefined;
      throw new StorefrontApiError(410, "INTENT_EXPIRED", {
        clearCookie: true,
      });
    }

    await readAndValidateUploads(transaction, intent.id);
    const expiresAtEpochSeconds = Math.floor(expiresAtMilliseconds / 1000);
    if (intent.status === "draft") {
      const settings = await readSettings(request);
      if (
        !Number.isSafeInteger(intent.amountCents) ||
        intent.amountCents < settings.minimumAmountCents
      ) {
        throw new StorefrontApiError(422, "AMOUNT_BELOW_MINIMUM");
      }
      const totalAmountCents = intent.amountCents + settings.shippingAmountCents;
      if (!Number.isSafeInteger(totalAmountCents)) {
        throw new StorefrontApiError(422, "INVALID_AMOUNT");
      }
      const attemptId = randomUUID();
      await updateIntent(request, intent.id, {
        checkoutAttemptId: attemptId,
        checkoutStartedAt: now.toISOString(),
        shippingAmountCents: settings.shippingAmountCents,
        status: "checkout_pending",
        totalAmountCents,
      });
      await commitStorefrontTransaction(transaction);
      transaction = undefined;
      return {
        amountCents: intent.amountCents,
        attemptId,
        createdAttempt: true,
        expiresAtEpochSeconds,
        intentId: intent.id,
        shippingAmountCents: settings.shippingAmountCents,
        storedSessionId: null,
      };
    }

    if (
      intent.status !== "checkout_pending" &&
      intent.status !== "checkout_created"
    ) {
      throw new StorefrontApiError(409, "CHECKOUT_PROCESSING");
    }
    validateSnapshots(intent);
    if (
      intent.status === "checkout_created" &&
      (!intent.stripeCheckoutSessionId ||
        !intent.stripeCheckoutSessionExpiresAt)
    ) {
      throw new StorefrontApiError(500, "INVALID_CHECKOUT_RESERVATION");
    }

    await commitStorefrontTransaction(transaction);
    transaction = undefined;
    return {
      amountCents: intent.amountCents,
      attemptId: intent.checkoutAttemptId!,
      createdAttempt: false,
      expiresAtEpochSeconds,
      intentId: intent.id,
      shippingAmountCents: intent.shippingAmountCents!,
      storedSessionId: intent.stripeCheckoutSessionId,
    };
  } catch (error) {
    await rollbackStorefrontTransaction(transaction);
    throw error;
  }
};
