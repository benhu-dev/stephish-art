import type { PayloadRequest } from "payload";

import type { StripeWebhookCode } from "./stripeWebhookContract";
import {
  lockWebhookEvent,
  lockWebhookIntent,
  readWebhookUploads,
  runStripeWebhookTransaction,
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
    const existingEvent = await lockWebhookEvent(transaction, event.id);
    if (existingEvent && existingEvent.disposition !== "rejected") {
      return "duplicate";
    }
    return recordWebhookDecision(
      request,
      event,
      now,
      "rejected",
      intentId && !intent ? "intent_not_found" : code,
      intent?.id,
      existingEvent?.id,
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
    const existingEvent = await lockWebhookEvent(transaction, event.id);
    if (existingEvent && existingEvent.disposition !== "rejected") {
      return "duplicate";
    }
    if (!intent) {
      return recordWebhookDecision(
        request,
        event,
        now,
        "rejected",
        "intent_not_found",
        undefined,
        existingEvent?.id,
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
        existingEvent?.id,
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
        existingEvent?.id,
      );
    }
    return recordWebhookDecision(
      request,
      event,
      now,
      "ignored",
      "session_unpaid",
      intent.id,
      existingEvent?.id,
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
    const existingEvent = await lockWebhookEvent(transaction, event.id);
    if (existingEvent && existingEvent.disposition !== "rejected") {
      return "duplicate";
    }
    if (!intent) {
      return recordWebhookDecision(
        request,
        event,
        now,
        "rejected",
        "intent_not_found",
        undefined,
        existingEvent?.id,
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
        existingEvent?.id,
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
        existingEvent?.id,
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
        existingEvent?.id,
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
        existingEvent?.id,
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
      existingEvent?.id,
    );
  });
