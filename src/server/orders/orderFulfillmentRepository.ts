import { sql } from "@payloadcms/db-postgres";
import type { PayloadRequest } from "payload";
import { createCustomerShippedEmailOutboxJob } from "../email/emailOutbox";

import {
  beginStorefrontTransaction,
  commitStorefrontTransaction,
  rollbackStorefrontTransaction,
  type StorefrontTransaction,
} from "../storefront/storefrontTransaction";
import type {
  FulfillmentState,
  TrackingCarrier,
} from "./orderFulfillmentContract";

export type LockedFulfillmentOrder = {
  amountCents: number;
  deliveredAt: string | null;
  id: number;
  orderStatus: FulfillmentState;
  paidAt: string | null;
  paymentStatus: string;
  refundState: string;
  refundedAmountCents: number;
  shippedAt: string | null;
  stripeDisputeId: string | null;
  stripeDisputeStatus: string | null;
  trackingCarrier: TrackingCarrier | null;
  trackingNumber: string | null;
};

export type FulfillmentUpdate = {
  deliveredAt?: string;
  orderStatus: FulfillmentState;
  shippedAt?: string;
  trackingCarrier?: TrackingCarrier;
  trackingNumber?: string;
};

export type FulfillmentTransaction = {
  enqueueShipmentEmail: (orderId: number) => Promise<void>;
  lockOrder: (orderId: number) => Promise<LockedFulfillmentOrder | null>;
  updateOrder: (orderId: number, update: FulfillmentUpdate) => Promise<void>;
};

export type FulfillmentRepository = {
  transaction: <T>(
    request: PayloadRequest,
    operation: (transaction: FulfillmentTransaction) => Promise<T>,
  ) => Promise<T>;
};

const optionalString = (value: unknown) =>
  typeof value === "string" ? value : null;

const lockOrder = async (
  transaction: StorefrontTransaction,
  orderId: number,
): Promise<LockedFulfillmentOrder | null> => {
  const result = await transaction.database.execute(sql`
    SELECT id, amount_cents, paid_at, order_status, payment_status,
      refunded_amount_cents, refund_state, stripe_dispute_id,
      stripe_dispute_status, tracking_carrier, tracking_number, shipped_at,
      delivered_at
    FROM public.orders
    WHERE id = ${orderId}
    FOR UPDATE
  `);
  const row = result.rows[0];
  if (!row) return null;

  return {
    amountCents: Number(row.amount_cents),
    deliveredAt: row.delivered_at
      ? new Date(String(row.delivered_at)).toISOString()
      : null,
    id: Number(row.id),
    orderStatus: String(row.order_status) as FulfillmentState,
    paidAt: row.paid_at ? new Date(String(row.paid_at)).toISOString() : null,
    paymentStatus: String(row.payment_status),
    refundState: String(row.refund_state),
    refundedAmountCents: Number(row.refunded_amount_cents),
    shippedAt: row.shipped_at
      ? new Date(String(row.shipped_at)).toISOString()
      : null,
    stripeDisputeId: optionalString(row.stripe_dispute_id),
    stripeDisputeStatus: optionalString(row.stripe_dispute_status),
    trackingCarrier: optionalString(row.tracking_carrier) as TrackingCarrier | null,
    trackingNumber: optionalString(row.tracking_number),
  };
};

export const orderFulfillmentRepository: FulfillmentRepository = {
  transaction: async (request, operation) => {
    let transaction: StorefrontTransaction | undefined;
    try {
      transaction = await beginStorefrontTransaction(request);
      const result = await operation({
        enqueueShipmentEmail: (orderId) =>
          createCustomerShippedEmailOutboxJob({ orderId, request }),
        lockOrder: (orderId) => lockOrder(transaction!, orderId),
        updateOrder: async (orderId, update) => {
          await request.payload.update({
            collection: "orders",
            data: update,
            depth: 0,
            id: orderId,
            overrideAccess: true,
            req: request,
          });
        },
      });
      await commitStorefrontTransaction(transaction);
      transaction = undefined;
      return result;
    } catch (error) {
      await rollbackStorefrontTransaction(transaction);
      throw error;
    }
  },
};
