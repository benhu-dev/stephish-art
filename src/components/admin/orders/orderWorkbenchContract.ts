import type {
  FulfillmentState,
  TrackingCarrier,
} from "../../../server/orders/orderFulfillmentContract";

export type OrderWorkbenchUpload = {
  id: number;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  position: number;
};

export type OrderWorkbenchData = {
  amounts: {
    shipping: string;
    subtotal: string;
    total: string;
  };
  artistNote: string | null;
  customer: {
    email: string;
    name: string;
  };
  fulfillment: {
    orderStatus: FulfillmentState;
    refundState: string;
    refundedAmount: string;
    stripeDisputeStatus: string | null;
    tracking: null | {
      carrier: TrackingCarrier;
      trackingNumber: string;
    };
  };
  orderId: number;
  shippingAddress: {
    city: string;
    country: string;
    line1: string;
    line2: string | null;
    postalCode: string | null;
    recipientName: string;
    state: string | null;
  };
  timestamps: {
    created: string;
    delivered: string | null;
    shipped: string | null;
  };
  uploads: OrderWorkbenchUpload[];
};

const actions: Record<
  FulfillmentState,
  { label: string; nextState: FulfillmentState } | null
> = {
  delivered: null,
  in_progress: { label: "Mark Ready to Ship", nextState: "ready_to_ship" },
  ready_to_ship: { label: "Mark Shipped", nextState: "shipped" },
  shipped: { label: "Mark Delivered", nextState: "delivered" },
  unfulfilled: { label: "Start Work", nextState: "in_progress" },
};

const resolvedDisputes = new Set(["prevented", "warning_closed", "won"]);

export const fulfillmentActionFor = (state: FulfillmentState) => actions[state];

export const fulfillmentWarningFor = ({
  refundState,
  stripeDisputeStatus,
}: Pick<OrderWorkbenchData["fulfillment"], "refundState" | "stripeDisputeStatus">) => {
  if (refundState === "full") {
    return "Fulfillment is blocked because this order has been fully refunded.";
  }
  if (stripeDisputeStatus && !resolvedDisputes.has(stripeDisputeStatus)) {
    return `Fulfillment is blocked while the payment dispute is ${stripeDisputeStatus.replaceAll("_", " ")}.`;
  }
  return null;
};

export const extensionForMimeType = (
  mimeType: OrderWorkbenchUpload["mimeType"],
) => (mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1]);
