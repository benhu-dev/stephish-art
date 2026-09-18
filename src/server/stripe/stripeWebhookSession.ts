import type Stripe from "stripe";

import type { StripeWebhookCode } from "./stripeWebhookContract";

const attemptPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type StripeReconciliation = {
  attemptId: string;
  intentId: number;
};

export type ShippingSnapshot = {
  city: string;
  country: "US";
  line1: string;
  line2?: string;
  postalCode?: string;
  recipientName: string;
  state?: string;
};

export type ValidatedSessionBase = StripeReconciliation & {
  amountSubtotal: number;
  amountTotal: number;
  eventCreatedAt: string;
  expiresAtEpochSeconds: number;
  sessionId: string;
  shippingAmount: number;
};

export type ValidatedPaidSession = ValidatedSessionBase & {
  customerEmail: string;
  customerName: string;
  paymentIntentId: string;
  shippingAddress: ShippingSnapshot;
  stripeCustomerId: string;
};

export type SessionValidation =
  | { code: StripeWebhookCode; kind: "rejected" }
  | { kind: "paid"; session: ValidatedPaidSession }
  | { kind: "unpaid"; session: ValidatedSessionBase };

export type ReconciliationResult =
  | { kind: "invalid" }
  | { kind: "unrelated" }
  | { kind: "valid"; reconciliation: StripeReconciliation };

const isBoundedString = (
  value: unknown,
  maximum: number,
  required = false,
): value is string =>
  typeof value === "string" &&
  value.length <= maximum &&
  (!required || value.trim().length > 0);

const optionalAddressValue = (value: unknown, maximum: number) => {
  if (value === null || value === undefined || value === "") return undefined;
  return isBoundedString(value, maximum, true) ? value : null;
};

export const readStripeReconciliation = (
  session: Pick<Stripe.Checkout.Session, "metadata">,
): ReconciliationResult => {
  const intentValue = session.metadata?.checkoutIntentId;
  const attemptValue = session.metadata?.checkoutAttemptId;
  if (!intentValue && !attemptValue) return { kind: "unrelated" };
  if (
    typeof intentValue !== "string" ||
    !/^[1-9]\d*$/.test(intentValue) ||
    typeof attemptValue !== "string" ||
    !attemptPattern.test(attemptValue)
  ) {
    return { kind: "invalid" };
  }

  const intentId = Number(intentValue);
  if (!Number.isSafeInteger(intentId)) return { kind: "invalid" };
  return {
    kind: "valid",
    reconciliation: { attemptId: attemptValue, intentId },
  };
};

const readShippingAddress = (
  session: Stripe.Checkout.Session,
): ShippingSnapshot | undefined => {
  const shipping = session.collected_information?.shipping_details;
  const address = shipping?.address;
  if (
    !shipping ||
    !address ||
    address.country !== "US" ||
    !isBoundedString(shipping.name, 150, true) ||
    !isBoundedString(address.line1, 200, true) ||
    !isBoundedString(address.city, 100, true)
  ) {
    return undefined;
  }
  const line2 = optionalAddressValue(address.line2, 200);
  const state = optionalAddressValue(address.state, 100);
  const postalCode = optionalAddressValue(address.postal_code, 32);
  if (line2 === null || state === null || postalCode === null) return undefined;

  return {
    city: address.city,
    country: "US",
    line1: address.line1,
    ...(line2 ? { line2 } : {}),
    ...(postalCode ? { postalCode } : {}),
    recipientName: shipping.name,
    ...(state ? { state } : {}),
  };
};

const matchesReconciliation = (
  session: Stripe.Checkout.Session,
  reconciliation: StripeReconciliation,
) =>
  session.metadata?.checkoutIntentId === String(reconciliation.intentId) &&
  session.metadata?.checkoutAttemptId === reconciliation.attemptId &&
  session.client_reference_id === String(reconciliation.intentId);

export const validateRetrievedPaidSession = ({
  event,
  eventSession,
  reconciliation,
  session,
}: {
  event: Stripe.Event;
  eventSession: Stripe.Checkout.Session;
  reconciliation: StripeReconciliation;
  session: Stripe.Checkout.Session;
}): SessionValidation => {
  if (
    event.livemode !== false ||
    session.livemode !== false ||
    eventSession.id !== session.id ||
    !session.id.startsWith("cs_test_") ||
    session.mode !== "payment" ||
    !matchesReconciliation(eventSession, reconciliation) ||
    !matchesReconciliation(session, reconciliation)
  ) {
    return { code: "session_mismatch", kind: "rejected" };
  }
  if (session.currency !== "usd") {
    return { code: "currency_mismatch", kind: "rejected" };
  }
  if (
    eventSession.currency !== session.currency ||
    eventSession.amount_subtotal !== session.amount_subtotal ||
    eventSession.amount_total !== session.amount_total ||
    eventSession.total_details?.amount_shipping !==
      session.total_details?.amount_shipping
  ) {
    return { code: "amount_mismatch", kind: "rejected" };
  }

  const amountSubtotal = session.amount_subtotal;
  const amountTotal = session.amount_total;
  const shippingAmount = session.total_details?.amount_shipping;
  if (
    !Number.isSafeInteger(amountSubtotal) ||
    amountSubtotal! < 1 ||
    !Number.isSafeInteger(shippingAmount) ||
    shippingAmount! < 0 ||
    !Number.isSafeInteger(amountTotal) ||
    amountTotal !== amountSubtotal! + shippingAmount! ||
    !Number.isSafeInteger(session.expires_at) ||
    session.expires_at <= 0 ||
    !Number.isSafeInteger(event.created) ||
    event.created <= 0
  ) {
    return { code: "amount_mismatch", kind: "rejected" };
  }

  const base: ValidatedSessionBase = {
    ...reconciliation,
    amountSubtotal: amountSubtotal!,
    amountTotal: amountTotal!,
    eventCreatedAt: new Date(event.created * 1000).toISOString(),
    expiresAtEpochSeconds: session.expires_at,
    sessionId: session.id,
    shippingAmount: shippingAmount!,
  };
  if (session.payment_status === "unpaid") {
    return { kind: "unpaid", session: base };
  }
  if (session.payment_status !== "paid") {
    return { code: "payment_mismatch", kind: "rejected" };
  }
  if (
    eventSession.payment_intent !== session.payment_intent ||
    eventSession.customer !== session.customer
  ) {
    return { code: "payment_mismatch", kind: "rejected" };
  }

  const customerEmail = session.customer_details?.email?.trim().toLowerCase();
  const customerName = session.customer_details?.name;
  if (
    !customerEmail ||
    customerEmail.length > 254 ||
    !emailPattern.test(customerEmail) ||
    !isBoundedString(customerName, 150, true) ||
    typeof session.customer !== "string" ||
    !session.customer.startsWith("cus_") ||
    typeof session.payment_intent !== "string" ||
    !session.payment_intent.startsWith("pi_")
  ) {
    return { code: "invalid_customer", kind: "rejected" };
  }
  const shippingAddress = readShippingAddress(session);
  if (!shippingAddress) {
    return { code: "invalid_shipping", kind: "rejected" };
  }

  return {
    kind: "paid",
    session: {
      ...base,
      customerEmail,
      customerName,
      paymentIntentId: session.payment_intent,
      shippingAddress,
      stripeCustomerId: session.customer,
    },
  };
};

export const validateTerminalSession = ({
  event,
  eventSession,
  reconciliation,
}: {
  event: Stripe.Event;
  eventSession: Stripe.Checkout.Session;
  reconciliation: StripeReconciliation;
}):
  | { code: StripeWebhookCode; kind: "rejected" }
  | { kind: "valid"; session: ValidatedSessionBase } => {
  if (
    event.livemode !== false ||
    eventSession.livemode !== false ||
    !eventSession.id.startsWith("cs_test_") ||
    eventSession.mode !== "payment" ||
    !matchesReconciliation(eventSession, reconciliation) ||
    !Number.isSafeInteger(eventSession.expires_at) ||
    eventSession.expires_at <= 0 ||
    !Number.isSafeInteger(event.created) ||
    event.created <= 0
  ) {
    return { code: "session_mismatch", kind: "rejected" };
  }

  return {
    kind: "valid",
    session: {
      ...reconciliation,
      amountSubtotal: 0,
      amountTotal: 0,
      eventCreatedAt: new Date(event.created * 1000).toISOString(),
      expiresAtEpochSeconds: eventSession.expires_at,
      sessionId: eventSession.id,
      shippingAmount: 0,
    },
  };
};
