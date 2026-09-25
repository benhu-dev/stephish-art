import type { PayloadRequest } from "payload";

import {
  createStripeCheckoutGateway,
  type StripeCheckoutGateway,
} from "../stripe/stripeCheckoutGateway";
import type { CheckoutIntentCredential } from "./checkoutIntentCookie";
import { authorizeCheckoutIntent } from "./checkoutIntentAccess";
import { resolveStripeCheckoutSession } from "./checkoutSessionService";
import { StorefrontApiError } from "./storefrontApiError";
import {
  beginStorefrontTransaction,
  commitStorefrontTransaction,
  lockAndAuthorizeCheckoutIntent,
  rollbackStorefrontTransaction,
  type StorefrontTransaction,
} from "./storefrontTransaction";

type FinalizeOptions = {
  credential: CheckoutIntentCredential;
  request: PayloadRequest;
  sessionId: string;
  testProbe?: CheckoutAbandonTestProbe;
};

export type CheckoutAbandonTestProbe = {
  afterFinalizationPersistence?: () => Promise<void> | void;
};

const finalizeExpiredIntent = async ({
  credential,
  request,
  sessionId,
  testProbe = {},
}: FinalizeOptions) => {
  let transaction: StorefrontTransaction | undefined;
  try {
    transaction = await beginStorefrontTransaction(request);
    const intent = await lockAndAuthorizeCheckoutIntent(transaction, credential, {
      allowExpired: true,
    });
    if (intent.status === "completed") {
      throw new StorefrontApiError(409, "CHECKOUT_PROCESSING");
    }
    if (
      (intent.status !== "checkout_created" && intent.status !== "expired") ||
      intent.stripeCheckoutSessionId !== sessionId
    ) {
      throw new StorefrontApiError(409, "CHECKOUT_STATE_CONFLICT");
    }
    if (intent.status === "checkout_created") {
      await request.payload.update({
        collection: "checkout-intents",
        data: { status: "expired" },
        depth: 0,
        id: intent.id,
        overrideAccess: true,
        req: request,
      });
      await testProbe.afterFinalizationPersistence?.();
    }
    await commitStorefrontTransaction(transaction);
    transaction = undefined;
  } catch (error) {
    await rollbackStorefrontTransaction(transaction);
    if (error instanceof StorefrontApiError) throw error;
    throw new StorefrontApiError(500, "CHECKOUT_ABANDON_FINALIZATION_FAILED");
  }
};

type ResolveSession = typeof resolveStripeCheckoutSession;
type FinalizeExpiredIntent = typeof finalizeExpiredIntent;
type AuthorizeIntent = typeof authorizeCheckoutIntent;

export type CheckoutAbandonDependencies = {
  authorizeIntent?: AuthorizeIntent;
  finalizeExpiredIntent?: FinalizeExpiredIntent;
  gateway?: StripeCheckoutGateway;
  resolveSession?: ResolveSession;
  testProbe?: CheckoutAbandonTestProbe;
};

export const abandonStripeCheckoutSession = async ({
  credential,
  dependencies = {},
  request,
}: {
  credential: CheckoutIntentCredential;
  dependencies?: CheckoutAbandonDependencies;
  request: PayloadRequest;
}) => {
  const gateway = dependencies.gateway ?? createStripeCheckoutGateway();
  const authorizeIntent = dependencies.authorizeIntent ?? authorizeCheckoutIntent;
  const resolveSession = dependencies.resolveSession ?? resolveStripeCheckoutSession;
  const finalize = dependencies.finalizeExpiredIntent ?? finalizeExpiredIntent;
  const intent = await authorizeIntent(request, credential);
  if (intent.status === "expired") {
    throw new StorefrontApiError(410, "INTENT_EXPIRED", { clearCookie: true });
  }
  if (intent.status !== "checkout_pending" && intent.status !== "checkout_created") {
    throw new StorefrontApiError(409, "CHECKOUT_STATE_CONFLICT");
  }
  const { session } = await resolveSession({ credential, gateway, request });

  if (session.status === "complete") {
    throw new StorefrontApiError(409, "CHECKOUT_PROCESSING");
  }

  let inactiveSession = session;
  if (session.status === "open") {
    try {
      inactiveSession = await gateway.expireSession(session.id);
    } catch {
      throw new StorefrontApiError(503, "CHECKOUT_ABANDON_UNAVAILABLE");
    }
  }
  if (inactiveSession.status === "complete") {
    throw new StorefrontApiError(409, "CHECKOUT_PROCESSING");
  }
  if (inactiveSession.status !== "expired" || inactiveSession.id !== session.id) {
    throw new StorefrontApiError(503, "CHECKOUT_ABANDON_UNAVAILABLE");
  }

  await finalize({
    credential,
    request,
    sessionId: session.id,
    testProbe: dependencies.testProbe,
  });
};
