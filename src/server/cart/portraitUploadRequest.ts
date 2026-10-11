import { addDataAndFileToRequest, type PayloadRequest } from "payload";

import { readStorefrontJson } from "../storefront/storefrontRequestSecurity";
import { StorefrontApiError } from "../storefront/storefrontApiError";
import {
  PORTRAIT_UPLOAD_POLICY,
  parsePortraitUploadMetadata,
} from "./portraitUploadPolicy";

const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

export const parsePortraitUploadUpdate = async (request: PayloadRequest) =>
  parsePortraitUploadMetadata(await readStorefrontJson(request, 4 * 1024));

export const parsePortraitUploadForm = async (request: PayloadRequest) => {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data;\s*boundary=/i.test(contentType)) {
    throw new StorefrontApiError(415, "UNSUPPORTED_CONTENT_TYPE");
  }
  const contentLength = Number(request.headers.get("content-length"));
  const maximumRequestBytes =
    PORTRAIT_UPLOAD_POLICY.perFileUploadLimitBytes + MULTIPART_OVERHEAD_BYTES;
  if (
    request.headers.has("transfer-encoding") ||
    !Number.isSafeInteger(contentLength) ||
    contentLength <= 0 ||
    contentLength > maximumRequestBytes
  ) {
    throw new StorefrontApiError(413, "REQUEST_TOO_LARGE");
  }
  if (typeof request.clone !== "function") {
    throw new StorefrontApiError(400, "INVALID_MULTIPART");
  }

  let contractForm: FormData;
  try {
    contractForm = await request.clone().formData();
  } catch {
    throw new StorefrontApiError(400, "INVALID_MULTIPART");
  }
  const keys = [...contractForm.keys()];
  const contractFile = contractForm.get("file");
  const payloadField = contractForm.get("_payload");
  if (
    keys.length !== 2 ||
    !keys.includes("file") ||
    !keys.includes("_payload") ||
    contractForm.getAll("file").length !== 1 ||
    contractForm.getAll("_payload").length !== 1 ||
    contractFile === null ||
    typeof contractFile === "string" ||
    typeof payloadField !== "string"
  ) {
    throw new StorefrontApiError(400, "INVALID_MULTIPART_FIELDS");
  }

  let metadata: unknown;
  try {
    metadata = JSON.parse(payloadField);
  } catch {
    throw new StorefrontApiError(400, "INVALID_MULTIPART_FIELDS");
  }
  const parsedMetadata = parsePortraitUploadMetadata(metadata);

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

  return { file: request.file, ...parsedMetadata };
};
