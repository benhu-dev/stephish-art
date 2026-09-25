import type { PayloadRequest } from "payload";

import {
  createStripeCheckoutGateway,
  type SafeStripeCheckoutSession,
  type StripeCheckoutGateway,
} from "../stripe/stripeCheckoutGateway";
import { readStripeCheckoutEnvironment } from "../stripe/stripeEnvironment";
import type { CheckoutIntentCredential } from "./checkoutIntentCookie";
import {
  reserveCheckoutAttempt,
  type CheckoutSessionReservation,
} from "./checkoutSessionReservation";
import { StorefrontApiError } from "./storefrontApiError";
import {
  beginStorefrontTransaction,
  commitStorefrontTransaction,
  lockAndAuthorizeCheckoutIntent,
  rollbackStorefrontTransaction,
  type StorefrontTransaction,
} from "./storefrontTransaction";

export type CheckoutSessionTestProbe = {
  afterFinalizationPersistence?: () => Promise<void> | void;
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

const finalizeCheckoutAttempt = async (
  request: PayloadRequest,
  credential: CheckoutIntentCredential,
  reservation: CheckoutSessionReservation,
  session: SafeStripeCheckoutSession,
  testProbe: CheckoutSessionTestProbe,
) => {
  if (session.expiresAtEpochSeconds > reservation.expiresAtEpochSeconds) {
    throw new StorefrontApiError(502, "INVALID_STRIPE_SESSION_EXPIRY");
  }

  let transaction: StorefrontTransaction | undefined;
  try {
    transaction = await beginStorefrontTransaction(request);
    const intent = await lockAndAuthorizeCheckoutIntent(transaction, credential);
    if (intent.checkoutAttemptId !== reservation.attemptId) {
      throw new StorefrontApiError(409, "CHECKOUT_ATTEMPT_CONFLICT");
    }
    if (intent.status === "checkout_created") {
      if (intent.stripeCheckoutSessionId !== session.id) {
        throw new StorefrontApiError(409, "CHECKOUT_ATTEMPT_CONFLICT");
      }
    } else if (intent.status === "checkout_pending") {
      await updateIntent(request, intent.id, {
        status: "checkout_created",
        stripeCheckoutSessionExpiresAt: session.expiresAt,
        stripeCheckoutSessionId: session.id,
      });
      await testProbe.afterFinalizationPersistence?.();
    } else {
      throw new StorefrontApiError(409, "CHECKOUT_PROCESSING");
    }
    await commitStorefrontTransaction(transaction);
    transaction = undefined;
  } catch (error) {
    await rollbackStorefrontTransaction(transaction);
    if (error instanceof StorefrontApiError) throw error;
    throw new StorefrontApiError(500, "CHECKOUT_FINALIZATION_FAILED");
  }
};

const markExpiredSession = async (
  request: PayloadRequest,
  credential: CheckoutIntentCredential,
  sessionId: string,
) => {
  let transaction: StorefrontTransaction | undefined;
  try {
    transaction = await beginStorefrontTransaction(request);
    const intent = await lockAndAuthorizeCheckoutIntent(transaction, credential);
    if (
      intent.status === "checkout_created" &&
      intent.stripeCheckoutSessionId === sessionId
    ) {
      await updateIntent(request, intent.id, { status: "expired" });
    }
    await commitStorefrontTransaction(transaction);
    transaction = undefined;
  } catch (error) {
    await rollbackStorefrontTransaction(transaction);
    throw error;
  }
};

export const resolveStripeCheckoutSession = async ({
  credential,
  gateway = createStripeCheckoutGateway(),
  now = new Date(),
  request,
  testProbe = {},
}: {
  credential: CheckoutIntentCredential;
  gateway?: StripeCheckoutGateway;
  now?: Date;
  request: PayloadRequest;
  testProbe?: CheckoutSessionTestProbe;
}) => {
  const environment = readStripeCheckoutEnvironment();
  const reservation = await reserveCheckoutAttempt(
    request,
    credential,
    now,
  );

  let session: SafeStripeCheckoutSession;
  try {
    session = reservation.storedSessionId
      ? await gateway.retrieveSession(reservation.storedSessionId)
      : await gateway.createSession({
          amountCents: reservation.amountCents,
          attemptId: reservation.attemptId,
          baseURL: environment.baseURL,
          expiresAtEpochSeconds: reservation.expiresAtEpochSeconds,
          intentId: reservation.intentId,
          shippingAmountCents: reservation.shippingAmountCents,
        });
  } catch {
    throw new StorefrontApiError(503, "CHECKOUT_UNAVAILABLE");
  }

  await finalizeCheckoutAttempt(
    request,
    credential,
    reservation,
    session,
    testProbe,
  );
  return { created: reservation.createdAttempt, session };
};

export const createOrResumeStripeCheckoutSession = async (options: {
  credential: CheckoutIntentCredential;
  gateway?: StripeCheckoutGateway;
  now?: Date;
  request: PayloadRequest;
  testProbe?: CheckoutSessionTestProbe;
}) => {
  const { created, session } = await resolveStripeCheckoutSession(options);
  if (session.status === "complete") {
    throw new StorefrontApiError(409, "CHECKOUT_PROCESSING");
  }
  if (session.status === "expired") {
    await markExpiredSession(options.request, options.credential, session.id);
    throw new StorefrontApiError(410, "CHECKOUT_EXPIRED", {
      clearCookie: true,
    });
  }
  if (!session.url) {
    throw new StorefrontApiError(502, "INVALID_STRIPE_SESSION");
  }

  return {
    created,
    response: {
      checkoutUrl: session.url,
      expiresAt: session.expiresAt,
    },
  };
};
