import type { PayloadRequest } from "payload";

import type { StripeWebhookCode } from "./stripeWebhookContract";
import {
  lockWebhookIntent,
  readWebhookUploads,
  runStripeWebhookTransaction,
  webhookEventExists,
  type WebhookEventEnvelope,
} from "./stripeWebhookPersistence";
import type { ValidatedSessionBase } from "./stripeWebhookSession";
import {
  recordWebhookDecision,
  storedSessionConflict,
  webhookUploadsAreValid,
} from "./stripeWebhookState";

export const recordRejectedStripeEvent = async ({
  code,
  event,
  intentId,
  now,
  request,
}: {
  code: StripeWebhookCode;
  event: WebhookEventEnvelope;
  intentId?: number;
  now: Date;
  request: PayloadRequest;
}) =>
  runStripeWebhookTransaction(request, async (transaction) => {
    const intent = intentId
      ? await lockWebhookIntent(transaction, intentId)
      : null;
    if (await webhookEventExists(request, event.id)) return "duplicate";
    return recordWebhookDecision(
      request,
      event,
      now,
      "rejected",
      intentId && !intent ? "intent_not_found" : code,
      intent?.id,
    );
  });

export const recordUnpaidStripeSession = async ({
  event,
  now,
  request,
  session,
}: {
  event: WebhookEventEnvelope;
  now: Date;
  request: PayloadRequest;
  session: ValidatedSessionBase;
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
    if (conflict || intent.status !== "checkout_created") {
      return recordWebhookDecision(
        request,
        event,
        now,
        "rejected",
        conflict ?? "intent_state_conflict",
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
    return recordWebhookDecision(
      request,
      event,
      now,
      "ignored",
      "session_unpaid",
      intent.id,
    );
  });

export const expireStripeSession = async ({
  code,
  event,
  now,
  request,
  session,
}: {
  code: "async_payment_failed" | "session_expired";
  event: WebhookEventEnvelope;
  now: Date;
  request: PayloadRequest;
  session: ValidatedSessionBase;
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
    if (
      intent.attemptId !== session.attemptId ||
      intent.sessionId !== session.sessionId ||
      !intent.sessionExpiresAt ||
      new Date(intent.sessionExpiresAt).getTime() !==
        session.expiresAtEpochSeconds * 1000
    ) {
      return recordWebhookDecision(
        request,
        event,
        now,
        "rejected",
        "reconciliation_mismatch",
        intent.id,
      );
    }
    if (intent.status === "completed") {
      return recordWebhookDecision(
        request,
        event,
        now,
        "ignored",
        "already_fulfilled",
        intent.id,
      );
    }
    if (intent.status === "expired") {
      return recordWebhookDecision(
        request,
        event,
        now,
        "ignored",
        "already_expired",
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
    await request.payload.update({
      collection: "checkout-intents",
      data: { status: "expired" },
      depth: 0,
      id: intent.id,
      overrideAccess: true,
      req: request,
    });
    return recordWebhookDecision(
      request,
      event,
      now,
      "processed",
      code,
      intent.id,
    );
  });
