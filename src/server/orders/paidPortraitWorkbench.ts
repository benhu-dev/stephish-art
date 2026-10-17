import type { PayloadRequest } from "payload";
import type {
  OrderWorkbenchPortrait,
  OrderWorkbenchUpload,
} from "../../components/admin/orders/orderWorkbenchContract";
import { validateStoredPortraitSubjects } from "../cart/portraitCartPolicy";
import { validatePortraitPhotoSet } from "../cart/portraitUploadPolicy";

export const readPaidPortraitWorkbench = async (
  request: PayloadRequest,
  orderId: number,
  uploads: OrderWorkbenchUpload[],
  expectedSubtotal: number,
): Promise<OrderWorkbenchPortrait[]> => {
  const result = await request.payload.find({
    collection: "order-portraits",
    depth: 0,
    limit: 6,
    pagination: false,
    overrideAccess: false,
    req: request,
    sort: "position",
    where: { order: { equals: orderId } },
  });
  if (!result.docs.length || result.docs.length > 5)
    throw new Error("ORDER_UNAVAILABLE");
  const known = new Set<number>();
  let subtotal = 0;
  const portraits = result.docs.map((p, index) => {
    const subjects = validateStoredPortraitSubjects(p.subjects);
    if (
      p.position !== index + 1 ||
      p.amountCents !== 2000 + (subjects.length - 1) * 500 ||
      !p.templateName ||
      !p.templatePreviewAlt ||
      typeof p.templatePreviewMedia !== "number"
    )
      throw new Error("ORDER_UNAVAILABLE");
    known.add(p.id);
    subtotal += p.amountCents;
    const photos = uploads
      .filter((u) => u.orderPortraitId === p.id)
      .sort((a, b) => a.position - b.position);
    const state = validatePortraitPhotoSet({
      photos: photos.map((u) => ({
        ...u,
        filesize: u.sizeBytes!,
        subjectIds: u.subjectIds!,
      })),
      subjectIds: subjects.map((s) => s.subjectId),
    });
    if (!state.complete) throw new Error("ORDER_UNAVAILABLE");
    return {
      id: p.id,
      position: p.position,
      templateName: p.templateName,
      templateDescription: p.templateDescription ?? null,
      templatePreviewAlt: p.templatePreviewAlt,
      templatePreviewUrl: `/api/admin/orders/${orderId}/portraits/${p.id}/template-preview`,
      subjects: subjects.map((s) => ({
        id: s.subjectId,
        name: s.name,
        kind: s.kind,
      })),
      artistNote: p.artistNote ?? null,
      amount: new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(p.amountCents / 100),
      uploads: photos,
    };
  });
  if (
    subtotal !== expectedSubtotal ||
    uploads.some((u) => !u.orderPortraitId || !known.has(u.orderPortraitId))
  )
    throw new Error("ORDER_UNAVAILABLE");
  return portraits;
};
