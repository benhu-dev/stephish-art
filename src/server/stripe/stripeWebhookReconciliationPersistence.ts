import type { PayloadRequest } from "payload";

import type {
  StripeDisputeStatus,
  StripeWebhookCode,
} from "./stripeWebhookContract";
import {
  lockWebhookEvent,
  lockWebhookOrderByPaymentIntent,
  readLatestProcessedDisputeEventCreatedAt,
  runStripeWebhookTransaction,
  type WebhookEventEnvelope,
} from "./stripeWebhookPersistence";
import type { AuthoritativePaymentState } from "./stripeWebhookReconciliation";
import { recordWebhookDecision } from "./stripeWebhookState";

export type StripeReconciliationTestProbe = {
  afterOrderUpdate?: () => Promise<void> | void;
};

const resolvedDisputeStatuses = new Set<StripeDisputeStatus>([
  "prevented",
  "warning_closed",
  "won",
]);

const terminalDisputeStatuses = new Set<StripeDisputeStatus>([
  "lost",
  "prevented",
  "warning_closed",
  "won",
]);

const isActiveDispute = (status: string | null) =>
  Boolean(status && !resolvedDisputeStatuses.has(status as StripeDisputeStatus));

const refundStateFor = (
  refundedAmountCents: number,
  totalAmountCents: number,
) =>
  refundedAmountCents === 0
    ? ("none" as const)
    : refundedAmountCents === totalAmountCents
      ? ("full" as const)
      : ("partial" as const);

const paymentStatusFor = (
  refundState: "full" | "none" | "partial",
  disputeStatus: string | null,
) => {
  if (isActiveDispute(disputeStatus)) return "disputed" as const;
  if (refundState === "full") return "refunded" as const;
  if (refundState === "partial") return "partially_refunded" as const;
  return "paid" as const;
};

export const recordRejectedPaymentReconciliation = async ({
  code,
  event,
  now,
  request,
}: {
  code: StripeWebhookCode;
  event: WebhookEventEnvelope;
  now: Date;
  request: PayloadRequest;
}) =>
  runStripeWebhookTransaction(request, async (transaction) => {
    const existingEvent = await lockWebhookEvent(transaction, event.id);
    if (existingEvent && existingEvent.disposition !== "rejected") {
      return "duplicate";
    }
    return recordWebhookDecision(
      request,
      event,
      now,
      "rejected",
      code,
      undefined,
      existingEvent?.id,
    );
  });

export const reconcileAuthoritativePaymentState = async ({
  event,
  isDisputeEvent,
  now,
  probe = {},
  request,
  state,
}: {
  event: WebhookEventEnvelope;
  isDisputeEvent: boolean;
  now: Date;
  probe?: StripeReconciliationTestProbe;
  request: PayloadRequest;
  state: AuthoritativePaymentState;
}) =>
  runStripeWebhookTransaction(request, async (transaction) => {
    const order = await lockWebhookOrderByPaymentIntent(
      transaction,
      state.paymentIntentId,
    );
    const existingEvent = await lockWebhookEvent(transaction, event.id);
    if (existingEvent && existingEvent.disposition !== "rejected") {
      return "duplicate";
    }
    if (!order) {
      return recordWebhookDecision(
        request,
        event,
        now,
        "rejected",
        "order_not_found",
        undefined,
        existingEvent?.id,
      );
    }
    if (
      order.paymentIntentId !== state.paymentIntentId ||
      order.currency !== state.currency ||
      order.amountCents !== state.totalAmountCents
    ) {
      return recordWebhookDecision(
        request,
        event,
        now,
        "rejected",
        "reconciliation_mismatch",
        order.checkoutIntentId,
        existingEvent?.id,
      );
    }
    if (
      !Number.isSafeInteger(state.refundedAmountCents) ||
      state.refundedAmountCents < 0 ||
      state.refundedAmountCents > order.amountCents
    ) {
      return recordWebhookDecision(
        request,
        event,
        now,
        "rejected",
        "refund_amount_invalid",
        order.checkoutIntentId,
        existingEvent?.id,
      );
    }
    if (state.refundedAmountCents < order.refundedAmountCents) {
      return recordWebhookDecision(
        request,
        event,
        now,
        "ignored",
        "refund_regression",
        order.checkoutIntentId,
        existingEvent?.id,
      );
    }
    if (isDisputeEvent) {
      if (!state.disputeId || !state.disputeStatus) {
        return recordWebhookDecision(
          request,
          event,
          now,
          "rejected",
          "reconciliation_object_mismatch",
          order.checkoutIntentId,
          existingEvent?.id,
        );
      }
      const latestCreatedAt = await readLatestProcessedDisputeEventCreatedAt(
        transaction,
        order.checkoutIntentId,
      );
      if (latestCreatedAt && latestCreatedAt > event.createdAt) {
        return recordWebhookDecision(
          request,
          event,
          now,
          "ignored",
          "stale_event",
          order.checkoutIntentId,
          existingEvent?.id,
        );
      }
      if (
        order.stripeDisputeId === state.disputeId &&
        order.stripeDisputeStatus &&
        terminalDisputeStatuses.has(
          order.stripeDisputeStatus as StripeDisputeStatus,
        ) &&
        order.stripeDisputeStatus !== state.disputeStatus
      ) {
        return recordWebhookDecision(
          request,
          event,
          now,
          "ignored",
          "stale_event",
          order.checkoutIntentId,
          existingEvent?.id,
        );
      }
    }

    const refundState = refundStateFor(
      state.refundedAmountCents,
      order.amountCents,
    );
    const disputeStatus = isDisputeEvent
      ? state.disputeStatus
      : order.stripeDisputeStatus;
    await request.payload.update({
      collection: "orders",
      data: {
        paymentStatus: paymentStatusFor(refundState, disputeStatus),
        refundedAmountCents: state.refundedAmountCents,
        refundState,
        ...(isDisputeEvent
          ? {
              stripeDisputeId: state.disputeId,
              stripeDisputeStatus: state.disputeStatus,
            }
          : {}),
      },
      depth: 0,
      id: order.id,
      overrideAccess: true,
      req: request,
    });
    await probe.afterOrderUpdate?.();
    return recordWebhookDecision(
      request,
      event,
      now,
      "processed",
      isDisputeEvent ? "dispute_reconciled" : "refund_reconciled",
      order.checkoutIntentId,
      existingEvent?.id,
    );
  });
