import { isDeepStrictEqual } from "node:util";
import type { PayloadRequest } from "payload";
import type { WebhookUpload } from "../stripe/stripeWebhookPersistence";
import {
  validatePortraitPaymentSnapshot,
  type PortraitPaymentSnapshot,
} from "./portraitPaymentSnapshot";

export const portraitOrderFacts = (snapshot: PortraitPaymentSnapshot) => ({
  version: snapshot.version,
  policyVersion: snapshot.policyVersion,
  policyAcceptedAt: snapshot.policyAcceptedAt,
  shipping: snapshot.shipping,
  subtotalCents: snapshot.subtotalCents,
  totalCents: snapshot.totalCents,
  portraitCount: snapshot.portraits.length,
});

export const frozenPhotosMatchUploads = (
  snapshot: PortraitPaymentSnapshot,
  uploads: WebhookUpload[],
) => {
  if (uploads.length !== snapshot.photos.length) return false;
  const expected = new Map(snapshot.photos.map((p) => [p.id, p]));
  const seen = new Set<number>();
  return uploads.every((u) => {
    if (seen.has(u.id)) return false;
    seen.add(u.id);
    return isDeepStrictEqual(expected.get(u.id), {
      checkoutPortraitId: u.checkoutPortraitId,
      filename: u.filename,
      filesize: u.filesize,
      height: u.height,
      id: u.id,
      mimeType: u.mimeType,
      position: u.position,
      subjectIds: u.subjectIds,
      width: u.width,
    });
  });
};

export const readValidPortraitSnapshot = (value: unknown) => {
  try {
    return validatePortraitPaymentSnapshot(value);
  } catch {
    return null;
  }
};

export const createPaidPortraits = async (
  request: PayloadRequest,
  orderId: number,
  snapshot: PortraitPaymentSnapshot,
) => {
  const orderPortraitIds = new Map<number, number>();
  for (const p of snapshot.portraits) {
    const { checkoutPortraitId, ...data } = p;
    const created = await request.payload.create({
      collection: "order-portraits",
      data: { ...data, order: orderId },
      depth: 0,
      overrideAccess: true,
      req: request,
    });
    orderPortraitIds.set(checkoutPortraitId, Number(created.id));
  }
  return orderPortraitIds;
};

export const paidPortraitGraphMatches = async ({
  request,
  orderId,
  snapshot,
  uploads,
  facts,
}: {
  request: PayloadRequest;
  orderId: number;
  snapshot: PortraitPaymentSnapshot;
  uploads: WebhookUpload[];
  facts: unknown;
}) => {
  if (
    !isDeepStrictEqual(facts, portraitOrderFacts(snapshot)) ||
    !frozenPhotosMatchUploads(snapshot, uploads)
  )
    return false;
  const result = await request.payload.find({
    collection: "order-portraits",
    depth: 0,
    limit: 6,
    pagination: false,
    sort: "position",
    where: { order: { equals: orderId } },
    overrideAccess: true,
    req: request,
  });
  if (result.docs.length !== snapshot.portraits.length) return false;
  return snapshot.portraits.every((p, index) => {
    const actual = result.docs[index];
    const { checkoutPortraitId, ...expected } = p;
    const persisted = {
      amountCents: actual.amountCents,
      artistNote: actual.artistNote ?? null,
      position: actual.position,
      sourceCheckoutPortraitId: actual.sourceCheckoutPortraitId,
      subjects: actual.subjects.map(({ kind, name, position, subjectId }) => ({
        kind,
        name,
        position,
        subjectId,
      })),
      templateDescription: actual.templateDescription ?? null,
      templateId: actual.templateId,
      templateName: actual.templateName,
      templatePreviewAlt: actual.templatePreviewAlt,
      templatePreviewMedia: actual.templatePreviewMedia,
    };
    return (
      isDeepStrictEqual(persisted, expected) &&
      uploads
        .filter((u) => u.checkoutPortraitId === checkoutPortraitId)
        .every(
          (u) =>
            u.orderId === orderId && u.orderPortraitId === Number(actual.id),
        )
    );
  });
};
