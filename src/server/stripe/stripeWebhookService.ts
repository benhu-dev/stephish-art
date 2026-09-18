import type { PayloadRequest } from "payload";
import type Stripe from "stripe";

import {
  fulfillPaidStripeSession,
  type StripeWebhookTestProbe,
} from "./stripeWebhookFulfillment";
import {
  expireStripeSession,
  recordRejectedStripeEvent,
  recordUnpaidStripeSession,
} from "./stripeWebhookDisposition";
import {
  isSupportedStripeWebhookEvent,
  type StripeWebhookEventType,
} from "./stripeWebhookContract";
import type { StripeWebhookGateway } from "./stripeWebhookGateway";
import {
  readStripeReconciliation,
  validateRetrievedPaidSession,
  validateTerminalSession,
} from "./stripeWebhookSession";

type StripeWebhookServiceInput = {
  event: Stripe.Event;
  gateway: StripeWebhookGateway;
  getRequest: () => Promise<PayloadRequest>;
  now?: Date;
  probe?: StripeWebhookTestProbe;
};

const validEventId = (value: unknown): value is string =>
  typeof value === "string" &&
  value.startsWith("evt_") &&
  value.length <= 255;

const envelopeFor = (
  event: Stripe.Event,
  type: StripeWebhookEventType,
) => {
  if (
    !validEventId(event.id) ||
    !Number.isSafeInteger(event.created) ||
    event.created <= 0
  ) {
    return null;
  }
  return {
    createdAt: new Date(event.created * 1000).toISOString(),
    id: event.id,
    type,
  };
};

export const processStripeWebhookEvent = async ({
  event,
  gateway,
  getRequest,
  now = new Date(),
  probe,
}: StripeWebhookServiceInput) => {
  if (!isSupportedStripeWebhookEvent(event.type)) return "unrelated";
  const eventSession = event.data.object as Stripe.Checkout.Session;
  if (eventSession?.object !== "checkout.session") return "unrelated";

  const reconciliation = readStripeReconciliation(eventSession);
  if (reconciliation.kind === "unrelated") return "unrelated";
  const envelope = envelopeFor(event, event.type);
  if (!envelope) return "unrelated";
  if (reconciliation.kind === "invalid") {
    return recordRejectedStripeEvent({
      code: "invalid_metadata",
      event: envelope,
      now,
      request: await getRequest(),
    });
  }

  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded"
  ) {
    const session = await gateway.retrieveSession(eventSession.id);
    const validation = validateRetrievedPaidSession({
      event,
      eventSession,
      reconciliation: reconciliation.reconciliation,
      session,
    });
    const request = await getRequest();
    if (validation.kind === "rejected") {
      return recordRejectedStripeEvent({
        code: validation.code,
        event: envelope,
        intentId: reconciliation.reconciliation.intentId,
        now,
        request,
      });
    }
    if (validation.kind === "unpaid") {
      if (event.type !== "checkout.session.completed") {
        return recordRejectedStripeEvent({
          code: "payment_mismatch",
          event: envelope,
          intentId: reconciliation.reconciliation.intentId,
          now,
          request,
        });
      }
      return recordUnpaidStripeSession({
        event: envelope,
        now,
        request,
        session: validation.session,
      });
    }
    return fulfillPaidStripeSession({
      event: envelope,
      now,
      probe,
      request,
      session: validation.session,
    });
  }

  const validation = validateTerminalSession({
    event,
    eventSession,
    reconciliation: reconciliation.reconciliation,
  });
  const request = await getRequest();
  if (validation.kind === "rejected") {
    return recordRejectedStripeEvent({
      code: validation.code,
      event: envelope,
      intentId: reconciliation.reconciliation.intentId,
      now,
      request,
    });
  }
  return expireStripeSession({
    code:
      event.type === "checkout.session.async_payment_failed"
        ? "async_payment_failed"
        : "session_expired",
    event: envelope,
    now,
    request,
    session: validation.session,
  });
};
