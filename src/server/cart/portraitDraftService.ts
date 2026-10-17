import type { PayloadRequest } from "payload";
import type { CheckoutIntentCredential } from "../storefront/checkoutIntentCookie";
import { authorizeCheckoutIntent } from "../storefront/checkoutIntentAccess";
import { createCheckoutIntent } from "../storefront/checkoutIntentService";
import { StorefrontApiError } from "../storefront/storefrontApiError";

// This fixed-price product must not inherit the legacy donation minimum.
export const startPortraitDraft = async (
  request: PayloadRequest,
  credential?: CheckoutIntentCredential,
) => {
  if (credential) {
    await authorizeCheckoutIntent(request, credential);
    throw new StorefrontApiError(409, "CHECKOUT_ALREADY_EXISTS");
  }
  return createCheckoutIntent(request, 2000);
};
