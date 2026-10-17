import path from "node:path";
import type { Endpoint, PayloadRequest } from "payload";
import { openPrivateStorageObject } from "../storage/orderUploadObjectStorage";
import { createBoundedStorageStream } from "../storage/boundedStorageStream";
import {
  TEMPLATE_MEDIA_MAX_FILE_SIZE_BYTES,
  TEMPLATE_MEDIA_PREFIX,
  TEMPLATE_MEDIA_MIME_TYPES,
} from "../templates/templateMediaPolicy";
import { requireNoQueryString } from "../storefront/storefrontRequestSecurity";

export const createAdminPortraitTemplateHandler =
  (openObject = openPrivateStorageObject) =>
  async (request: PayloadRequest) => {
    const headers = new Headers({
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
    });
    try {
      if (request.user?.collection !== "users")
        return Response.json(
          { error: { code: "UNAUTHORIZED" } },
          { status: 401, headers },
        );
      requireNoQueryString(request);
      const rawOrder = request.routeParams?.orderId,
        rawPortrait = request.routeParams?.portraitId;
      if (
        typeof rawOrder !== "string" ||
        typeof rawPortrait !== "string" ||
        !/^[1-9]\d*$/.test(rawOrder) ||
        !/^[1-9]\d*$/.test(rawPortrait) ||
        !Number.isSafeInteger(Number(rawOrder)) ||
        !Number.isSafeInteger(Number(rawPortrait))
      )
        throw new Error();
      const result = await request.payload.find({
        collection: "order-portraits",
        depth: 0,
        limit: 1,
        pagination: false,
        overrideAccess: false,
        req: request,
        select: { templatePreviewMedia: true },
        where: {
          and: [
            { id: { equals: Number(rawPortrait) } },
            { order: { equals: Number(rawOrder) } },
          ],
        },
      });
      const mediaId = result.docs[0]?.templatePreviewMedia;
      if (typeof mediaId !== "number") throw new Error();
      const media = await request.payload.findByID({
        collection: "template-media",
        id: mediaId,
        depth: 0,
        overrideAccess: false,
        req: request,
        select: {
          filename: true,
          prefix: true,
          filesize: true,
          mimeType: true,
        },
      });
      if (
        typeof media.filename !== "string" ||
        !/^[^/\\]{1,255}$/.test(media.filename) ||
        [".", ".."].includes(media.filename) ||
        media.prefix !== TEMPLATE_MEDIA_PREFIX ||
        !Number.isSafeInteger(media.filesize) ||
        Number(media.filesize) <= 0 ||
        Number(media.filesize) > TEMPLATE_MEDIA_MAX_FILE_SIZE_BYTES ||
        !TEMPLATE_MEDIA_MIME_TYPES.includes(media.mimeType as never)
      )
        throw new Error();
      const object = await openObject(
        path.posix.join(TEMPLATE_MEDIA_PREFIX, media.filename),
        request.signal,
      );
      if (
        object.contentType !== media.mimeType ||
        object.contentLength !== media.filesize
      )
        throw new Error();
      headers.set("Content-Type", media.mimeType!);
      headers.set("Content-Length", String(media.filesize));
      headers.set(
        "Content-Disposition",
        "inline; filename=portrait-template-preview",
      );
      return new Response(
        createBoundedStorageStream(
          object.stream,
          Number(media.filesize),
          TEMPLATE_MEDIA_MAX_FILE_SIZE_BYTES,
        ),
        { headers },
      );
    } catch {
      return Response.json(
        { error: { code: "TEMPLATE_NOT_FOUND" } },
        { status: 404, headers },
      );
    }
  };
export const adminPortraitTemplateEndpoints: Endpoint[] = [
  {
    method: "get",
    path: "/admin/orders/:orderId/portraits/:portraitId/template-preview",
    handler: createAdminPortraitTemplateHandler(),
  },
];
