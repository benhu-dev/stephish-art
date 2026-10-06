import type { Endpoint, PayloadRequest } from "payload";

import { createBoundedStorageStream } from "../storage/boundedStorageStream";
import { requireNoQueryString } from "../storefront/storefrontRequestSecurity";
import {
  PostcardTemplateCatalogError,
  readAvailablePostcardTemplates,
  readAvailableTemplateMedia,
} from "./postcardTemplateService";
import { TEMPLATE_MEDIA_MAX_FILE_SIZE_BYTES } from "./templateMediaPolicy";

const catalogHeaders = () =>
  new Headers({
    "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
  });

const errorHeaders = () =>
  new Headers({
    "Cache-Control": "no-store",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
  });

const requireCatalogRequest = (request: PayloadRequest) => {
  try {
    requireNoQueryString(request);
  } catch {
    throw new PostcardTemplateCatalogError(400, "INVALID_CATALOG_REQUEST");
  }
};

const errorResponse = (request: PayloadRequest, error: unknown) => {
  const known =
    error instanceof PostcardTemplateCatalogError
      ? error
      : new PostcardTemplateCatalogError(500, "CATALOG_UNAVAILABLE");
  if (!(error instanceof PostcardTemplateCatalogError)) {
    request.payload.logger.error({ msg: "Postcard template catalog request failed." });
  }
  return Response.json(
    { error: { code: known.code } },
    { headers: errorHeaders(), status: known.status },
  );
};

export const createPostcardTemplateCatalogHandler = (
  readCatalog: typeof readAvailablePostcardTemplates = readAvailablePostcardTemplates,
) => async (request: PayloadRequest) => {
  try {
    requireCatalogRequest(request);
    return Response.json(await readCatalog(request), {
      headers: catalogHeaders(),
      status: 200,
    });
  } catch (error) {
    return errorResponse(request, error);
  }
};

export const postcardTemplateCatalogHandler =
  createPostcardTemplateCatalogHandler();

export const createTemplateMediaHandler = (
  readMedia: typeof readAvailableTemplateMedia = readAvailableTemplateMedia,
) => async (request: PayloadRequest) => {
  try {
    requireCatalogRequest(request);
    const rawId = request.routeParams?.mediaId;
    const mediaId =
      typeof rawId === "string" && /^[1-9]\d*$/.test(rawId)
        ? Number(rawId)
        : Number.NaN;
    if (!Number.isSafeInteger(mediaId)) {
      throw new PostcardTemplateCatalogError(404, "TEMPLATE_MEDIA_NOT_FOUND");
    }

    const media = await readMedia({ mediaId, request });
    const headers = catalogHeaders();
    headers.set(
      "Cache-Control",
      "public, max-age=300, stale-while-revalidate=86400",
    );
    headers.set("Content-Disposition", "inline; filename=template-preview");
    headers.set("Content-Length", String(media.contentLength));
    headers.set("Content-Type", media.contentType);
    return new Response(
      createBoundedStorageStream(
        media.stream,
        media.contentLength,
        TEMPLATE_MEDIA_MAX_FILE_SIZE_BYTES,
      ),
      { headers, status: 200 },
    );
  } catch (error) {
    return errorResponse(request, error);
  }
};

export const templateMediaHandler = createTemplateMediaHandler();

export const postcardTemplateStorefrontEndpoints: Endpoint[] = [
  {
    handler: postcardTemplateCatalogHandler,
    method: "get",
    path: "/storefront/postcard-templates",
  },
  {
    handler: templateMediaHandler,
    method: "get",
    path: "/storefront/template-media/:mediaId",
  },
];
