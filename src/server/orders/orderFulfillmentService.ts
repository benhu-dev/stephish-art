import type { PayloadRequest } from "payload";
import { deliverEmailOutbox } from "../email/emailOutboxService";

import {
  FULFILLMENT_STATES,
  OrderFulfillmentError,
  type FulfillmentTracking,
  type FulfillmentTransitionInput,
  type FulfillmentState,
} from "./orderFulfillmentContract";
import {
  orderFulfillmentRepository,
  type FulfillmentRepository,
  type LockedFulfillmentOrder,
} from "./orderFulfillmentRepository";

const nextState: Record<FulfillmentState, FulfillmentState | null> = {
  delivered: null,
  in_progress: "ready_to_ship",
  ready_to_ship: "shipped",
  shipped: "delivered",
  unfulfilled: "in_progress",
};

const safeResolvedDisputes = new Set([
  "prevented",
  "warning_closed",
  "won",
]);

const storedTracking = (
  order: LockedFulfillmentOrder,
): FulfillmentTracking | undefined =>
  order.trackingCarrier && order.trackingNumber
    ? {
        carrier: order.trackingCarrier,
        trackingNumber: order.trackingNumber,
      }
    : undefined;

const trackingEquals = (
  left: FulfillmentTracking | undefined,
  right: FulfillmentTracking | undefined,
) =>
  left?.carrier === right?.carrier &&
  left?.trackingNumber === right?.trackingNumber;

const ensurePersistedStateIsValid = (order: LockedFulfillmentOrder) => {
  if (
    !(FULFILLMENT_STATES as readonly string[]).includes(order.orderStatus) ||
    !Number.isSafeInteger(order.amountCents) ||
    order.amountCents <= 0 ||
    !Number.isSafeInteger(order.refundedAmountCents) ||
    order.refundedAmountCents < 0 ||
    order.refundedAmountCents > order.amountCents ||
    !order.paidAt ||
    Number.isNaN(Date.parse(order.paidAt)) ||
    Boolean(order.stripeDisputeId) !== Boolean(order.stripeDisputeStatus) ||
    Boolean(order.trackingCarrier) !== Boolean(order.trackingNumber)
  ) {
    throw new OrderFulfillmentError(409, "ORDER_STATE_INCONSISTENT");
  }

  const refundState =
    order.refundedAmountCents === 0
      ? "none"
      : order.refundedAmountCents === order.amountCents
        ? "full"
        : "partial";
  const unsafeDispute = Boolean(
    order.stripeDisputeStatus &&
      !safeResolvedDisputes.has(order.stripeDisputeStatus),
  );
  const paymentStatus = unsafeDispute
    ? "disputed"
    : refundState === "full"
      ? "refunded"
      : refundState === "partial"
        ? "partially_refunded"
        : "paid";
  if (
    order.refundState !== refundState ||
    order.paymentStatus !== paymentStatus
  ) {
    throw new OrderFulfillmentError(409, "ORDER_STATE_INCONSISTENT");
  }

  return { refundState, unsafeDispute };
};

const responseFor = (order: LockedFulfillmentOrder, idempotent: boolean) => ({
  deliveredAt: order.deliveredAt,
  idempotent,
  shippedAt: order.shippedAt,
  state: order.orderStatus,
  tracking: storedTracking(order) ?? null,
});

export type FulfillmentTransitionProbe = {
  afterEnqueue?: () => Promise<void> | void;
  afterUpdate?: () => Promise<void> | void;
};

const deliverShipmentEmail = (orderId: number, request: PayloadRequest) =>
  deliverEmailOutbox({ kind: "customer_shipped", orderId, request });

export const transitionOrderFulfillment = async ({
  attemptOrderEmailDelivery = deliverShipmentEmail,
  input,
  now = new Date(),
  orderId,
  probe = {},
  repository = orderFulfillmentRepository,
  request,
}: {
  attemptOrderEmailDelivery?: (
    orderId: number,
    request: PayloadRequest,
  ) => Promise<unknown>;
  input: FulfillmentTransitionInput;
  now?: Date;
  orderId: number;
  probe?: FulfillmentTransitionProbe;
  repository?: FulfillmentRepository;
  request: PayloadRequest;
}) => {
  if (Number.isNaN(now.getTime())) {
    throw new OrderFulfillmentError(500, "INTERNAL_ERROR");
  }

  const transition = await repository.transaction(request, async (transaction) => {
    const order = await transaction.lockOrder(orderId);
    if (!order) throw new OrderFulfillmentError(404, "ORDER_NOT_FOUND");

    const requestedTracking = input.tracking ?? storedTracking(order);
    if (
      (order.orderStatus === "shipped" || order.orderStatus === "delivered") &&
      !trackingEquals(requestedTracking, storedTracking(order))
    ) {
      throw new OrderFulfillmentError(409, "FULFILLMENT_CONFLICT");
    }
    if (order.orderStatus === input.requestedNextState) {
      if (!trackingEquals(requestedTracking, storedTracking(order))) {
        throw new OrderFulfillmentError(409, "FULFILLMENT_CONFLICT");
      }
      const replayedForwardTransition =
        nextState[input.expectedCurrentState] === input.requestedNextState;
      const exactSameStateRetry =
        input.expectedCurrentState === input.requestedNextState;
      if (!replayedForwardTransition && !exactSameStateRetry) {
        throw new OrderFulfillmentError(409, "FULFILLMENT_CONFLICT");
      }
      return { response: responseFor(order, true), shippedNow: false };
    }

    if (order.orderStatus !== input.expectedCurrentState) {
      throw new OrderFulfillmentError(409, "FULFILLMENT_CONFLICT");
    }
    if (nextState[order.orderStatus] !== input.requestedNextState) {
      throw new OrderFulfillmentError(409, "INVALID_TRANSITION");
    }

    const { refundState, unsafeDispute } = ensurePersistedStateIsValid(order);
    if (refundState === "full") {
      throw new OrderFulfillmentError(409, "FULLY_REFUNDED");
    }
    if (unsafeDispute) {
      throw new OrderFulfillmentError(409, "DISPUTE_BLOCKED");
    }

    const timestamp = now.toISOString();
    const update = {
      orderStatus: input.requestedNextState,
      ...(input.tracking
        ? {
            trackingCarrier: input.tracking.carrier,
            trackingNumber: input.tracking.trackingNumber,
          }
        : {}),
      ...(input.requestedNextState === "shipped" ? { shippedAt: timestamp } : {}),
      ...(input.requestedNextState === "delivered"
        ? { deliveredAt: timestamp }
        : {}),
    };
    await transaction.updateOrder(order.id, update);
    await probe.afterUpdate?.();

    const shippedNow = input.requestedNextState === "shipped";
    if (shippedNow) {
      await transaction.enqueueShipmentEmail(order.id);
      await probe.afterEnqueue?.();
    }

    return {
      response: responseFor(
        {
          ...order,
          ...update,
          trackingCarrier:
            update.trackingCarrier ?? order.trackingCarrier,
          trackingNumber: update.trackingNumber ?? order.trackingNumber,
        },
        false,
      ),
      shippedNow,
    };
  });

  if (transition.shippedNow) {
    try {
      await attemptOrderEmailDelivery(orderId, request);
    } catch {
      // The committed shipment and durable retryable outbox job are authoritative.
    }
  }
  return transition.response;
};
