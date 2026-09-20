import Stripe from "stripe";

import { readStripeCheckoutEnvironment } from "./stripeEnvironment";

export type StripeCheckoutInput = {
  amountCents: number;
  attemptId: string;
  baseURL: string;
  expiresAtEpochSeconds: number;
  intentId: number;
  shippingAmountCents: number;
};

export type SafeStripeCheckoutSession = {
  expiresAt: string;
  expiresAtEpochSeconds: number;
  id: string;
  status: "complete" | "expired" | "open";
  url: string | null;
};

export type StripeCheckoutGateway = {
  createSession: (
    input: StripeCheckoutInput,
  ) => Promise<SafeStripeCheckoutSession>;
  retrieveSession: (id: string) => Promise<SafeStripeCheckoutSession>;
};

const checkoutAttemptPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const stripeCheckoutIdempotencyKey = (attemptId: string) => {
  if (!checkoutAttemptPattern.test(attemptId)) {
    throw new Error("INVALID_CHECKOUT_ATTEMPT_ID");
  }
  return `checkout-session:${attemptId}`;
};

export const buildStripeCheckoutSessionParams = ({
  amountCents,
  attemptId,
  baseURL,
  expiresAtEpochSeconds,
  intentId,
  shippingAmountCents,
}: StripeCheckoutInput): Stripe.Checkout.SessionCreateParams => ({
  automatic_tax: { enabled: false },
  cancel_url: `${baseURL}/checkout/cancelled`,
  client_reference_id: String(intentId),
  customer_creation: "always",
  expires_at: expiresAtEpochSeconds,
  invoice_creation: { enabled: false },
  line_items: [
    {
      price_data: {
        currency: "usd",
        product_data: { name: "Custom postcard commission" },
        unit_amount: amountCents,
      },
      quantity: 1,
    },
  ],
  metadata: {
    checkoutAttemptId: attemptId,
    checkoutIntentId: String(intentId),
  },
  mode: "payment",
  payment_method_types: ["card"],
  shipping_address_collection: { allowed_countries: ["US"] },
  shipping_options: [
    {
      shipping_rate_data: {
        display_name: "Shipping",
        fixed_amount: { amount: shippingAmountCents, currency: "usd" },
        type: "fixed_amount",
      },
    },
  ],
  success_url: `${baseURL}/checkout/success`,
});

export const validateStripeCheckoutSession = (
  value: Pick<
    Stripe.Checkout.Session,
    "expires_at" | "id" | "livemode" | "status" | "url"
  >,
): SafeStripeCheckoutSession => {
  if (
    value.livemode !== false ||
    typeof value.id !== "string" ||
    !value.id.startsWith("cs_test_") ||
    !Number.isSafeInteger(value.expires_at) ||
    !["complete", "expired", "open"].includes(String(value.status))
  ) {
    throw new Error("INVALID_STRIPE_CHECKOUT_SESSION");
  }

  if (value.status === "open") {
    if (typeof value.url !== "string") {
      throw new Error("INVALID_STRIPE_CHECKOUT_SESSION_URL");
    }
    const checkoutURL = new URL(value.url);
    if (
      checkoutURL.protocol !== "https:" ||
      checkoutURL.username ||
      checkoutURL.password ||
      !(
        checkoutURL.hostname === "checkout.stripe.com" ||
        checkoutURL.hostname.endsWith(".stripe.com")
      )
    ) {
      throw new Error("INVALID_STRIPE_CHECKOUT_SESSION_URL");
    }
  }

  return {
    expiresAt: new Date(value.expires_at * 1000).toISOString(),
    expiresAtEpochSeconds: value.expires_at,
    id: value.id,
    status: value.status as SafeStripeCheckoutSession["status"],
    url: value.url,
  };
};

export const createStripeCheckoutGateway = (): StripeCheckoutGateway => {
  const environment = readStripeCheckoutEnvironment();
  const stripe = new Stripe(environment.secretKey, { maxNetworkRetries: 0 });

  return {
    createSession: async (input) =>
      validateStripeCheckoutSession(
        await stripe.checkout.sessions.create(
          buildStripeCheckoutSessionParams(input),
          { idempotencyKey: stripeCheckoutIdempotencyKey(input.attemptId) },
        ),
      ),
    retrieveSession: async (id) =>
      validateStripeCheckoutSession(await stripe.checkout.sessions.retrieve(id)),
  };
};
