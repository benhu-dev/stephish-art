import Stripe from "stripe";

import { readStripeWebhookEnvironment } from "./stripeEnvironment";

export type StripeWebhookGateway = {
  retrieveSession: (id: string) => Promise<Stripe.Checkout.Session>;
  verifyEvent: (body: Buffer, signature: string) => Stripe.Event;
};

export const createStripeWebhookGateway = (): StripeWebhookGateway => {
  const environment = readStripeWebhookEnvironment();
  const stripe = new Stripe(environment.secretKey, { maxNetworkRetries: 0 });

  return {
    retrieveSession: (id) => stripe.checkout.sessions.retrieve(id),
    verifyEvent: (body, signature) =>
      stripe.webhooks.constructEvent(
        body,
        signature,
        environment.webhookSecret,
      ),
  };
};
