import Stripe from "stripe";

import { readStripeWebhookEnvironment } from "./stripeEnvironment";

export type StripeWebhookGateway = {
  retrieveCharge: (id: string) => Promise<Stripe.Charge>;
  retrieveDispute: (id: string) => Promise<Stripe.Dispute>;
  retrievePaymentIntent: (id: string) => Promise<Stripe.PaymentIntent>;
  retrieveRefund: (id: string) => Promise<Stripe.Refund>;
  retrieveSession: (id: string) => Promise<Stripe.Checkout.Session>;
  verifyEvent: (body: Buffer, signature: string) => Stripe.Event;
};

export const createStripeWebhookGateway = (): StripeWebhookGateway => {
  const environment = readStripeWebhookEnvironment();
  const stripe = new Stripe(environment.secretKey, { maxNetworkRetries: 0 });

  return {
    retrieveCharge: (id) => stripe.charges.retrieve(id),
    retrieveDispute: (id) => stripe.disputes.retrieve(id),
    retrievePaymentIntent: (id) => stripe.paymentIntents.retrieve(id),
    retrieveRefund: (id) => stripe.refunds.retrieve(id),
    retrieveSession: (id) => stripe.checkout.sessions.retrieve(id),
    verifyEvent: (body, signature) =>
      stripe.webhooks.constructEvent(
        body,
        signature,
        environment.webhookSecret,
      ),
  };
};
