import { sql } from "@payloadcms/db-postgres";
import { randomUUID } from "node:crypto";
import type { PayloadRequest } from "payload";

import {
  compensateNewOrderUploadObject,
  deleteOrderUploadObject,
  openOrderUploadObject,
  readOrderUploadObject,
  restoreOrderUploadObject,
  writeOrderUploadObject,
} from "../storage/orderUploadObjectStorage";
import { authorizeCheckoutIntent } from "../storefront/checkoutIntentAccess";
import type { CheckoutIntentCredential } from "../storefront/checkoutIntentCookie";
import { STOREFRONT_ALLOWED_MIME_TYPES } from "../storefront/checkoutIntentApiContract";
import { StorefrontApiError } from "../storefront/storefrontApiError";
import {
  beginStorefrontTransaction,
  commitStorefrontTransaction,
  lockAndAuthorizeCheckoutIntent,
  rollbackStorefrontTransaction,
  type StorefrontTransaction,
} from "../storefront/storefrontTransaction";
import {
  validateStoredSubjectIdList,
} from "./portraitCartPolicy";
import { normalizePortraitReferenceImage } from "./portraitImageNormalization";
import {
  assertPortraitUploadCapacity,
  validatePortraitPhotoSet,
  type PortraitUploadMetadata,
} from "./portraitUploadPolicy";

type IncomingUpload = {
  data: Buffer;
  mimetype: string;
  size: number;
};

type LockedPortrait = {
  id: number;
  subjectIds: string[];
};

type UploadRow = {
  checkoutPortraitId: number | null;
  filename: string | null;
  filesize: number;
  id: number;
  mimeType: string | null;
  position: number;
  subjectIds: string[] | undefined;
};

const allowedMimeTypes = new Set<string>(STOREFRONT_ALLOWED_MIME_TYPES);

const requireDraft = (status: string) => {
  if (status !== "draft") {
    throw new StorefrontApiError(409, "INTENT_NOT_DRAFT");
  }
};

const authorizePortraitTarget = async (
  request: PayloadRequest,
  credential: CheckoutIntentCredential,
  portraitPublicId: string,
) => {
  const intent = await authorizeCheckoutIntent(request, credential);
  requireDraft(intent.status);
  const result = await request.payload.find({
    collection: "checkout-portraits",
    depth: 0,
    limit: 1,
    overrideAccess: true,
    pagination: false,
    req: request,
    where: {
      and: [
        { intent: { equals: intent.id } },
        { publicId: { equals: portraitPublicId } },
      ],
    },
  });
  if (!result.docs[0]) {
    throw new StorefrontApiError(404, "PORTRAIT_NOT_FOUND");
  }
};

const readLockedPortrait = async (
  transaction: StorefrontTransaction,
  intentId: number,
  portraitPublicId: string,
): Promise<LockedPortrait> => {
  const portraitResult = await transaction.database.execute(sql`
    SELECT id
    FROM public.checkout_portraits
    WHERE intent_id = ${intentId} AND public_id = ${portraitPublicId}
    FOR UPDATE
  `);
  const id = Number(portraitResult.rows[0]?.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new StorefrontApiError(404, "PORTRAIT_NOT_FOUND");
  }
  const subjectResult = await transaction.database.execute(sql`
    SELECT subject_id, position
    FROM public.checkout_portraits_subjects
    WHERE _parent_id = ${id}
    ORDER BY position
    FOR SHARE
  `);
  const subjectIds = subjectResult.rows.map((row, index) => {
    if (Number(row.position) !== index + 1) {
      throw new StorefrontApiError(500, "INVALID_PORTRAIT_SUBJECTS");
    }
    return row.subject_id;
  });
  return {
    id,
    subjectIds: validateStoredSubjectIdList(subjectIds)!,
  };
};

const readLockedUploads = async (
  transaction: StorefrontTransaction,
  intentId: number,
): Promise<UploadRow[]> => {
  const result = await transaction.database.execute(sql`
    SELECT id, checkout_portrait_id, filename, filesize, mime_type, position,
      subject_ids
    FROM public.order_uploads
    WHERE checkout_intent_id = ${intentId}
    ORDER BY checkout_portrait_id NULLS FIRST, position, id
    FOR UPDATE
  `);
  return result.rows.map((row) => {
    const id = Number(row.id);
    const filesize = Number(row.filesize);
    const position = Number(row.position);
    const checkoutPortraitId =
      row.checkout_portrait_id === null || row.checkout_portrait_id === undefined
        ? null
        : Number(row.checkout_portrait_id);
    if (
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      !Number.isSafeInteger(filesize) ||
      filesize <= 0 ||
      !Number.isSafeInteger(position) ||
      position <= 0 ||
      (checkoutPortraitId !== null &&
        (!Number.isSafeInteger(checkoutPortraitId) || checkoutPortraitId <= 0))
    ) {
      throw new StorefrontApiError(500, "INVALID_UPLOAD_STATE");
    }
    return {
      checkoutPortraitId,
      filename: typeof row.filename === "string" ? row.filename : null,
      filesize,
      id,
      mimeType: typeof row.mime_type === "string" ? row.mime_type : null,
      position,
      subjectIds:
        checkoutPortraitId === null
          ? undefined
          : validateStoredSubjectIdList(row.subject_ids),
    };
  });
};

const restoreOrThrow = async (
  request: PayloadRequest,
  backup: { contentType: string; data: Buffer; filename: string },
  restore: typeof restoreOrderUploadObject,
) => {
  try {
    await restore(backup);
  } catch {
    request.payload.logger.error({ msg: "Portrait upload compensation failed." });
    throw new StorefrontApiError(500, "STORAGE_COMPENSATION_FAILED");
  }
};

const compensateOrThrow = async (
  request: PayloadRequest,
  filename: string,
  compensate: typeof compensateNewOrderUploadObject,
) => {
  try {
    await compensate(filename);
  } catch {
    request.payload.logger.error({ msg: "Portrait upload compensation failed." });
    throw new StorefrontApiError(500, "STORAGE_COMPENSATION_FAILED");
  }
};

const reorderPortraitUploads = async ({
  ordered,
  portraitId,
  request,
  transaction,
  targetId,
  targetSubjectIds,
}: {
  ordered: UploadRow[];
  portraitId: number;
  request: PayloadRequest;
  transaction: StorefrontTransaction;
  targetId?: number;
  targetSubjectIds?: string[];
}) => {
  await transaction.database.execute(sql`
    UPDATE public.order_uploads
    SET position = -position
    WHERE checkout_portrait_id = ${portraitId}
  `);
  for (const [index, upload] of ordered.entries()) {
    await request.payload.update({
      collection: "order-uploads",
      data: {
        position: index + 1,
        ...(upload.id === targetId ? { subjectIds: targetSubjectIds } : {}),
      },
      depth: 0,
      id: upload.id,
      overrideAccess: true,
      req: request,
    });
  }
};

export type PortraitUploadMutationDependencies = {
  begin: typeof beginStorefrontTransaction;
  commit: typeof commitStorefrontTransaction;
  lock: typeof lockAndAuthorizeCheckoutIntent;
  rollback: typeof rollbackStorefrontTransaction;
};

export type PortraitUploadProviderDependencies = {
  compensateObject: typeof compensateNewOrderUploadObject;
  deleteObject: typeof deleteOrderUploadObject;
  normalizeImage: typeof normalizePortraitReferenceImage;
  openObject: typeof openOrderUploadObject;
  readObject: typeof readOrderUploadObject;
  restoreObject: typeof restoreOrderUploadObject;
  writeObject: typeof writeOrderUploadObject;
};

const defaultMutationDependencies: PortraitUploadMutationDependencies = {
  begin: beginStorefrontTransaction,
  commit: commitStorefrontTransaction,
  lock: lockAndAuthorizeCheckoutIntent,
  rollback: rollbackStorefrontTransaction,
};

const defaultProviderDependencies: PortraitUploadProviderDependencies = {
  compensateObject: compensateNewOrderUploadObject,
  deleteObject: deleteOrderUploadObject,
  normalizeImage: normalizePortraitReferenceImage,
  openObject: openOrderUploadObject,
  readObject: readOrderUploadObject,
  restoreObject: restoreOrderUploadObject,
  writeObject: writeOrderUploadObject,
};

export const uploadPortraitReference = async ({
  credential,
  file,
  metadata,
  portraitPublicId,
  providerDependencies = defaultProviderDependencies,
  request,
  transactionDependencies = defaultMutationDependencies,
}: {
  credential: CheckoutIntentCredential;
  file: IncomingUpload;
  metadata: PortraitUploadMetadata;
  portraitPublicId: string;
  providerDependencies?: PortraitUploadProviderDependencies;
  request: PayloadRequest;
  transactionDependencies?: PortraitUploadMutationDependencies;
}) => {
  if (file.size !== file.data.length) {
    throw new StorefrontApiError(400, "INVALID_FILE_SIZE");
  }
  let filename: string | undefined;
  let transaction: StorefrontTransaction | undefined;
  let objectWriteAttempted = false;
  try {
    await authorizePortraitTarget(
      request,
      credential,
      portraitPublicId,
    );
    const normalized = await providerDependencies.normalizeImage(
      file.data,
      file.mimetype,
    );
    filename = `${randomUUID()}.${normalized.extension}`;
    objectWriteAttempted = true;
    await providerDependencies.writeObject({
      contentType: normalized.mimeType,
      data: normalized.data,
      filename,
    });
    transaction = await transactionDependencies.begin(request);
    const intent = await transactionDependencies.lock(transaction, credential);
    requireDraft(intent.status);
    const portrait = await readLockedPortrait(
      transaction,
      intent.id,
      portraitPublicId,
    );
    const uploads = await readLockedUploads(transaction, intent.id);
    const portraitUploads = uploads.filter(
      ({ checkoutPortraitId }) => checkoutPortraitId === portrait.id,
    );
    if (metadata.position !== portraitUploads.length + 1) {
      throw new StorefrontApiError(409, "INVALID_PHOTO_POSITION");
    }
    const subjectIds = validateStoredSubjectIdList(metadata.subjectIds)!;
    const knownSubjects = new Set(portrait.subjectIds);
    if (subjectIds.some((id) => !knownSubjects.has(id))) {
      throw new StorefrontApiError(422, "UNKNOWN_PHOTO_SUBJECT");
    }
    assertPortraitUploadCapacity({
      cartFiles: uploads.length,
      cartStoredBytes: uploads.reduce((sum, upload) => sum + upload.filesize, 0),
      incomingStoredBytes: normalized.size,
      portraitFiles: portraitUploads.length,
      portraitStoredBytes: portraitUploads.reduce(
        (sum, upload) => sum + upload.filesize,
        0,
      ),
      subjectCount: portrait.subjectIds.length,
    });

    const inserted = await transaction.database.execute(sql`
      INSERT INTO public.order_uploads (
        checkout_intent_id, checkout_portrait_id, subject_ids, position,
        filename, mime_type, filesize, width, height
      ) VALUES (
        ${intent.id}, ${portrait.id}, ${JSON.stringify(subjectIds)}::jsonb,
        ${metadata.position}, ${filename}, ${normalized.mimeType},
        ${normalized.size}, ${normalized.width}, ${normalized.height}
      )
      RETURNING id
    `);
    if (inserted.rows.length !== 1) {
      throw new StorefrontApiError(500, "UPLOAD_PERSISTENCE_FAILED");
    }
    await transactionDependencies.commit(transaction);
    transaction = undefined;
  } catch (error) {
    await transactionDependencies.rollback(transaction);
    if (objectWriteAttempted && filename) {
      await compensateOrThrow(
        request,
        filename,
        providerDependencies.compensateObject,
      );
    }
    if (error instanceof StorefrontApiError) throw error;
    throw new StorefrontApiError(500, "UPLOAD_FAILED");
  }
};

export const updatePortraitReference = async ({
  credential,
  metadata,
  portraitPublicId,
  request,
  transactionDependencies = defaultMutationDependencies,
  uploadId,
}: {
  credential: CheckoutIntentCredential;
  metadata: PortraitUploadMetadata;
  portraitPublicId: string;
  request: PayloadRequest;
  transactionDependencies?: PortraitUploadMutationDependencies;
  uploadId: number;
}) => {
  let transaction: StorefrontTransaction | undefined;
  try {
    transaction = await transactionDependencies.begin(request);
    const intent = await transactionDependencies.lock(transaction, credential);
    requireDraft(intent.status);
    const portrait = await readLockedPortrait(
      transaction,
      intent.id,
      portraitPublicId,
    );
    const uploads = await readLockedUploads(transaction, intent.id);
    const portraitUploads = uploads.filter(
      ({ checkoutPortraitId }) => checkoutPortraitId === portrait.id,
    );
    const target = portraitUploads.find(({ id }) => id === uploadId);
    if (!target) throw new StorefrontApiError(404, "UPLOAD_NOT_FOUND");
    if (metadata.position > portraitUploads.length) {
      throw new StorefrontApiError(422, "INVALID_PHOTO_POSITION");
    }
    const subjectIds = validateStoredSubjectIdList(metadata.subjectIds)!;
    const knownSubjects = new Set(portrait.subjectIds);
    if (subjectIds.some((id) => !knownSubjects.has(id))) {
      throw new StorefrontApiError(422, "UNKNOWN_PHOTO_SUBJECT");
    }
    const ordered = portraitUploads.filter(({ id }) => id !== uploadId);
    ordered.splice(metadata.position - 1, 0, {
      ...target,
      position: metadata.position,
      subjectIds,
    });
    validatePortraitPhotoSet({
      photos: ordered.map((upload, index) => ({
        filesize: upload.filesize,
        id: upload.id,
        position: index + 1,
        subjectIds: upload.id === uploadId ? subjectIds : upload.subjectIds!,
      })),
      subjectIds: portrait.subjectIds,
    });
    await reorderPortraitUploads({
      ordered,
      portraitId: portrait.id,
      request,
      targetId: uploadId,
      targetSubjectIds: subjectIds,
      transaction,
    });
    await transactionDependencies.commit(transaction);
    transaction = undefined;
  } catch (error) {
    await transactionDependencies.rollback(transaction);
    if (error instanceof StorefrontApiError) throw error;
    throw new StorefrontApiError(500, "UPLOAD_UPDATE_FAILED");
  }
};

export const deletePortraitReference = async ({
  credential,
  portraitPublicId,
  providerDependencies = defaultProviderDependencies,
  request,
  transactionDependencies = defaultMutationDependencies,
  uploadId,
}: {
  credential: CheckoutIntentCredential;
  portraitPublicId: string;
  providerDependencies?: PortraitUploadProviderDependencies;
  request: PayloadRequest;
  transactionDependencies?: PortraitUploadMutationDependencies;
  uploadId: number;
}) => {
  let transaction: StorefrontTransaction | undefined;
  let backup: { contentType: string; data: Buffer; filename: string } | undefined;
  let objectDeleted = false;
  try {
    transaction = await transactionDependencies.begin(request);
    const intent = await transactionDependencies.lock(transaction, credential);
    requireDraft(intent.status);
    const portrait = await readLockedPortrait(
      transaction,
      intent.id,
      portraitPublicId,
    );
    const portraitId = portrait.id;
    const uploads = await readLockedUploads(transaction, intent.id);
    const portraitUploads = uploads.filter(
      ({ checkoutPortraitId }) => checkoutPortraitId === portrait.id,
    );
    const target = portraitUploads.find(({ id }) => id === uploadId);
    if (!target?.filename || !target.mimeType || !allowedMimeTypes.has(target.mimeType)) {
      throw new StorefrontApiError(404, "UPLOAD_NOT_FOUND");
    }
    const targetSnapshot = target;
    await transactionDependencies.commit(transaction);
    transaction = undefined;

    const stored = await providerDependencies.readObject(target.filename);
    backup = {
      contentType: target.mimeType ?? stored.contentType ?? "image/jpeg",
      data: stored.data,
      filename: target.filename,
    };
    await providerDependencies.deleteObject(target.filename);
    objectDeleted = true;

    transaction = await transactionDependencies.begin(request);
    const revalidatedIntent = await transactionDependencies.lock(
      transaction,
      credential,
    );
    requireDraft(revalidatedIntent.status);
    const revalidatedPortrait = await readLockedPortrait(
      transaction,
      revalidatedIntent.id,
      portraitPublicId,
    );
    const revalidatedUploads = await readLockedUploads(
      transaction,
      revalidatedIntent.id,
    );
    const revalidatedPortraitUploads = revalidatedUploads.filter(
      ({ checkoutPortraitId }) => checkoutPortraitId === revalidatedPortrait.id,
    );
    const revalidatedTarget = revalidatedPortraitUploads.find(
      ({ id }) => id === uploadId,
    );
    if (
      revalidatedPortrait.id !== portraitId ||
      !revalidatedTarget ||
      revalidatedTarget.filename !== targetSnapshot.filename ||
      revalidatedTarget.filesize !== targetSnapshot.filesize ||
      revalidatedTarget.mimeType !== targetSnapshot.mimeType
    ) {
      throw new StorefrontApiError(409, "UPLOAD_CHANGED");
    }
    await request.payload.delete({
      collection: "order-uploads",
      id: target.id,
      overrideAccess: true,
      req: request,
    });
    const remaining = revalidatedPortraitUploads.filter(
      ({ id }) => id !== revalidatedTarget.id,
    );
    await reorderPortraitUploads({
      ordered: remaining,
      portraitId: revalidatedPortrait.id,
      request,
      transaction,
    });
    await transactionDependencies.commit(transaction);
    transaction = undefined;
  } catch (error) {
    await transactionDependencies.rollback(transaction);
    if (objectDeleted && backup) {
      await restoreOrThrow(request, backup, providerDependencies.restoreObject);
    }
    if (error instanceof StorefrontApiError) throw error;
    throw new StorefrontApiError(500, "UPLOAD_DELETE_FAILED");
  }
};

export const readPortraitReferencePreview = async ({
  credential,
  portraitPublicId,
  providerDependencies = defaultProviderDependencies,
  request,
  uploadId,
}: {
  credential: CheckoutIntentCredential;
  portraitPublicId: string;
  providerDependencies?: PortraitUploadProviderDependencies;
  request: PayloadRequest;
  uploadId: number;
}) => {
  let transaction: StorefrontTransaction | undefined;
  try {
    transaction = await beginStorefrontTransaction(request);
    const intent = await lockAndAuthorizeCheckoutIntent(transaction, credential);
    requireDraft(intent.status);
    const portrait = await readLockedPortrait(
      transaction,
      intent.id,
      portraitPublicId,
    );
    const uploads = await readLockedUploads(transaction, intent.id);
    const upload = uploads.find(
      (candidate) =>
        candidate.id === uploadId && candidate.checkoutPortraitId === portrait.id,
    );
    if (
      !upload?.filename ||
      !upload.mimeType ||
      !allowedMimeTypes.has(upload.mimeType)
    ) {
      throw new StorefrontApiError(404, "UPLOAD_NOT_FOUND");
    }
    await commitStorefrontTransaction(transaction);
    transaction = undefined;
    const object = await providerDependencies.openObject(
      upload.filename,
      request.signal,
    );
    const contentLength = Number(object.contentLength);
    if (
      object.contentType !== upload.mimeType ||
      !Number.isSafeInteger(contentLength) ||
      contentLength <= 0 ||
      contentLength !== upload.filesize
    ) {
      throw new StorefrontApiError(500, "PREVIEW_UNAVAILABLE");
    }
    return {
      contentLength,
      contentType: upload.mimeType,
      stream: object.stream,
    };
  } catch (error) {
    await rollbackStorefrontTransaction(transaction);
    if (error instanceof StorefrontApiError) throw error;
    throw new StorefrontApiError(500, "PREVIEW_UNAVAILABLE");
  }
};
