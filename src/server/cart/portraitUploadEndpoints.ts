import type { Endpoint, PayloadRequest } from "payload";

import { createBoundedStorageStream } from "../storage/boundedStorageStream";
import {
  clearCheckoutIntentCookie,
  parseCheckoutIntentCookie,
  type CheckoutIntentCredential,
} from "../storefront/checkoutIntentCookie";
import { createRateLimitedStorefrontHandler } from "../storefront/storefrontRateLimitEndpoint";
import {
  enforceStorefrontRateLimit,
  type StorefrontRateLimitAction,
} from "../storefront/storefrontRateLimit";
import {
  requireNoQueryString,
  requireSameOrigin,
} from "../storefront/storefrontRequestSecurity";
import {
  StorefrontApiError,
  unauthorizedIntentError,
} from "../storefront/storefrontApiError";
import { isPortraitPublicId } from "./portraitCartPolicy";
import { readPortraitCart } from "./portraitCartService";
import {
  deletePortraitReference,
  readPortraitReferencePreview,
  updatePortraitReference,
  uploadPortraitReference,
} from "./portraitUploadService";
import {
  parsePortraitUploadForm,
  parsePortraitUploadUpdate,
} from "./portraitUploadRequest";
import { PORTRAIT_UPLOAD_POLICY } from "./portraitUploadPolicy";

const noStoreHeaders = () => new Headers({ "Cache-Control": "no-store" });
const isProduction = () => process.env.NODE_ENV === "production";
const jsonResponse = (body: unknown, status: number, headers = noStoreHeaders()) =>
  Response.json(body, { headers, status });

const readCredential = (request: PayloadRequest): CheckoutIntentCredential => {
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
    request.payload.logger.error({ msg: "Portrait upload request failed." });
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

const readUploadId = (request: PayloadRequest) => {
  const value = request.routeParams?.uploadId;
  const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new StorefrontApiError(404, "UPLOAD_NOT_FOUND");
  }
  return parsed;
};

const requireNoBody = (request: PayloadRequest) => {
  const contentLength = request.headers.get("content-length");
  const parsed = contentLength === null ? 0 : Number(contentLength);
  if (
    request.headers.has("transfer-encoding") ||
    !Number.isSafeInteger(parsed) ||
    parsed !== 0
  ) {
    throw new StorefrontApiError(400, "UNEXPECTED_BODY");
  }
};

export const uploadPortraitReferenceHandler = async (request: PayloadRequest) => {
  try {
    requireSameOrigin(request);
    requireNoQueryString(request);
    const credential = readCredential(request);
    const portraitPublicId = readPortraitId(request);
    const { file, position, subjectIds } = await parsePortraitUploadForm(request);
    await uploadPortraitReference({
      credential,
      file,
      metadata: { position, subjectIds },
      portraitPublicId,
      request,
    });
    return jsonResponse(await readPortraitCart({ credential, request }), 201);
  } catch (error) {
    return errorResponse(request, error);
  }
};

export const updatePortraitReferenceHandler = async (request: PayloadRequest) => {
  try {
    requireSameOrigin(request);
    requireNoQueryString(request);
    const credential = readCredential(request);
    await updatePortraitReference({
      credential,
      metadata: await parsePortraitUploadUpdate(request),
      portraitPublicId: readPortraitId(request),
      request,
      uploadId: readUploadId(request),
    });
    return jsonResponse(await readPortraitCart({ credential, request }), 200);
  } catch (error) {
    return errorResponse(request, error);
  }
};

export const deletePortraitReferenceHandler = async (request: PayloadRequest) => {
  try {
    requireSameOrigin(request);
    requireNoQueryString(request);
    requireNoBody(request);
    const credential = readCredential(request);
    await deletePortraitReference({
      credential,
      portraitPublicId: readPortraitId(request),
      request,
      uploadId: readUploadId(request),
    });
    return jsonResponse(await readPortraitCart({ credential, request }), 200);
  } catch (error) {
    return errorResponse(request, error);
  }
};

export const previewPortraitReferenceHandler = async (request: PayloadRequest) => {
  try {
    requireNoQueryString(request);
    const preview = await readPortraitReferencePreview({
      credential: readCredential(request),
      portraitPublicId: readPortraitId(request),
      request,
      uploadId: readUploadId(request),
    });
    const headers = new Headers({
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": "inline",
      "Content-Type": preview.contentType,
      "Cross-Origin-Resource-Policy": "same-origin",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    if (preview.contentLength !== undefined) {
      headers.set("Content-Length", String(preview.contentLength));
    }
    return new Response(
      createBoundedStorageStream(
        preview.stream,
        preview.contentLength,
        PORTRAIT_UPLOAD_POLICY.perFileUploadLimitBytes,
      ),
      { headers, status: 200 },
    );
  } catch (error) {
    return errorResponse(request, error);
  }
};

const credentialAction = (action: StorefrontRateLimitAction) =>
  (request: PayloadRequest) => {
    const parsed = parseCheckoutIntentCookie(request.headers.get("cookie"));
    return {
      action,
      ...(parsed.kind === "valid" ? { credential: parsed.credential } : {}),
    };
  };

export const createPortraitUploadEndpoints = (
  enforce: typeof enforceStorefrontRateLimit = enforceStorefrontRateLimit,
): Endpoint[] => [
  {
    handler: createRateLimitedStorefrontHandler({
      action: credentialAction("photoUpload"),
      enforce,
      handler: uploadPortraitReferenceHandler,
    }),
    method: "post",
    path: "/storefront/checkout-intents/current/cart/portraits/:portraitId/uploads",
  },
  {
    handler: createRateLimitedStorefrontHandler({
      action: credentialAction("photoUpdate"),
      enforce,
      handler: updatePortraitReferenceHandler,
    }),
    method: "put",
    path: "/storefront/checkout-intents/current/cart/portraits/:portraitId/uploads/:uploadId",
  },
  {
    handler: createRateLimitedStorefrontHandler({
      action: credentialAction("photoRemove"),
      enforce,
      handler: deletePortraitReferenceHandler,
    }),
    method: "delete",
    path: "/storefront/checkout-intents/current/cart/portraits/:portraitId/uploads/:uploadId",
  },
  {
    handler: createRateLimitedStorefrontHandler({
      action: credentialAction("photoPreview"),
      enforce,
      handler: previewPortraitReferenceHandler,
    }),
    method: "get",
    path: "/storefront/checkout-intents/current/cart/portraits/:portraitId/uploads/:uploadId/preview",
  },
];

export const portraitUploadEndpoints = createPortraitUploadEndpoints();
