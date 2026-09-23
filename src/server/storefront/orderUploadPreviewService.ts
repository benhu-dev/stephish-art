import type { PayloadRequest } from "payload";

import { openOrderUploadObject } from "../storage/orderUploadObjectStorage";
import { authorizeCheckoutIntent } from "./checkoutIntentAccess";
import { STOREFRONT_ALLOWED_MIME_TYPES } from "./checkoutIntentApiContract";
import type { CheckoutIntentCredential } from "./checkoutIntentCookie";
import {
  StorefrontApiError,
  unauthorizedIntentError,
} from "./storefrontApiError";

const allowedMimeTypes = new Set<string>(STOREFRONT_ALLOWED_MIME_TYPES);

type OpenOrderUploadObject = typeof openOrderUploadObject;

export type OrderUploadPreviewDependencies = {
  openOrderUploadObject?: OpenOrderUploadObject;
};

export const readCheckoutIntentUploadPreview = async ({
  credential,
  dependencies = {},
  request,
  uploadId,
}: {
  credential: CheckoutIntentCredential;
  dependencies?: OrderUploadPreviewDependencies;
  request: PayloadRequest;
  uploadId: number;
}) => {
  const intent = await authorizeCheckoutIntent(request, credential);
  if (intent.status !== "draft") throw unauthorizedIntentError();

  const result = await request.payload.find({
    collection: "order-uploads",
    depth: 0,
    limit: 1,
    overrideAccess: true,
    pagination: false,
    req: request,
    select: {
      filename: true,
      filesize: true,
      mimeType: true,
    },
    where: {
      and: [
        { id: { equals: uploadId } },
        { checkoutIntent: { equals: intent.id } },
      ],
    },
  });
  const upload = result.docs[0];
  if (!upload) throw new StorefrontApiError(404, "UPLOAD_NOT_FOUND");

  const filename = upload.filename;
  const mimeType = upload.mimeType;
  const filesize = Number(upload.filesize);
  if (
    typeof filename !== "string" ||
    filename.length === 0 ||
    typeof mimeType !== "string" ||
    !allowedMimeTypes.has(mimeType) ||
    !Number.isSafeInteger(filesize) ||
    filesize <= 0
  ) {
    throw new StorefrontApiError(500, "PREVIEW_UNAVAILABLE");
  }

  try {
    const object = await (dependencies.openOrderUploadObject ??
      openOrderUploadObject)(filename, request.signal);
    const contentLength = object.contentLength;
    if (
      object.contentType !== mimeType ||
      (contentLength !== undefined &&
        (!Number.isSafeInteger(contentLength) ||
          contentLength <= 0 ||
          contentLength !== filesize))
    ) {
      throw new StorefrontApiError(500, "PREVIEW_UNAVAILABLE");
    }

    return {
      contentLength,
      contentType: mimeType,
      stream: object.stream,
    };
  } catch {
    throw new StorefrontApiError(500, "PREVIEW_UNAVAILABLE");
  }
};
