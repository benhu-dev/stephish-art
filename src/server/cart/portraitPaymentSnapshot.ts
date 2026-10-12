import { buildOrderPortraitSnapshot } from "./orderPortraitSnapshot";
import { calculateCartSubtotalCents } from "./portraitCartPolicy";
import {
  PORTRAIT_UPLOAD_POLICY,
  validatePortraitPhotoSet,
} from "./portraitUploadPolicy";
import {
  PORTRAIT_POLICY_VERSION,
  PORTRAIT_SHIPPING_COUNTRIES,
  portraitShipping,
  type PortraitShippingRegion,
} from "./portraitShippingPolicy";
import { StorefrontApiError } from "../storefront/storefrontApiError";

export type ReservedPortrait = Omit<
  ReturnType<typeof buildOrderPortraitSnapshot>,
  "order"
> & {
  checkoutPortraitId: number;
};
export type ReservedPhoto = {
  checkoutPortraitId: number;
  filename: string;
  filesize: number;
  height: number;
  id: number;
  mimeType: string;
  position: number;
  subjectIds: string[];
  width: number;
};
export type PortraitPaymentSnapshot = {
  version: 1;
  policyVersion: typeof PORTRAIT_POLICY_VERSION;
  policyAcceptedAt: string;
  shipping: ReturnType<typeof portraitShipping>;
  subtotalCents: number;
  totalCents: number;
  portraits: ReservedPortrait[];
  photos: ReservedPhoto[];
};

const invalid = () =>
  new StorefrontApiError(500, "INVALID_PORTRAIT_PAYMENT_SNAPSHOT");
const positive = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;

// Rebuild the snapshot from validated primitives rather than trusting stored JSON.
export const validatePortraitPaymentSnapshot = (
  value: unknown,
): PortraitPaymentSnapshot => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw invalid();
  const s = value as PortraitPaymentSnapshot;
  if (
    s.version !== 1 ||
    s.policyVersion !== PORTRAIT_POLICY_VERSION ||
    typeof s.policyAcceptedAt !== "string" ||
    !Number.isFinite(Date.parse(s.policyAcceptedAt)) ||
    !Array.isArray(s.portraits) ||
    !Array.isArray(s.photos) ||
    !s.shipping
  )
    throw invalid();
  if (
    !Array.isArray(s.shipping.allowedCountries) ||
    s.shipping.allowedCountries.length < 1 ||
    new Set(s.shipping.allowedCountries).size !==
      s.shipping.allowedCountries.length ||
    s.shipping.allowedCountries.some(
      (c) => typeof c !== "string" || !PORTRAIT_SHIPPING_COUNTRIES.includes(c),
    )
  )
    throw invalid();
  const shipping = portraitShipping(s.shipping.region);
  // Preserve the frozen allowlist across future policy changes; never expand on retry.
  if (
    s.shipping.amountCents !== shipping.amountCents ||
    s.shipping.tracked !== shipping.tracked ||
    s.shipping.label !== shipping.label ||
    (shipping.region === "us"
      ? s.shipping.allowedCountries.join(",") !== "US"
      : s.shipping.allowedCountries.includes("US"))
  )
    throw invalid();
  const ids = new Set<number>();
  const publicIds = new Set<string>();
  const portraits = s.portraits.map((p, index) => {
    if (
      !p ||
      !positive(p.checkoutPortraitId) ||
      ids.has(p.checkoutPortraitId) ||
      publicIds.has(p.sourceCheckoutPortraitId) ||
      p.position !== index + 1
    )
      throw invalid();
    const { order: _order, ...rebuilt } = buildOrderPortraitSnapshot({
      orderId: 1,
      portrait: {
        publicId: p.sourceCheckoutPortraitId,
        position: p.position,
        subjects: p.subjects,
        amountCents: p.amountCents,
        artistNote: p.artistNote,
        template: {
          id: p.templateId,
          name: p.templateName,
          description: p.templateDescription,
          previewMedia: {
            id: p.templatePreviewMedia,
            alt: p.templatePreviewAlt,
          },
        },
      },
    });
    void _order;
    ids.add(p.checkoutPortraitId);
    publicIds.add(p.sourceCheckoutPortraitId);
    return { ...rebuilt, checkoutPortraitId: p.checkoutPortraitId };
  });
  const subtotalCents = calculateCartSubtotalCents(
    portraits.map((p) => p.amountCents),
  );
  if (
    s.subtotalCents !== subtotalCents ||
    s.totalCents !== subtotalCents + shipping.amountCents ||
    s.photos.length < 1 ||
    s.photos.length > PORTRAIT_UPLOAD_POLICY.maximumFilesPerCart
  )
    throw invalid();
  const photoIds = new Set<number>();
  let totalBytes = 0;
  const photos = s.photos.map((p) => {
    if (
      !p ||
      !positive(p.id) ||
      photoIds.has(p.id) ||
      !ids.has(p.checkoutPortraitId) ||
      typeof p.filename !== "string" ||
      !p.filename ||
      !["image/jpeg", "image/png", "image/webp"].includes(p.mimeType) ||
      !positive(p.filesize) ||
      p.filesize > PORTRAIT_UPLOAD_POLICY.perFileUploadLimitBytes ||
      !positive(p.width) ||
      !positive(p.height) ||
      p.width * p.height > PORTRAIT_UPLOAD_POLICY.maximumPixels ||
      !Array.isArray(p.subjectIds)
    )
      throw invalid();
    photoIds.add(p.id);
    totalBytes += p.filesize;
    return {
      checkoutPortraitId: p.checkoutPortraitId,
      filename: p.filename,
      filesize: p.filesize,
      height: p.height,
      id: p.id,
      mimeType: p.mimeType,
      position: p.position,
      subjectIds: [...p.subjectIds],
      width: p.width,
    };
  });
  if (totalBytes > PORTRAIT_UPLOAD_POLICY.maximumBytesPerCart) throw invalid();
  for (const p of portraits) {
    const state = validatePortraitPhotoSet({
      photos: photos
        .filter((photo) => photo.checkoutPortraitId === p.checkoutPortraitId)
        .sort((a, b) => a.position - b.position),
      subjectIds: p.subjects.map((subject) => subject.subjectId),
    });
    if (!state.complete)
      throw new StorefrontApiError(422, "PORTRAIT_PHOTO_COVERAGE_REQUIRED");
  }
  return {
    version: 1,
    policyVersion: PORTRAIT_POLICY_VERSION,
    policyAcceptedAt: s.policyAcceptedAt,
    shipping: {
      ...shipping,
      allowedCountries: [...s.shipping.allowedCountries],
    },
    subtotalCents,
    totalCents: s.totalCents,
    portraits,
    photos,
  };
};

export const buildPortraitPaymentSnapshot = ({
  portraits,
  uploads,
  region,
  now,
}: {
  portraits: Record<string, unknown>[];
  uploads: Record<string, unknown>[];
  region: PortraitShippingRegion;
  now: Date;
}) => {
  const reserved = portraits.map((portrait) => {
    const template = portrait.template as Record<string, unknown> | null;
    if (!template || template.available !== true)
      throw new StorefrontApiError(422, "TEMPLATE_UNAVAILABLE");
    const { order: _order, ...snapshot } = buildOrderPortraitSnapshot({
      orderId: 1,
      portrait,
    });
    void _order;
    return { ...snapshot, checkoutPortraitId: Number(portrait.id) };
  });
  const shipping = portraitShipping(region);
  const subtotalCents = calculateCartSubtotalCents(
    reserved.map((p) => p.amountCents),
  );
  return validatePortraitPaymentSnapshot({
    version: 1,
    policyVersion: PORTRAIT_POLICY_VERSION,
    policyAcceptedAt: now.toISOString(),
    shipping,
    subtotalCents,
    totalCents: subtotalCents + shipping.amountCents,
    portraits: reserved,
    photos: uploads.map((u) => ({
      checkoutPortraitId: Number(u.checkoutPortrait),
      filename: u.filename,
      filesize: u.filesize,
      height: u.height,
      id: Number(u.id),
      mimeType: u.mimeType,
      position: u.position,
      subjectIds: u.subjectIds,
      width: u.width,
    })),
  });
};
