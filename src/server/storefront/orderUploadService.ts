import { sql } from "@payloadcms/db-postgres";
import { randomUUID } from "node:crypto";
import type { PayloadRequest } from "payload";

import { CHECKOUT_INTENT_POLICY } from "../checkout-intents/checkoutIntentPolicy";
import {
  compensateNewOrderUploadObject,
  deleteOrderUploadObject,
  readOrderUploadObject,
  restoreOrderUploadObject,
} from "../storage/orderUploadObjectStorage";
import { buildSafeCheckoutIntentResponse } from "./checkoutIntentApiContract";
import type { CheckoutIntentCredential } from "./checkoutIntentCookie";
import { readMinimumAmountCents } from "./checkoutIntentService";
import { StorefrontApiError } from "./storefrontApiError";
import { detectAndValidateImage } from "./storefrontImageValidation";
import {
  beginStorefrontTransaction,
  commitStorefrontTransaction,
  lockAndAuthorizeCheckoutIntent,
  rollbackStorefrontTransaction,
  type StorefrontTransaction,
} from "./storefrontTransaction";

type IncomingUpload = {
  data: Buffer;
  mimetype: string;
  size: number;
};

type UploadRow = {
  filename: string | null;
  filesize: number;
  id: number;
  mimeType: string | null;
  position: number;
};

export type StorefrontMutationTestProbe = {
  afterPersistence?: (details: {
    filename: string;
    uploadId: number;
  }) => Promise<void> | void;
};

const requireDraft = (status: string) => {
  if (status !== "draft") {
    throw new StorefrontApiError(409, "INTENT_NOT_DRAFT");
  }
};

const readLockedUploads = async (
  transaction: StorefrontTransaction,
  intentId: number,
): Promise<UploadRow[]> => {
  const result = await transaction.database.execute(sql`
    SELECT id, position, filename, mime_type, filesize
    FROM public.order_uploads
    WHERE checkout_intent_id = ${intentId}
    ORDER BY position
  `);

  return result.rows.map((row) => ({
    filename: typeof row.filename === "string" ? row.filename : null,
    filesize: Number(row.filesize),
    id: Number(row.id),
    mimeType: typeof row.mime_type === "string" ? row.mime_type : null,
    position: Number(row.position),
  }));
};

const compensateOrThrow = async (
  request: PayloadRequest,
  filename: string,
) => {
  try {
    await compensateNewOrderUploadObject(filename);
  } catch {
    request.payload.logger.error({
      msg: "Storefront upload compensation failed.",
    });
    throw new StorefrontApiError(500, "STORAGE_COMPENSATION_FAILED");
  }
};

export const uploadCheckoutIntentFile = async (
  {
    credential,
    file,
    position,
    request,
  }: {
    credential: CheckoutIntentCredential;
    file: IncomingUpload;
    position: number;
    request: PayloadRequest;
  },
  testProbe: StorefrontMutationTestProbe = {},
) => {
  if (file.size !== file.data.length) {
    throw new StorefrontApiError(400, "INVALID_FILE_SIZE");
  }
  const verifiedImage = await detectAndValidateImage(file.data, file.mimetype);
  const minimumAmountCents = await readMinimumAmountCents(request);
  const filename = `${randomUUID()}.${verifiedImage.extension}`;
  let transaction: StorefrontTransaction | undefined;
  let storageAttempted = false;

  try {
    transaction = await beginStorefrontTransaction(request);
    const intent = await lockAndAuthorizeCheckoutIntent(
      transaction,
      credential,
    );
    requireDraft(intent.status);

    const existingUploads = await readLockedUploads(transaction, intent.id);
    if (existingUploads.length >= CHECKOUT_INTENT_POLICY.maximumUploads) {
      throw new StorefrontApiError(409, "UPLOAD_COUNT_LIMIT");
    }
    if (existingUploads.some((upload) => upload.position === position)) {
      throw new StorefrontApiError(409, "POSITION_OCCUPIED");
    }
    const existingBytes = existingUploads.reduce(
      (total, upload) => total + upload.filesize,
      0,
    );
    if (
      !Number.isSafeInteger(existingBytes) ||
      existingBytes + file.size >
        CHECKOUT_INTENT_POLICY.combinedUploadLimitBytes
    ) {
      throw new StorefrontApiError(413, "TOTAL_UPLOAD_SIZE_LIMIT");
    }

    storageAttempted = true;
    const created = await request.payload.create({
      collection: "order-uploads",
      data: { checkoutIntent: intent.id, position },
      depth: 0,
      file: {
        data: file.data,
        mimetype: verifiedImage.mimeType,
        name: filename,
        size: file.size,
      },
      overrideAccess: true,
      req: request,
    });
    if (created.filename !== filename) {
      throw new StorefrontApiError(500, "UNEXPECTED_STORAGE_KEY");
    }

    await testProbe.afterPersistence?.({
      filename,
      uploadId: Number(created.id),
    });
    const uploads = await readLockedUploads(transaction, intent.id);
    const response = buildSafeCheckoutIntentResponse({
      intent,
      minimumAmountCents,
      uploads,
    });
    await commitStorefrontTransaction(transaction);
    transaction = undefined;

    return response;
  } catch (error) {
    await rollbackStorefrontTransaction(transaction);
    if (storageAttempted) await compensateOrThrow(request, filename);
    if (error instanceof StorefrontApiError) throw error;
    throw new StorefrontApiError(500, "UPLOAD_FAILED");
  }
};

const restoreOrThrow = async (
  request: PayloadRequest,
  backup: { contentType: string; data: Buffer; filename: string },
) => {
  try {
    await restoreOrderUploadObject(backup);
  } catch {
    request.payload.logger.error({
      msg: "Storefront delete compensation failed.",
    });
    throw new StorefrontApiError(500, "STORAGE_COMPENSATION_FAILED");
  }
};

export const deleteCheckoutIntentFile = async (
  {
    credential,
    request,
    uploadId,
  }: {
    credential: CheckoutIntentCredential;
    request: PayloadRequest;
    uploadId: number;
  },
  testProbe: StorefrontMutationTestProbe = {},
) => {
  let transaction: StorefrontTransaction | undefined;
  let backup:
    | { contentType: string; data: Buffer; filename: string }
    | undefined;
  let objectDeleted = false;

  try {
    transaction = await beginStorefrontTransaction(request);
    const intent = await lockAndAuthorizeCheckoutIntent(
      transaction,
      credential,
    );
    requireDraft(intent.status);
    const uploads = await readLockedUploads(transaction, intent.id);
    const upload = uploads.find((candidate) => candidate.id === uploadId);
    if (!upload?.filename) {
      throw new StorefrontApiError(404, "UPLOAD_NOT_FOUND");
    }

    const storedObject = await readOrderUploadObject(upload.filename);
    backup = {
      contentType: upload.mimeType ?? storedObject.contentType ?? "image/jpeg",
      data: storedObject.data,
      filename: upload.filename,
    };
    await deleteOrderUploadObject(upload.filename);
    objectDeleted = true;

    await request.payload.delete({
      collection: "order-uploads",
      id: upload.id,
      overrideAccess: true,
      req: request,
    });
    await testProbe.afterPersistence?.({
      filename: upload.filename,
      uploadId: upload.id,
    });
    await commitStorefrontTransaction(transaction);
    transaction = undefined;
  } catch (error) {
    await rollbackStorefrontTransaction(transaction);
    if (objectDeleted && backup) await restoreOrThrow(request, backup);
    if (error instanceof StorefrontApiError) throw error;
    throw new StorefrontApiError(500, "UPLOAD_DELETE_FAILED");
  }
};
