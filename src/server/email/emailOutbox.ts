import type { PayloadRequest } from "payload";

export const ORDER_EMAIL_OUTBOX_KINDS = [
  "customer_order_confirmation",
  "artist_new_order",
] as const;

export type OrderEmailOutboxKind = (typeof ORDER_EMAIL_OUTBOX_KINDS)[number];

export const createOrderEmailOutboxJobs = async ({
  afterFirstJob,
  orderId,
  request,
}: {
  afterFirstJob?: () => Promise<void> | void;
  orderId: number;
  request: PayloadRequest;
}) => {
  for (const [index, kind] of ORDER_EMAIL_OUTBOX_KINDS.entries()) {
    await request.payload.create({
      collection: "email-outbox",
      data: {
        attempts: 0,
        kind,
        order: orderId,
        status: "pending",
      },
      depth: 0,
      overrideAccess: true,
      req: request,
    });

    if (index === 0) await afterFirstJob?.();
  }
};
