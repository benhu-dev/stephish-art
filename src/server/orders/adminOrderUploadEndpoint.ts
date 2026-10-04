import type { Endpoint, PayloadRequest } from "payload";

import { CHECKOUT_INTENT_POLICY } from "../checkout-intents/checkoutIntentPolicy";
import { openOrderUploadObject } from "../storage/orderUploadObjectStorage";
import { extensionForMimeType } from "../../components/admin/orders/orderWorkbenchContract";

type Mode = "download" | "preview";
type OpenOrderUploadObject = typeof openOrderUploadObject;

class AdminOrderUploadError extends Error {
  constructor(
    readonly status: number,
    readonly code: "UNAUTHORIZED" | "UPLOAD_NOT_FOUND",
  ) {
    super(code);
  }
}

const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

const privateHeaders = () =>
  new Headers({
    "Cache-Control": "private, no-store, max-age=0",
    "Cross-Origin-Resource-Policy": "same-origin",
    Pragma: "no-cache",
    "X-Content-Type-Options": "nosniff",
  });

const parseId = (value: unknown) => {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new AdminOrderUploadError(404, "UPLOAD_NOT_FOUND");
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id)) {
    throw new AdminOrderUploadError(404, "UPLOAD_NOT_FOUND");
  }
  return id;
};

export const createBoundedUploadStream = (
  source: ReadableStream<Uint8Array>,
  expectedBytes: number,
) => {
  const reader = source.getReader();
  let receivedBytes = 0;
  return new ReadableStream<Uint8Array>({
    async cancel(reason) {
      await reader.cancel(reason);
    },
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          if (receivedBytes !== expectedBytes) {
            controller.error(new Error("UPLOAD_STREAM_LENGTH_MISMATCH"));
          } else {
            controller.close();
          }
          return;
        }
        receivedBytes += chunk.value.byteLength;
        if (
          receivedBytes > expectedBytes ||
          receivedBytes > CHECKOUT_INTENT_POLICY.perFileUploadLimitBytes
        ) {
          await reader.cancel();
          controller.error(new Error("UPLOAD_STREAM_LENGTH_MISMATCH"));
          return;
        }
        controller.enqueue(chunk.value);
      } catch {
        controller.error(new Error("UPLOAD_STREAM_UNAVAILABLE"));
      }
    },
  });
};

const errorResponse = (request: PayloadRequest, error: unknown) => {
  const known =
    error instanceof AdminOrderUploadError
      ? error
      : new AdminOrderUploadError(404, "UPLOAD_NOT_FOUND");
  if (!(error instanceof AdminOrderUploadError)) {
    request.payload.logger.error({ msg: "Admin order upload stream failed." });
  }
  return Response.json(
    { error: { code: known.code } },
    { headers: privateHeaders(), status: known.status },
  );
};

export const createAdminOrderUploadHandler = ({
  mode,
  openOrderUploadObject: openObject = openOrderUploadObject,
}: {
  mode: Mode;
  openOrderUploadObject?: OpenOrderUploadObject;
}) => async (request: PayloadRequest) => {
  try {
    if (request.user?.collection !== "users") {
      throw new AdminOrderUploadError(401, "UNAUTHORIZED");
    }
    const orderId = parseId(request.routeParams?.orderId);
    const uploadId = parseId(request.routeParams?.uploadId);
    const result = await request.payload.find({
      collection: "order-uploads",
      depth: 0,
      limit: 1,
      overrideAccess: false,
      pagination: false,
      req: request,
      select: {
        filename: true,
        filesize: true,
        mimeType: true,
        position: true,
      },
      where: {
        and: [
          { id: { equals: uploadId } },
          { order: { equals: orderId } },
        ],
      },
    });
    const upload = result.docs[0];
    const filename = upload?.filename;
    const filesize = Number(upload?.filesize);
    const mimeType = upload?.mimeType;
    const position = Number(upload?.position);
    if (
      typeof filename !== "string" ||
      filename.length === 0 ||
      !Number.isSafeInteger(filesize) ||
      filesize <= 0 ||
      filesize > CHECKOUT_INTENT_POLICY.perFileUploadLimitBytes ||
      typeof mimeType !== "string" ||
      !allowedMimeTypes.has(mimeType) ||
      !Number.isInteger(position) ||
      position < 1 ||
      position > 3
    ) {
      throw new AdminOrderUploadError(404, "UPLOAD_NOT_FOUND");
    }

    const object = await openObject(filename, request.signal);
    if (
      object.contentType !== mimeType ||
      object.contentLength !== filesize
    ) {
      throw new AdminOrderUploadError(404, "UPLOAD_NOT_FOUND");
    }
    const safeName = `reference-${position}.${extensionForMimeType(
      mimeType as "image/jpeg" | "image/png" | "image/webp",
    )}`;
    const headers = privateHeaders();
    headers.set("Content-Length", String(filesize));
    headers.set("Content-Type", mimeType);
    headers.set(
      "Content-Disposition",
      `${mode === "preview" ? "inline" : "attachment"}; filename="${safeName}"`,
    );
    return new Response(createBoundedUploadStream(object.stream, filesize), {
      headers,
      status: 200,
    });
  } catch (error) {
    return errorResponse(request, error);
  }
};

export const adminOrderUploadEndpoints: Endpoint[] = [
  {
    handler: createAdminOrderUploadHandler({ mode: "preview" }),
    method: "get",
    path: "/admin/orders/:orderId/uploads/:uploadId/preview",
  },
  {
    handler: createAdminOrderUploadHandler({ mode: "download" }),
    method: "get",
    path: "/admin/orders/:orderId/uploads/:uploadId/download",
  },
];
