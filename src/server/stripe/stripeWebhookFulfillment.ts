import type { PayloadRequest } from "payload";

import type { StorefrontTransaction } from "../storefront/storefrontTransaction";
import {
  createWebhookLedgerEntry,
  lockWebhookIntent,
  readWebhookOrderConflicts,
  readWebhookUploads,
  runStripeWebhookTransaction,
  webhookEventExists,
  type WebhookEventEnvelope,
  type WebhookIntent,
} from "./stripeWebhookPersistence";
import type { ValidatedPaidSession } from "./stripeWebhookSession";
import {
  recordWebhookDecision,
  storedSessionConflict,
  webhookUploadsAreValid,
} from "./stripeWebhookState";

export type StripeWebhookTestProbe = {
  afterCustomer?: () => Promise<void> | void;
  afterIntent?: () => Promise<void> | void;
  afterLedger?: () => Promise<void> | void;
  afterOrder?: () => Promise<void> | void;
  afterUploads?: () => Promise<void> | void;
};

const resolveCustomer = async (
  request: PayloadRequest,
  session: ValidatedPaidSession,
) => {
  const matches = await request.payload.find({
    collection: "customers",
    depth: 0,
    limit: 3,
    overrideAccess: true,
    req: request,
    where: {
      or: [
        { email: { equals: session.customerEmail } },
        { stripeCustomerId: { equals: session.stripeCustomerId } },
      ],
    },
  });
  if (matches.docs.length === 0) {
    return request.payload.create({
      collection: "customers",
      data: {
        email: session.customerEmail,
        fullName: session.customerName,
        stripeCustomerId: session.stripeCustomerId,
      },
      depth: 0,
      overrideAccess: true,
      req: request,
    });
  }
  if (matches.docs.length !== 1) return null;

  const customer = matches.docs[0];
  if (customer.email !== session.customerEmail) return null;
  if (
    customer.stripeCustomerId &&
    customer.stripeCustomerId !== session.stripeCustomerId
  ) {
    return null;
  }
  if (!customer.stripeCustomerId) {
    return request.payload.update({
      collection: "customers",
      data: { stripeCustomerId: session.stripeCustomerId },
      depth: 0,
      id: customer.id,
      overrideAccess: true,
      req: request,
    });
  }
  return customer;
};

const validateCompletedOrder = async (
  transaction: StorefrontTransaction,
  intent: WebhookIntent,
  session: ValidatedPaidSession,
) => {
  const orders = await readWebhookOrderConflicts(
    transaction,
    intent.id,
    session.sessionId,
    session.paymentIntentId,
  );
  return orders.length === 1 &&
    orders[0].checkoutIntentId === intent.id &&
    orders[0].sessionId === session.sessionId &&
    orders[0].paymentIntentId === session.paymentIntentId &&
    orders[0].amountCents === session.amountTotal &&
    orders[0].artistNote === intent.artistNote &&
    orders[0].currency === "usd"
    ? orders[0]
    : null;
};

export const fulfillPaidStripeSession = async ({
  event,
  now,
  probe = {},
  request,
  session,
}: {
  event: WebhookEventEnvelope;
  now: Date;
  probe?: StripeWebhookTestProbe;
  request: PayloadRequest;
  session: ValidatedPaidSession;
}) =>
  runStripeWebhookTransaction(request, async (transaction) => {
    const intent = await lockWebhookIntent(transaction, session.intentId);
    if (await webhookEventExists(request, event.id)) return "duplicate";
    if (!intent) {
      return recordWebhookDecision(
        request,
        event,
        now,
        "rejected",
        "intent_not_found",
      );
    }
    const conflict = storedSessionConflict(intent, session);
    if (conflict) {
      return recordWebhookDecision(
        request,
        event,
        now,
        "rejected",
        conflict,
        intent.id,
      );
    }

    if (intent.status === "completed") {
      const existing = await validateCompletedOrder(transaction, intent, session);
      if (!existing) throw new Error("WEBHOOK_FULFILLMENT_STATE_INVALID");
      const uploads = await readWebhookUploads(transaction, intent.id);
      if (
        !webhookUploadsAreValid(uploads) ||
        uploads.some((upload) => upload.orderId !== existing.id)
      ) {
        throw new Error("WEBHOOK_UPLOAD_STATE_INVALID");
      }
      return recordWebhookDecision(
        request,
        event,
        now,
        "ignored",
        "already_fulfilled",
        intent.id,
      );
    }
    if (intent.status !== "checkout_created") {
      return recordWebhookDecision(
        request,
        event,
        now,
        "rejected",
        "intent_state_conflict",
        intent.id,
      );
    }

    const uploads = await readWebhookUploads(transaction, intent.id);
    if (
      !webhookUploadsAreValid(uploads) ||
      uploads.some((upload) => upload.orderId)
    ) {
      return recordWebhookDecision(
        request,
        event,
        now,
        "rejected",
        "invalid_uploads",
        intent.id,
      );
    }
    const orderConflicts = await readWebhookOrderConflicts(
      transaction,
      intent.id,
      session.sessionId,
      session.paymentIntentId,
    );
    if (orderConflicts.length > 0) {
      return recordWebhookDecision(
        request,
        event,
        now,
        "rejected",
        "reconciliation_mismatch",
        intent.id,
      );
    }

    const customer = await resolveCustomer(request, session);
    if (!customer) {
      return recordWebhookDecision(
        request,
        event,
        now,
        "rejected",
        "identity_conflict",
        intent.id,
      );
    }
    await probe.afterCustomer?.();
    const order = await request.payload.create({
      collection: "orders",
      data: {
        amountCents: session.amountTotal,
        artistNote: intent.artistNote,
        checkoutIntent: intent.id,
        contactEmail: session.customerEmail,
        currency: "usd",
        customer: customer.id,
        orderStatus: "new",
        paidAt: session.eventCreatedAt,
        paymentStatus: "paid",
        shippingAddress: session.shippingAddress,
        stripeCheckoutSessionId: session.sessionId,
        stripePaymentIntentId: session.paymentIntentId,
      },
      depth: 0,
      overrideAccess: true,
      req: request,
    });
    await probe.afterOrder?.();
    for (const upload of uploads) {
      await request.payload.update({
        collection: "order-uploads",
        data: { order: order.id },
        depth: 0,
        id: upload.id,
        overrideAccess: true,
        req: request,
      });
    }
    await probe.afterUploads?.();
    await request.payload.update({
      collection: "checkout-intents",
      data: { status: "completed" },
      depth: 0,
      id: intent.id,
      overrideAccess: true,
      req: request,
    });
    await probe.afterIntent?.();
    await createWebhookLedgerEntry({
      disposition: "processed",
      event,
      intentId: intent.id,
      now,
      request,
    });
    await probe.afterLedger?.();
    return "processed";
  });
