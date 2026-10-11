import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import {
  assertSingleFrameImage,
  normalizePortraitReferenceImage,
} from "../../src/server/cart/portraitImageNormalization.ts";
import { StorefrontApiError } from "../../src/server/storefront/storefrontApiError.ts";

test("portrait JPEG normalization auto-orients and strips source metadata", async () => {
  const source = await sharp({
    create: {
      background: { b: 180, g: 90, r: 30 },
      channels: 3,
      height: 20,
      width: 40,
    },
  })
    .jpeg({ quality: 95 })
    .withMetadata({ orientation: 6 })
    .toBuffer();

  const result = await normalizePortraitReferenceImage(source, "image/jpeg");
  const metadata = await sharp(result.data).metadata();

  assert.equal(result.mimeType, "image/jpeg");
  assert.equal(result.extension, "jpg");
  assert.equal(result.width, 20);
  assert.equal(result.height, 40);
  assert.equal(metadata.orientation, undefined);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.xmp, undefined);
  assert.equal(metadata.pages ?? 1, 1);
});

test("single-frame validation rejects animated or multipage metadata", () => {
  assert.doesNotThrow(() => assertSingleFrameImage({ pages: 1 }));
  assert.throws(
    () => assertSingleFrameImage({ pages: 2 }),
    (error) =>
      error instanceof StorefrontApiError &&
      error.code === "ANIMATED_IMAGE_NOT_ALLOWED",
  );
});

test("portrait normalization rejects MIME spoofing and the 50MP boundary", async () => {
  const png = await sharp({
    create: {
      background: { alpha: 1, b: 0, g: 0, r: 0 },
      channels: 4,
      height: 2,
      width: 2,
    },
  })
    .png()
    .toBuffer();

  await assert.rejects(
    normalizePortraitReferenceImage(png, "image/jpeg"),
    (error) =>
      error instanceof StorefrontApiError &&
      error.code === "IMAGE_TYPE_MISMATCH",
  );
  assert.throws(
    () => assertSingleFrameImage({ height: 10_000, pages: 1, width: 5_001 }),
    (error) =>
      error instanceof StorefrontApiError && error.code === "IMAGE_PIXEL_LIMIT",
  );
});
