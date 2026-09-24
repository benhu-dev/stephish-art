import { addDataAndFileToRequest, type PayloadRequest } from "payload";

import { CHECKOUT_INTENT_POLICY } from "../checkout-intents/checkoutIntentPolicy";
import { StorefrontApiError } from "./storefrontApiError";

const MAX_JSON_BYTES = 1024;
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

type StorefrontWebRequest = Pick<Request, "headers"> & {
  body?: Request["body"];
  origin?: string;
  url?: string;
};

export const isSameOriginRequest = (request: StorefrontWebRequest): boolean => {
  const originHeader = request.headers.get("origin");
  if (!originHeader || originHeader === "null" || !request.url) return false;

  try {
    const suppliedOrigin = new URL(originHeader);
    const requestURL = new URL(request.url);
    const requestHost =
      request.headers.get("x-forwarded-host") ??
      request.headers.get("host") ??
      requestURL.host;
    const requestProtocol =
      request.headers.get("x-forwarded-proto") ??
      requestURL.protocol.replace(/:$/, "");
    const effectiveRequestOrigin = `${requestProtocol}://${requestHost}`;
    const allowedOrigins = new Set([
      effectiveRequestOrigin,
      request.origin,
      requestURL.origin,
    ]);

    return (
      suppliedOrigin.pathname === "/" &&
      !suppliedOrigin.search &&
      !suppliedOrigin.hash &&
      allowedOrigins.has(suppliedOrigin.origin)
    );
  } catch {
    return false;
  }
};

export const requireSameOrigin = (request: StorefrontWebRequest) => {
  if (!isSameOriginRequest(request)) {
    throw new StorefrontApiError(403, "ORIGIN_NOT_ALLOWED");
  }
};

const hasExactKeys = (value: object, keys: string[]) => {
  const actualKeys = Object.keys(value).sort();
  return (
    actualKeys.length === keys.length &&
    actualKeys.every((key, index) => key === [...keys].sort()[index])
  );
};

export const parseEmptyObjectRequest = (value: unknown): Record<string, never> => {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !hasExactKeys(value, [])
  ) {
    throw new StorefrontApiError(400, "INVALID_REQUEST");
  }

  return {};
};

export const requireNoQueryString = (request: { url?: string }) => {
  try {
    if (!request.url) throw new Error("missing request URL");
    if (new URL(request.url).search) {
      throw new StorefrontApiError(400, "UNEXPECTED_QUERY");
    }
  } catch (error) {
    if (error instanceof StorefrontApiError) throw error;
    throw new StorefrontApiError(400, "INVALID_REQUEST_URL");
  }
};

export const parseAmountRequest = (
  value: unknown,
  minimumAmountCents: number,
) => {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !hasExactKeys(value, ["amountCents"])
  ) {
    throw new StorefrontApiError(400, "INVALID_REQUEST");
  }

  const amountCents = (value as { amountCents?: unknown }).amountCents;
  if (
    typeof amountCents !== "number" ||
    !Number.isFinite(amountCents) ||
    !Number.isSafeInteger(amountCents) ||
    amountCents <= 0
  ) {
    throw new StorefrontApiError(400, "INVALID_AMOUNT");
  }
  if (amountCents < minimumAmountCents) {
    throw new StorefrontApiError(422, "AMOUNT_BELOW_MINIMUM");
  }

  return { amountCents };
};

const readBoundedText = async (
  request: StorefrontWebRequest,
  maximumBytes: number,
) => {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (
      !Number.isSafeInteger(parsedLength) ||
      parsedLength < 0 ||
      parsedLength > maximumBytes
    ) {
      throw new StorefrontApiError(413, "REQUEST_TOO_LARGE");
    }
  }

  if (!request.body) throw new StorefrontApiError(400, "INVALID_REQUEST");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel();
      throw new StorefrontApiError(413, "REQUEST_TOO_LARGE");
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks, totalBytes).toString("utf8");
};

export const readStorefrontJson = async (
  request: StorefrontWebRequest,
  maximumBytes = MAX_JSON_BYTES,
) => {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0];
  if (contentType?.trim().toLowerCase() !== "application/json") {
    throw new StorefrontApiError(415, "UNSUPPORTED_CONTENT_TYPE");
  }

  try {
    const text = await readBoundedText(request, maximumBytes);
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof StorefrontApiError) throw error;
    throw new StorefrontApiError(400, "INVALID_JSON");
  }
};

const parsePositionPayload = (value: unknown) => {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !hasExactKeys(value, ["position"])
  ) {
    throw new StorefrontApiError(400, "INVALID_REQUEST");
  }

  const position = (value as { position?: unknown }).position;
  if (
    typeof position !== "number" ||
    !Number.isInteger(position) ||
    position < 1 ||
    position > CHECKOUT_INTENT_POLICY.maximumUploads
  ) {
    throw new StorefrontApiError(400, "INVALID_POSITION");
  }
  return position;
};

export const parseStorefrontUpload = async (request: PayloadRequest) => {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data;\s*boundary=/i.test(contentType)) {
    throw new StorefrontApiError(415, "UNSUPPORTED_CONTENT_TYPE");
  }

  const contentLength = Number(request.headers.get("content-length"));
  const maximumRequestBytes =
    CHECKOUT_INTENT_POLICY.perFileUploadLimitBytes + MULTIPART_OVERHEAD_BYTES;
  if (
    !Number.isSafeInteger(contentLength) ||
    contentLength <= 0 ||
    contentLength > maximumRequestBytes
  ) {
    throw new StorefrontApiError(413, "REQUEST_TOO_LARGE");
  }

  if (typeof request.clone !== "function") {
    throw new StorefrontApiError(400, "INVALID_MULTIPART");
  }
  const contractRequest = request.clone();
  let contractForm: FormData;
  try {
    contractForm = await contractRequest.formData();
  } catch {
    throw new StorefrontApiError(400, "INVALID_MULTIPART");
  }

  const keys = [...contractForm.keys()];
  if (
    keys.length !== 2 ||
    contractForm.getAll("file").length !== 1 ||
    contractForm.getAll("_payload").length !== 1 ||
    !keys.includes("file") ||
    !keys.includes("_payload")
  ) {
    throw new StorefrontApiError(400, "INVALID_MULTIPART_FIELDS");
  }

  const contractFile = contractForm.get("file");
  const payloadField = contractForm.get("_payload");
  if (
    contractFile === null ||
    typeof contractFile === "string" ||
    typeof payloadField !== "string"
  ) {
    throw new StorefrontApiError(400, "INVALID_MULTIPART_FIELDS");
  }

  let positionData: unknown;
  try {
    positionData = JSON.parse(payloadField);
  } catch {
    throw new StorefrontApiError(400, "INVALID_MULTIPART_FIELDS");
  }
  const position = parsePositionPayload(positionData);

  try {
    await addDataAndFileToRequest(request);
  } catch (error) {
    const status =
      typeof error === "object" && error !== null && "status" in error
        ? Number(error.status)
        : 400;
    throw new StorefrontApiError(
      status === 413 ? 413 : 400,
      status === 413 ? "FILE_TOO_LARGE" : "INVALID_MULTIPART",
    );
  }

  if (
    !request.file ||
    !request.files ||
    Object.keys(request.files).length !== 1 ||
    Array.isArray(request.files.file) ||
    request.file.size !== contractFile.size ||
    request.file.mimetype !== contractFile.type
  ) {
    throw new StorefrontApiError(400, "INVALID_MULTIPART_FIELDS");
  }

  return { file: request.file, position };
};
