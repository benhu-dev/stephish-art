export const STRIPE_WEBHOOK_EVENT_TYPES = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "refund.created",
  "refund.updated",
  "refund.failed",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
] as const;

export type StripeWebhookEventType =
  (typeof STRIPE_WEBHOOK_EVENT_TYPES)[number];

export const STRIPE_WEBHOOK_CODES = [
  "already_expired",
  "already_fulfilled",
  "amount_mismatch",
  "async_payment_failed",
  "currency_mismatch",
  "identity_conflict",
  "intent_not_found",
  "intent_state_conflict",
  "invalid_customer",
  "invalid_metadata",
  "invalid_shipping",
  "invalid_uploads",
  "payment_mismatch",
  "order_not_found",
  "refund_amount_invalid",
  "refund_reconciled",
  "refund_regression",
  "reconciliation_object_mismatch",
  "dispute_reconciled",
  "stale_event",
  "reconciliation_mismatch",
  "session_expired",
  "session_mismatch",
  "session_unpaid",
] as const;

export type StripeWebhookCode = (typeof STRIPE_WEBHOOK_CODES)[number];

export const isSupportedStripeWebhookEvent = (
  value: string,
): value is StripeWebhookEventType =>
  (STRIPE_WEBHOOK_EVENT_TYPES as readonly string[]).includes(value);

export const STRIPE_DISPUTE_STATUSES = [
  "lost",
  "needs_response",
  "prevented",
  "under_review",
  "warning_closed",
  "warning_needs_response",
  "warning_under_review",
  "won",
] as const;

export type StripeDisputeStatus = (typeof STRIPE_DISPUTE_STATUSES)[number];

export const isStripeDisputeStatus = (
  value: string,
): value is StripeDisputeStatus =>
  (STRIPE_DISPUTE_STATUSES as readonly string[]).includes(value);
