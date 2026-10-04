import type { PayloadRequest } from "payload";

import { formatNewYorkBusinessDateTime } from "../../lib/newYorkTime";
import {
  FULFILLMENT_STATES,
  TRACKING_CARRIERS,
  type FulfillmentState,
  type TrackingCarrier,
} from "./orderFulfillmentContract";
import type {
  OrderWorkbenchData,
  OrderWorkbenchUpload,
} from "../../components/admin/orders/orderWorkbenchContract";

const allowedMimeTypes = new Set<OrderWorkbenchUpload["mimeType"]>([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const relationId = (value: unknown) => {
  const candidate =
    typeof value === "object" && value !== null && "id" in value
      ? (value as { id?: unknown }).id
      : value;
  const id = Number(candidate);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("ORDER_UNAVAILABLE");
  return id;
};

const requiredString = (value: unknown) => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("ORDER_UNAVAILABLE");
  }
  return value;
};

const optionalString = (value: unknown) =>
  value === null || value === undefined || value === ""
    ? null
    : requiredString(value);

const cents = (value: unknown, allowZero = false) => {
  const amount = Number(value);
  if (
    !Number.isSafeInteger(amount) ||
    amount < (allowZero ? 0 : 1)
  ) {
    throw new Error("ORDER_UNAVAILABLE");
  }
  return amount;
};

const usd = (value: number) =>
  new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value / 100);

const formattedDate = (value: unknown) => {
  const text = optionalString(value);
  if (!text) return null;
  return formatNewYorkBusinessDateTime(new Date(text));
};

export const readOrderWorkbench = async ({
  orderId,
  request,
}: {
  orderId: number;
  request: PayloadRequest;
}): Promise<OrderWorkbenchData> => {
  if (request.user?.collection !== "users") throw new Error("UNAUTHORIZED");

  const order = await request.payload.findByID({
    collection: "orders",
    depth: 0,
    id: orderId,
    overrideAccess: false,
    req: request,
    select: {
      amountCents: true,
      artistNote: true,
      checkoutIntent: true,
      contactEmail: true,
      createdAt: true,
      customer: true,
      deliveredAt: true,
      orderStatus: true,
      refundState: true,
      refundedAmountCents: true,
      shippedAt: true,
      shippingAddress: true,
      stripeDisputeStatus: true,
      trackingCarrier: true,
      trackingNumber: true,
    },
  });
  const customerId = relationId(order.customer);
  const checkoutIntentId = relationId(order.checkoutIntent);

  const [customer, intent, uploadResult] = await Promise.all([
    request.payload.findByID({
      collection: "customers",
      depth: 0,
      id: customerId,
      overrideAccess: false,
      req: request,
      select: { fullName: true },
    }),
    request.payload.findByID({
      collection: "checkout-intents",
      depth: 0,
      id: checkoutIntentId,
      // The price split is an internal immutable snapshot. This small
      // server-only read derives display totals without exposing the hidden row.
      overrideAccess: true,
      req: request,
      select: {
        amountCents: true,
        shippingAmountCents: true,
        totalAmountCents: true,
      },
    }),
    request.payload.find({
      collection: "order-uploads",
      depth: 0,
      limit: 3,
      overrideAccess: false,
      pagination: false,
      req: request,
      select: { id: true, mimeType: true, position: true },
      sort: "position",
      where: { order: { equals: orderId } },
    }),
  ]);

  const subtotal = cents(intent.amountCents);
  const shipping = cents(intent.shippingAmountCents, true);
  const total = cents(intent.totalAmountCents);
  if (subtotal + shipping !== total || cents(order.amountCents) !== total) {
    throw new Error("ORDER_UNAVAILABLE");
  }

  const state = requiredString(order.orderStatus);
  if (!(FULFILLMENT_STATES as readonly string[]).includes(state)) {
    throw new Error("ORDER_UNAVAILABLE");
  }
  const carrier = optionalString(order.trackingCarrier);
  const trackingNumber = optionalString(order.trackingNumber);
  if (
    Boolean(carrier) !== Boolean(trackingNumber) ||
    (carrier && !(TRACKING_CARRIERS as readonly string[]).includes(carrier))
  ) {
    throw new Error("ORDER_UNAVAILABLE");
  }

  const address = order.shippingAddress;
  if (!address || typeof address !== "object") throw new Error("ORDER_UNAVAILABLE");

  const uploads = uploadResult.docs.map((upload) => {
    const id = relationId(upload.id);
    const position = Number(upload.position);
    const mimeType = upload.mimeType;
    if (
      !Number.isInteger(position) ||
      position < 1 ||
      position > 3 ||
      typeof mimeType !== "string" ||
      !allowedMimeTypes.has(mimeType as OrderWorkbenchUpload["mimeType"])
    ) {
      throw new Error("ORDER_UNAVAILABLE");
    }
    return { id, mimeType, position } as OrderWorkbenchUpload;
  });

  return {
    amounts: {
      shipping: usd(shipping),
      subtotal: usd(subtotal),
      total: usd(total),
    },
    artistNote: optionalString(order.artistNote),
    customer: {
      email: requiredString(order.contactEmail),
      name: requiredString(customer.fullName),
    },
    fulfillment: {
      orderStatus: state as FulfillmentState,
      refundState: requiredString(order.refundState),
      refundedAmount: usd(cents(order.refundedAmountCents, true)),
      stripeDisputeStatus: optionalString(order.stripeDisputeStatus),
      tracking:
        carrier && trackingNumber
          ? { carrier: carrier as TrackingCarrier, trackingNumber }
          : null,
    },
    orderId,
    shippingAddress: {
      city: requiredString(address.city),
      country: requiredString(address.country),
      line1: requiredString(address.line1),
      line2: optionalString(address.line2),
      postalCode: optionalString(address.postalCode),
      recipientName: requiredString(address.recipientName),
      state: optionalString(address.state),
    },
    timestamps: {
      created: formattedDate(order.createdAt)!,
      delivered: formattedDate(order.deliveredAt),
      shipped: formattedDate(order.shippedAt),
    },
    uploads,
  };
};
