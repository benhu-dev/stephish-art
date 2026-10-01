import type { PayloadRequest } from "payload";

import {
  enforceStorefrontRateLimit,
  type StorefrontRateLimitAction,
} from "./storefrontRateLimit";
import type { CheckoutIntentCredential } from "./checkoutIntentCookie";

type RateLimitSelection = {
  action: StorefrontRateLimitAction;
  credential?: CheckoutIntentCredential;
};

type StorefrontHandler = (request: PayloadRequest) => Promise<Response>;

const unavailableResponse = () =>
  Response.json(
    { error: { code: "SERVICE_UNAVAILABLE" } },
    { headers: { "Cache-Control": "no-store" }, status: 503 },
  );

const deniedResponse = (retryAfterSeconds: number) =>
  Response.json(
    { error: { code: "RATE_LIMITED" } },
    {
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(retryAfterSeconds),
      },
      status: 429,
    },
  );

export const createRateLimitedStorefrontHandler = ({
  action,
  enforce = enforceStorefrontRateLimit,
  handler,
}: {
  action: (request: PayloadRequest) => RateLimitSelection;
  enforce?: typeof enforceStorefrontRateLimit;
  handler: StorefrontHandler;
}): StorefrontHandler => async (request) => {
  try {
    const selection = action(request);
    const decision = await enforce({ ...selection, request });
    if (!decision.allowed) return deniedResponse(decision.retryAfterSeconds);
  } catch {
    request.payload.logger.error({
      classification: "rate_limit_unavailable",
      msg: "Storefront rate limit unavailable.",
    });
    return unavailableResponse();
  }
  return handler(request);
};
