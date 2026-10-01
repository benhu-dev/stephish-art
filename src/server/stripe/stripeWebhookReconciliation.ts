import type Stripe from "stripe";

import {
  isStripeDisputeStatus,
  type StripeDisputeStatus,
  type StripeWebhookCode,
  type StripeWebhookEventType,
} from "./stripeWebhookContract";
import type { StripeWebhookGateway } from "./stripeWebhookGateway";

export type AuthoritativePaymentState = {
  chargeId: string;
  currency: string;
  disputeId: string | null;
  disputeStatus: StripeDisputeStatus | null;
  paymentIntentId: string;
  refundedAmountCents: number;
  totalAmountCents: number;
};

export type RetrievedPaymentState =
  | { code: StripeWebhookCode; kind: "rejected" }
  | { kind: "verified"; state: AuthoritativePaymentState };

const idFromExpandable = (value: unknown, prefix: string) => {
  const id = typeof value === "string" ? value : null;
  return id && id.startsWith(prefix) && id.length <= 255 ? id : null;
};

const validObjectId = (value: unknown, object: string, prefix: string) => {
  if (!value || typeof value !== "object") return null;
  const record = value as { id?: unknown; object?: unknown };
  return record.object === object
    ? idFromExpandable(record.id, prefix)
    : null;
};

const reject = (code: StripeWebhookCode): RetrievedPaymentState => ({
  code,
  kind: "rejected",
});

const retrieveChargeState = async (
  chargeId: string,
  gateway: StripeWebhookGateway,
) => {
  const charge = await gateway.retrieveCharge(chargeId);
  const paymentIntentId = idFromExpandable(charge.payment_intent, "pi_");
  if (
    charge.object !== "charge" ||
    charge.id !== chargeId ||
    charge.livemode !== false ||
    charge.paid !== true ||
    !paymentIntentId ||
    typeof charge.currency !== "string" ||
    !Number.isSafeInteger(charge.amount) ||
    !Number.isSafeInteger(charge.amount_refunded) ||
    charge.amount <= 0 ||
    charge.amount_refunded < 0 ||
    charge.amount_refunded > charge.amount
  ) {
    return null;
  }

  const paymentIntent = await gateway.retrievePaymentIntent(paymentIntentId);
  const latestChargeId = idFromExpandable(paymentIntent.latest_charge, "ch_");
  if (
    paymentIntent.object !== "payment_intent" ||
    paymentIntent.id !== paymentIntentId ||
    paymentIntent.livemode !== false ||
    paymentIntent.status !== "succeeded" ||
    paymentIntent.currency !== charge.currency ||
    paymentIntent.amount_received !== charge.amount ||
    latestChargeId !== charge.id
  ) {
    return null;
  }

  return {
    charge,
    paymentIntentId,
  };
};

const paymentState = (
  charge: Stripe.Charge,
  paymentIntentId: string,
  dispute?: Stripe.Dispute,
): AuthoritativePaymentState => ({
  chargeId: charge.id,
  currency: charge.currency,
  disputeId: dispute?.id ?? null,
  disputeStatus: (dispute?.status as StripeDisputeStatus | undefined) ?? null,
  paymentIntentId,
  refundedAmountCents: charge.amount_refunded,
  totalAmountCents: charge.amount,
});

export const isPaymentReconciliationEvent = (
  type: StripeWebhookEventType,
) =>
  type === "refund.created" ||
  type === "refund.updated" ||
  type === "refund.failed" ||
  type === "charge.refunded" ||
  type === "charge.dispute.created" ||
  type === "charge.dispute.updated" ||
  type === "charge.dispute.closed";

export const retrieveAuthoritativePaymentState = async ({
  event,
  gateway,
}: {
  event: Stripe.Event;
  gateway: StripeWebhookGateway;
}): Promise<RetrievedPaymentState> => {
  if (event.livemode !== false) return reject("reconciliation_object_mismatch");

  if (
    event.type === "refund.created" ||
    event.type === "refund.updated" ||
    event.type === "refund.failed"
  ) {
    const refundId = validObjectId(event.data.object, "refund", "re_");
    if (!refundId) return reject("reconciliation_object_mismatch");
    const refund = await gateway.retrieveRefund(refundId);
    const chargeId = idFromExpandable(refund.charge, "ch_");
    const refundPaymentIntentId = idFromExpandable(
      refund.payment_intent,
      "pi_",
    );
    if (
      refund.object !== "refund" ||
      refund.id !== refundId ||
      !chargeId ||
      !refundPaymentIntentId ||
      !Number.isSafeInteger(refund.amount) ||
      refund.amount <= 0 ||
      typeof refund.currency !== "string"
    ) {
      return reject("reconciliation_object_mismatch");
    }
    const retrieved = await retrieveChargeState(chargeId, gateway);
    if (
      !retrieved ||
      retrieved.paymentIntentId !== refundPaymentIntentId ||
      retrieved.charge.currency !== refund.currency ||
      refund.amount > retrieved.charge.amount
    ) {
      return reject("reconciliation_object_mismatch");
    }
    return {
      kind: "verified",
      state: paymentState(retrieved.charge, retrieved.paymentIntentId),
    };
  }

  if (event.type === "charge.refunded") {
    const chargeId = validObjectId(event.data.object, "charge", "ch_");
    if (!chargeId) return reject("reconciliation_object_mismatch");
    const retrieved = await retrieveChargeState(chargeId, gateway);
    if (!retrieved) return reject("reconciliation_object_mismatch");
    return {
      kind: "verified",
      state: paymentState(retrieved.charge, retrieved.paymentIntentId),
    };
  }

  const disputeId = validObjectId(event.data.object, "dispute", "dp_");
  if (!disputeId) return reject("reconciliation_object_mismatch");
  const dispute = await gateway.retrieveDispute(disputeId);
  const chargeId = idFromExpandable(dispute.charge, "ch_");
  const disputePaymentIntentId = idFromExpandable(
    dispute.payment_intent,
    "pi_",
  );
  if (
    dispute.object !== "dispute" ||
    dispute.id !== disputeId ||
    dispute.livemode !== false ||
    !chargeId ||
    !disputePaymentIntentId ||
    !isStripeDisputeStatus(dispute.status) ||
    !Number.isSafeInteger(dispute.amount) ||
    dispute.amount <= 0 ||
    typeof dispute.currency !== "string"
  ) {
    return reject("reconciliation_object_mismatch");
  }
  const retrieved = await retrieveChargeState(chargeId, gateway);
  if (
    !retrieved ||
    retrieved.paymentIntentId !== disputePaymentIntentId ||
    retrieved.charge.currency !== dispute.currency ||
    dispute.amount > retrieved.charge.amount
  ) {
    return reject("reconciliation_object_mismatch");
  }
  return {
    kind: "verified",
    state: paymentState(
      retrieved.charge,
      retrieved.paymentIntentId,
      dispute,
    ),
  };
};
