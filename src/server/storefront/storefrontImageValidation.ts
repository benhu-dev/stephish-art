import sharp from "sharp";

import { CHECKOUT_INTENT_POLICY } from "../checkout-intents/checkoutIntentPolicy";
import { StorefrontApiError } from "./storefrontApiError";

const MAXIMUM_PIXELS = 100_000_000;

type DetectedImage = {
  extension: "jpg" | "png" | "webp";
  mimeType: "image/jpeg" | "image/png" | "image/webp";
};

export const detectImageContent = (data: Buffer): DetectedImage => {
  if (
    data.length >= 3 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff
  ) {
    return { extension: "jpg", mimeType: "image/jpeg" };
  }
  if (
    data.length >= 8 &&
    data.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  ) {
    return { extension: "png", mimeType: "image/png" };
  }
  if (
    data.length >= 12 &&
    data.toString("ascii", 0, 4) === "RIFF" &&
    data.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { extension: "webp", mimeType: "image/webp" };
  }

  throw new StorefrontApiError(422, "INVALID_IMAGE");
};

export const detectAndValidateImage = async (
  data: Buffer,
  declaredMimeType: string,
) => {
  if (
    data.length === 0 ||
    data.length > CHECKOUT_INTENT_POLICY.perFileUploadLimitBytes
  ) {
    throw new StorefrontApiError(
      data.length === 0 ? 422 : 413,
      data.length === 0 ? "EMPTY_FILE" : "FILE_TOO_LARGE",
    );
  }

  const detected = detectImageContent(data);
  if (declaredMimeType !== detected.mimeType) {
    throw new StorefrontApiError(422, "IMAGE_TYPE_MISMATCH");
  }

  try {
    const image = sharp(data, { failOn: "error", limitInputPixels: false });
    const metadata = await image.metadata();
    const { height, width } = metadata;
    if (
      metadata.format !== detected.extension.replace("jpg", "jpeg") ||
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      !width ||
      !height
    ) {
      throw new StorefrontApiError(422, "INVALID_IMAGE");
    }
    if (width * height > MAXIMUM_PIXELS) {
      throw new StorefrontApiError(422, "IMAGE_PIXEL_LIMIT");
    }

    await sharp(data, {
      failOn: "error",
      limitInputPixels: MAXIMUM_PIXELS,
    })
      .resize(1, 1, { fit: "fill" })
      .toBuffer();

    return { ...detected, height, width };
  } catch (error) {
    if (error instanceof StorefrontApiError) throw error;
    throw new StorefrontApiError(422, "INVALID_IMAGE");
  }
};
