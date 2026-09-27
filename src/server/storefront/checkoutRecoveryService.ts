import type { PayloadRequest } from "payload";

import {
  createStripeCheckoutGateway,
  type StripeCheckoutGateway,
} from "../stripe/stripeCheckoutGateway";
import { authorizeCheckoutIntent } from "./checkoutIntentAccess";
import type { CheckoutIntentCredential } from "./checkoutIntentCookie";
import { readAuthorizedCheckoutIntentState } from "./checkoutIntentService";
import { StorefrontApiError } from "./storefrontApiError";

type AuthorizeIntent = typeof authorizeCheckoutIntent;
type ReadSafeState = typeof readAuthorizedCheckoutIntentState;

export type CheckoutRecoveryDependencies = {
  authorizeIntent?: AuthorizeIntent;
  gateway?: Pick<StripeCheckoutGateway, "retrieveSession">;
  readSafeState?: ReadSafeState;
};

export const readCheckoutRecovery = async ({
  credential,
  dependencies = {},
  request,
}: {
  credential: CheckoutIntentCredential;
  dependencies?: CheckoutRecoveryDependencies;
  request: PayloadRequest;
}) => {
  const authorizeIntent = dependencies.authorizeIntent ?? authorizeCheckoutIntent;
  const readSafeState =
    dependencies.readSafeState ?? readAuthorizedCheckoutIntentState;
  const intent = await authorizeIntent(request, credential);

  if (intent.status === "draft") {
    return readSafeState(request, intent);
  }
  if (
    intent.status !== "checkout_created" ||
    !intent.stripeCheckoutSessionId
  ) {
    return null;
  }

  const gateway = dependencies.gateway ?? createStripeCheckoutGateway();
  try {
    const session = await gateway.retrieveSession(
      intent.stripeCheckoutSessionId,
    );
    if (session.status !== "open" || !session.url) return null;
  } catch {
    throw new StorefrontApiError(503, "CHECKOUT_UNAVAILABLE");
  }

  return readSafeState(request, intent);
};
