import { validateStoredSubjectIdList } from "./portraitCartPolicy";
import { StorefrontApiError } from "../storefront/storefrontApiError";

const MEBIBYTE = 1024 * 1024;

export const PORTRAIT_UPLOAD_POLICY = Object.freeze({
  maximumBytesPerCart: 100 * MEBIBYTE,
  maximumBytesPerPortrait: 30 * MEBIBYTE,
  maximumFilesPerCart: 15,
  maximumFilesPerPortrait: 3,
  maximumPixels: 50_000_000,
  perFileUploadLimitBytes: 15 * MEBIBYTE,
});

export type PortraitUploadMetadata = {
  position: number;
  subjectIds: string[];
};

export type PortraitPhotoState = PortraitUploadMetadata & {
  filesize: number;
  id: number;
};

const exactKeys = (value: object, keys: string[]) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
};

const requireNonNegativeInteger = (value: unknown, code: string) => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new StorefrontApiError(500, code);
  }
  return Number(value);
};

export const parsePortraitUploadMetadata = (
  value: unknown,
): PortraitUploadMetadata => {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !exactKeys(value, ["position", "subjectIds"])
  ) {
    throw new StorefrontApiError(400, "INVALID_REQUEST");
  }
  const input = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(input.position) ||
    Number(input.position) < 1 ||
    Number(input.position) > PORTRAIT_UPLOAD_POLICY.maximumFilesPerPortrait
  ) {
    throw new StorefrontApiError(422, "INVALID_PHOTO_POSITION");
  }
  return {
    position: Number(input.position),
    subjectIds: validateStoredSubjectIdList(input.subjectIds)!,
  };
};

export const validatePortraitPhotoSet = ({
  photos,
  subjectIds,
}: {
  photos: PortraitPhotoState[];
  subjectIds: unknown[];
}) => {
  const knownSubjects = validateStoredSubjectIdList(subjectIds)!;
  if (
    !Array.isArray(photos) ||
    photos.length > PORTRAIT_UPLOAD_POLICY.maximumFilesPerPortrait ||
    photos.length > knownSubjects.length
  ) {
    throw new StorefrontApiError(422, "INVALID_PHOTO_COUNT");
  }

  const known = new Set(knownSubjects);
  const covered = new Set<string>();
  let totalBytes = 0;
  for (const [index, photo] of photos.entries()) {
    if (
      !Number.isSafeInteger(photo.id) ||
      photo.id <= 0 ||
      photo.position !== index + 1 ||
      !Number.isSafeInteger(photo.filesize) ||
      photo.filesize <= 0
    ) {
      throw new StorefrontApiError(500, "INVALID_PHOTO_STATE");
    }
    const mapped = validateStoredSubjectIdList(photo.subjectIds)!;
    for (const subjectId of mapped) {
      if (!known.has(subjectId)) {
        throw new StorefrontApiError(422, "UNKNOWN_PHOTO_SUBJECT");
      }
      covered.add(subjectId);
    }
    totalBytes += photo.filesize;
    if (
      !Number.isSafeInteger(totalBytes) ||
      totalBytes > PORTRAIT_UPLOAD_POLICY.maximumBytesPerPortrait
    ) {
      throw new StorefrontApiError(413, "PORTRAIT_UPLOAD_SIZE_LIMIT");
    }
  }

  const coveredSubjectIds = knownSubjects.filter((id) => covered.has(id));
  return {
    coveredSubjectIds,
    complete: coveredSubjectIds.length === knownSubjects.length,
    totalBytes,
  };
};

export const assertPortraitSubjectEditCompatible = (input: {
  photos: PortraitPhotoState[];
  subjectIds: unknown[];
}) => {
  try {
    return validatePortraitPhotoSet(input);
  } catch (error) {
    if (
      error instanceof StorefrontApiError &&
      ["INVALID_PHOTO_COUNT", "UNKNOWN_PHOTO_SUBJECT"].includes(error.code)
    ) {
      throw new StorefrontApiError(409, "PORTRAIT_UPLOAD_MAPPING_CONFLICT");
    }
    throw error;
  }
};

export const assertPortraitUploadCapacity = ({
  cartFiles,
  cartStoredBytes,
  incomingStoredBytes,
  portraitFiles,
  portraitStoredBytes,
  subjectCount,
}: {
  cartFiles: number;
  cartStoredBytes: number;
  incomingStoredBytes: number;
  portraitFiles: number;
  portraitStoredBytes: number;
  subjectCount: number;
}) => {
  const safeCartFiles = requireNonNegativeInteger(
    cartFiles,
    "INVALID_UPLOAD_STATE",
  );
  const safePortraitFiles = requireNonNegativeInteger(
    portraitFiles,
    "INVALID_UPLOAD_STATE",
  );
  const safeCartBytes = requireNonNegativeInteger(
    cartStoredBytes,
    "INVALID_UPLOAD_STATE",
  );
  const safePortraitBytes = requireNonNegativeInteger(
    portraitStoredBytes,
    "INVALID_UPLOAD_STATE",
  );
  if (
    !Number.isSafeInteger(subjectCount) ||
    subjectCount < 1 ||
    subjectCount > PORTRAIT_UPLOAD_POLICY.maximumFilesPerPortrait
  ) {
    throw new StorefrontApiError(500, "INVALID_UPLOAD_STATE");
  }
  if (
    !Number.isSafeInteger(incomingStoredBytes) ||
    incomingStoredBytes <= 0 ||
    incomingStoredBytes > PORTRAIT_UPLOAD_POLICY.perFileUploadLimitBytes
  ) {
    throw new StorefrontApiError(413, "FILE_TOO_LARGE");
  }
  if (safeCartFiles >= PORTRAIT_UPLOAD_POLICY.maximumFilesPerCart) {
    throw new StorefrontApiError(409, "CART_UPLOAD_COUNT_LIMIT");
  }
  if (
    safePortraitFiles >= PORTRAIT_UPLOAD_POLICY.maximumFilesPerPortrait ||
    safePortraitFiles >= subjectCount
  ) {
    throw new StorefrontApiError(409, "PORTRAIT_UPLOAD_COUNT_LIMIT");
  }
  if (
    safePortraitBytes + incomingStoredBytes >
    PORTRAIT_UPLOAD_POLICY.maximumBytesPerPortrait
  ) {
    throw new StorefrontApiError(413, "PORTRAIT_UPLOAD_SIZE_LIMIT");
  }
  if (
    safeCartBytes + incomingStoredBytes >
    PORTRAIT_UPLOAD_POLICY.maximumBytesPerCart
  ) {
    throw new StorefrontApiError(413, "CART_UPLOAD_SIZE_LIMIT");
  }
};
