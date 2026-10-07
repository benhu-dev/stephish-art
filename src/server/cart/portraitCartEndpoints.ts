import type { Endpoint, PayloadRequest } from "payload";

import {
  clearCheckoutIntentCookie,
  parseCheckoutIntentCookie,
  type CheckoutIntentCredential,
} from "../storefront/checkoutIntentCookie";
import { createRateLimitedStorefrontHandler } from "../storefront/storefrontRateLimitEndpoint";
import { enforceStorefrontRateLimit } from "../storefront/storefrontRateLimit";
import {
  readStorefrontJson,
  requireNoQueryString,
  requireSameOrigin,
} from "../storefront/storefrontRequestSecurity";
import {
  StorefrontApiError,
  unauthorizedIntentError,
} from "../storefront/storefrontApiError";
import {
  isPortraitPublicId,
  parsePortraitCreateRequest,
  parsePortraitReorderRequest,
  parsePortraitReplaceRequest,
} from "./portraitCartPolicy";
import {
  addPortraitToCart,
  readPortraitCart,
  removeCartPortrait,
  reorderCartPortraits,
  replaceCartPortrait,
} from "./portraitCartService";

const noStoreHeaders = () => new Headers({ "Cache-Control": "no-store" });
const isProduction = () => process.env.NODE_ENV === "production";
const jsonResponse = (
  body: unknown,
  status: number,
  headers = noStoreHeaders(),
) => Response.json(body, { headers, status });

const readRequiredCredential = (
  request: PayloadRequest,
): CheckoutIntentCredential => {
  const parsed = parseCheckoutIntentCookie(request.headers.get("cookie"));
  if (parsed.kind !== "valid") {
    throw unauthorizedIntentError(parsed.kind === "malformed");
  }
  return parsed.credential;
};

const errorResponse = (request: PayloadRequest, error: unknown) => {
  const known =
    error instanceof StorefrontApiError
      ? error
      : new StorefrontApiError(500, "INTERNAL_ERROR");
  if (!(error instanceof StorefrontApiError)) {
    request.payload.logger.error({ msg: "Portrait cart request failed." });
  }
  const headers = noStoreHeaders();
  if (known.clearCookie) {
    headers.set("Set-Cookie", clearCheckoutIntentCookie(isProduction()));
  }
  return jsonResponse({ error: { code: known.code } }, known.status, headers);
};

const readPortraitId = (request: PayloadRequest) => {
  const value = request.routeParams?.portraitId;
  if (!isPortraitPublicId(value)) {
    throw new StorefrontApiError(404, "PORTRAIT_NOT_FOUND");
  }
  return value;
};

const requireNoRequestBody = (request: PayloadRequest) => {
  const contentLength = request.headers.get("content-length");
  const parsedLength = contentLength === null ? 0 : Number(contentLength);
  if (
    request.headers.has("transfer-encoding") ||
    !Number.isSafeInteger(parsedLength) ||
    parsedLength !== 0
  ) {
    throw new StorefrontApiError(400, "UNEXPECTED_BODY");
  }
};

const readCartHandler = async (request: PayloadRequest) => {
  try {
    requireNoQueryString(request);
    const suppliedOrigin = request.headers.get("origin");
    if (suppliedOrigin) requireSameOrigin(request);
    return jsonResponse(
      await readPortraitCart({
        credential: readRequiredCredential(request),
        request,
      }),
      200,
    );
  } catch (error) {
    return errorResponse(request, error);
  }
};

const addPortraitHandler = async (request: PayloadRequest) => {
  try {
    requireSameOrigin(request);
    requireNoQueryString(request);
    const input = parsePortraitCreateRequest(
      await readStorefrontJson(request, 16 * 1024),
    );
    return jsonResponse(
      await addPortraitToCart({
        credential: readRequiredCredential(request),
        input,
        request,
      }),
      201,
    );
  } catch (error) {
    return errorResponse(request, error);
  }
};

const replacePortraitHandler = async (request: PayloadRequest) => {
  try {
    requireSameOrigin(request);
    requireNoQueryString(request);
    const portraitId = readPortraitId(request);
    const input = parsePortraitReplaceRequest(
      await readStorefrontJson(request, 16 * 1024),
    );
    return jsonResponse(
      await replaceCartPortrait({
        credential: readRequiredCredential(request),
        input,
        portraitId,
        request,
      }),
      200,
    );
  } catch (error) {
    return errorResponse(request, error);
  }
};

const deletePortraitHandler = async (request: PayloadRequest) => {
  try {
    requireSameOrigin(request);
    requireNoQueryString(request);
    requireNoRequestBody(request);
    return jsonResponse(
      await removeCartPortrait({
        credential: readRequiredCredential(request),
        portraitId: readPortraitId(request),
        request,
      }),
      200,
    );
  } catch (error) {
    return errorResponse(request, error);
  }
};

const reorderPortraitsHandler = async (request: PayloadRequest) => {
  try {
    requireSameOrigin(request);
    requireNoQueryString(request);
    const { portraitIds } = parsePortraitReorderRequest(
      await readStorefrontJson(request, 4 * 1024),
    );
    return jsonResponse(
      await reorderCartPortraits({
        credential: readRequiredCredential(request),
        portraitIds,
        request,
      }),
      200,
    );
  } catch (error) {
    return errorResponse(request, error);
  }
};

const credentialAction = (action: "cartMutate" | "cartRead") =>
  (request: PayloadRequest) => {
    const parsed = parseCheckoutIntentCookie(request.headers.get("cookie"));
    return {
      action,
      ...(parsed.kind === "valid" ? { credential: parsed.credential } : {}),
    };
  };

export const createPortraitCartEndpoints = (
  enforce: typeof enforceStorefrontRateLimit = enforceStorefrontRateLimit,
): Endpoint[] => [
  {
    handler: createRateLimitedStorefrontHandler({
      action: credentialAction("cartRead"),
      enforce,
      handler: readCartHandler,
    }),
    method: "get",
    path: "/storefront/checkout-intents/current/cart",
  },
  {
    handler: createRateLimitedStorefrontHandler({
      action: credentialAction("cartMutate"),
      enforce,
      handler: addPortraitHandler,
    }),
    method: "post",
    path: "/storefront/checkout-intents/current/cart/portraits",
  },
  {
    handler: createRateLimitedStorefrontHandler({
      action: credentialAction("cartMutate"),
      enforce,
      handler: replacePortraitHandler,
    }),
    method: "put",
    path: "/storefront/checkout-intents/current/cart/portraits/:portraitId",
  },
  {
    handler: createRateLimitedStorefrontHandler({
      action: credentialAction("cartMutate"),
      enforce,
      handler: deletePortraitHandler,
    }),
    method: "delete",
    path: "/storefront/checkout-intents/current/cart/portraits/:portraitId",
  },
  {
    handler: createRateLimitedStorefrontHandler({
      action: credentialAction("cartMutate"),
      enforce,
      handler: reorderPortraitsHandler,
    }),
    method: "put",
    path: "/storefront/checkout-intents/current/cart/order",
  },
];

export const portraitCartEndpoints = createPortraitCartEndpoints();
