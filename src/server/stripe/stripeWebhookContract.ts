export const STRIPE_WEBHOOK_EVENT_TYPES = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
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
