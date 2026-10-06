import { APIError, type PayloadRequest } from "payload";

import { detectAndValidateImage } from "../storefront/storefrontImageValidation";

export const TEMPLATE_MEDIA_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const TEMPLATE_MEDIA_PREFIX = "template-media";
export const TEMPLATE_MEDIA_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

const allowedMimeTypes = new Set<string>(TEMPLATE_MEDIA_MIME_TYPES);

export const validateTemplateMediaFile = async (
  file: NonNullable<PayloadRequest["file"]>,
) => {
  if (
    file.size <= 0 ||
    file.size > TEMPLATE_MEDIA_MAX_FILE_SIZE_BYTES ||
    !allowedMimeTypes.has(file.mimetype)
  ) {
    throw new APIError(
      "Template preview must be a JPEG, PNG, or WebP image no larger than 10 MiB.",
      422,
      null,
      true,
    );
  }

  try {
    await detectAndValidateImage(file.data, file.mimetype);
  } catch {
    throw new APIError(
      "Template preview must be a valid JPEG, PNG, or WebP raster image.",
      422,
      null,
      true,
    );
  }
};
