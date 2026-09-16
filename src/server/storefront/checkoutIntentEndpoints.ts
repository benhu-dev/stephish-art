import type { Endpoint, PayloadRequest } from "payload";

import {
  clearCheckoutIntentCookie,
  parseCheckoutIntentCookie,
  serializeCheckoutIntentCookie,
  type CheckoutIntentCredential,
} from "./checkoutIntentCookie";
import {
  createOrResumeCheckoutIntent,
  readCurrentCheckoutIntent,
  readMinimumAmountCents,
} from "./checkoutIntentService";
import {
  deleteCheckoutIntentFile,
  uploadCheckoutIntentFile,
} from "./orderUploadService";
import {
  parseAmountRequest,
  parseStorefrontUpload,
  readStorefrontJson,
  requireSameOrigin,
} from "./storefrontRequestSecurity";
import {
  StorefrontApiError,
  unauthorizedIntentError,
} from "./storefrontApiError";

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
  const knownError =
    error instanceof StorefrontApiError
      ? error
      : new StorefrontApiError(500, "INTERNAL_ERROR");
  if (!(error instanceof StorefrontApiError)) {
    request.payload.logger.error({ msg: "Storefront request failed." });
  }
  const headers = noStoreHeaders();
  if (knownError.clearCookie) {
    headers.set("Set-Cookie", clearCheckoutIntentCookie(isProduction()));
  }
  return jsonResponse({ error: { code: knownError.code } }, knownError.status, headers);
};

const createOrResumeHandler = async (request: PayloadRequest) => {
  try {
    requireSameOrigin(request);
    const body = await readStorefrontJson(request);
    const minimumAmountCents = await readMinimumAmountCents(request);
    const { amountCents } = parseAmountRequest(body, minimumAmountCents);
    const parsedCookie = parseCheckoutIntentCookie(request.headers.get("cookie"));
    if (parsedCookie.kind === "malformed") throw unauthorizedIntentError(true);

    const result = await createOrResumeCheckoutIntent({
      amountCents,
      credential:
        parsedCookie.kind === "valid" ? parsedCookie.credential : undefined,
      minimumAmountCents,
      request,
    });
    const headers = noStoreHeaders();
    headers.set(
      "Set-Cookie",
      serializeCheckoutIntentCookie(
        result.credential,
        new Date(result.response.expiresAt),
        isProduction(),
      ),
    );
    return jsonResponse(result.response, result.created ? 201 : 200, headers);
  } catch (error) {
    return errorResponse(request, error);
  }
};

const currentHandler = async (request: PayloadRequest) => {
  try {
    const credential = readRequiredCredential(request);
    return jsonResponse(
      await readCurrentCheckoutIntent(request, credential),
      200,
    );
  } catch (error) {
    return errorResponse(request, error);
  }
};

const uploadHandler = async (request: PayloadRequest) => {
  try {
    requireSameOrigin(request);
    const credential = readRequiredCredential(request);
    const { file, position } = await parseStorefrontUpload(request);
    return jsonResponse(
      await uploadCheckoutIntentFile({ credential, file, position, request }),
      201,
    );
  } catch (error) {
    return errorResponse(request, error);
  }
};

const deleteUploadHandler = async (request: PayloadRequest) => {
  try {
    requireSameOrigin(request);
    const contentLength = request.headers.get("content-length");
    if (
      request.headers.has("transfer-encoding") ||
      (contentLength !== null && Number(contentLength) > 0)
    ) {
      throw new StorefrontApiError(400, "UNEXPECTED_BODY");
    }
    const credential = readRequiredCredential(request);
    const uploadIdValue = request.routeParams?.uploadId;
    const uploadId =
      typeof uploadIdValue === "string" && /^\d+$/.test(uploadIdValue)
        ? Number(uploadIdValue)
        : Number.NaN;
    if (!Number.isSafeInteger(uploadId) || uploadId <= 0) {
      throw new StorefrontApiError(404, "UPLOAD_NOT_FOUND");
    }
    await deleteCheckoutIntentFile({ credential, request, uploadId });
    return new Response(null, { headers: noStoreHeaders(), status: 204 });
  } catch (error) {
    return errorResponse(request, error);
  }
};

export const storefrontCheckoutIntentEndpoints: Endpoint[] = [
  {
    handler: createOrResumeHandler,
    method: "post",
    path: "/storefront/checkout-intents",
  },
  {
    handler: currentHandler,
    method: "get",
    path: "/storefront/checkout-intents/current",
  },
  {
    handler: uploadHandler,
    method: "post",
    path: "/storefront/checkout-intents/current/uploads",
  },
  {
    handler: deleteUploadHandler,
    method: "delete",
    path: "/storefront/checkout-intents/current/uploads/:uploadId",
  },
];
