import sharp from "sharp";

import { detectImageContent } from "../storefront/storefrontImageValidation";
import { StorefrontApiError } from "../storefront/storefrontApiError";
import { PORTRAIT_UPLOAD_POLICY } from "./portraitUploadPolicy";

type ImageMetadataShape = {
  height?: number;
  pages?: number;
  width?: number;
};

export const assertSingleFrameImage = (metadata: ImageMetadataShape) => {
  if ((metadata.pages ?? 1) !== 1) {
    throw new StorefrontApiError(422, "ANIMATED_IMAGE_NOT_ALLOWED");
  }
  if (metadata.width !== undefined || metadata.height !== undefined) {
    if (
      !Number.isSafeInteger(metadata.width) ||
      !Number.isSafeInteger(metadata.height) ||
      !metadata.width ||
      !metadata.height
    ) {
      throw new StorefrontApiError(422, "INVALID_IMAGE");
    }
    if (metadata.width * metadata.height > PORTRAIT_UPLOAD_POLICY.maximumPixels) {
      throw new StorefrontApiError(422, "IMAGE_PIXEL_LIMIT");
    }
  }
};

export const normalizePortraitReferenceImage = async (
  source: Buffer,
  declaredMimeType: string,
) => {
  if (
    source.length === 0 ||
    source.length > PORTRAIT_UPLOAD_POLICY.perFileUploadLimitBytes
  ) {
    throw new StorefrontApiError(
      source.length === 0 ? 422 : 413,
      source.length === 0 ? "EMPTY_FILE" : "FILE_TOO_LARGE",
    );
  }
  const detected = detectImageContent(source);
  if (declaredMimeType !== detected.mimeType) {
    throw new StorefrontApiError(422, "IMAGE_TYPE_MISMATCH");
  }

  try {
    const metadata = await sharp(source, {
      animated: true,
      failOn: "error",
      limitInputPixels: false,
    }).metadata();
    const expectedFormat = detected.extension === "jpg" ? "jpeg" : detected.extension;
    if (metadata.format !== expectedFormat) {
      throw new StorefrontApiError(422, "INVALID_IMAGE");
    }
    assertSingleFrameImage(metadata);

    let output = sharp(source, {
      animated: false,
      failOn: "error",
      limitInputPixels: PORTRAIT_UPLOAD_POLICY.maximumPixels,
    }).rotate();
    if (detected.extension === "jpg") {
      output = output.jpeg({
        chromaSubsampling: "4:4:4",
        quality: 95,
      });
    } else if (detected.extension === "png") {
      output = output.png({ adaptiveFiltering: true, compressionLevel: 9 });
    } else {
      output = output.webp({ effort: 5, quality: 95 });
    }
    const normalized = await output.toBuffer({ resolveWithObject: true });
    if (
      normalized.data.length === 0 ||
      normalized.data.length > PORTRAIT_UPLOAD_POLICY.perFileUploadLimitBytes
    ) {
      throw new StorefrontApiError(413, "FILE_TOO_LARGE");
    }
    assertSingleFrameImage({
      height: normalized.info.height,
      pages: 1,
      width: normalized.info.width,
    });

    return {
      data: normalized.data,
      extension: detected.extension,
      height: normalized.info.height,
      mimeType: detected.mimeType,
      size: normalized.data.length,
      width: normalized.info.width,
    };
  } catch (error) {
    if (error instanceof StorefrontApiError) throw error;
    throw new StorefrontApiError(422, "INVALID_IMAGE");
  }
};
