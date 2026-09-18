import configPromise from "@payload-config";
import { createLocalReq, getPayload } from "payload";

import { handleStripeWebhookRequest } from "../../../../server/stripe/stripeWebhookEndpoint";
import { createStripeWebhookGateway } from "../../../../server/stripe/stripeWebhookGateway";
import { processStripeWebhookEvent } from "../../../../server/stripe/stripeWebhookService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const configurationError = () =>
  Response.json(
    { error: "Webhook processing failed." },
    { headers: { "cache-control": "no-store" }, status: 500 },
  );

export const POST = async (request: Request) => {
  let gateway;
  try {
    gateway = createStripeWebhookGateway();
  } catch {
    return configurationError();
  }

  const response = await handleStripeWebhookRequest(request, {
    processEvent: async (event) => {
      const outcome = await processStripeWebhookEvent({
        event,
        gateway,
        getRequest: async () => {
          const payload = await getPayload({ config: configPromise });
          return createLocalReq({}, payload);
        },
      });
      console.info("Stripe webhook acknowledged.", {
        eventType: event.type,
        outcome,
      });
      return outcome;
    },
    verifyEvent: gateway.verifyEvent,
  });
  console.info("Stripe webhook request handled.", { status: response.status });
  return response;
};
