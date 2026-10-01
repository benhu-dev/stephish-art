import { sql } from "@payloadcms/db-postgres";
import type { PayloadRequest } from "payload";

import {
  beginStorefrontTransaction,
  commitStorefrontTransaction,
  rollbackStorefrontTransaction,
  type StorefrontTransaction,
} from "../storefront/storefrontTransaction";
import type {
  StripeWebhookCode,
  StripeWebhookEventType,
} from "./stripeWebhookContract";

export type WebhookEventEnvelope = {
  createdAt: string;
  id: string;
  type: StripeWebhookEventType;
};

export type WebhookIntent = {
  amountCents: number;
  artistNote: string | null;
  attemptId: string | null;
  checkoutStartedAt: string | null;
  expiresAt: string;
  id: number;
  sessionExpiresAt: string | null;
  sessionId: string | null;
  shippingAmountCents: number | null;
  status: string;
  totalAmountCents: number | null;
};

export type WebhookUpload = {
  filename: string | null;
  filesize: number;
  id: number;
  mimeType: string | null;
  orderId: number | null;
  position: number;
};

export type WebhookOrder = {
  amountCents: number;
  artistNote: string | null;
  checkoutIntentId: number;
  currency: string;
  id: number;
  paymentIntentId: string;
  sessionId: string;
};

export type WebhookReconciliationOrder = WebhookOrder & {
  refundState: "full" | "none" | "partial";
  refundedAmountCents: number;
  stripeDisputeId: string | null;
  stripeDisputeStatus: string | null;
};

export type WebhookLedgerEntry = {
  checkoutIntentId: number | null;
  disposition: "ignored" | "processed" | "rejected";
  id: number;
};

export const runStripeWebhookTransaction = async <T>(
  request: PayloadRequest,
  operation: (transaction: StorefrontTransaction) => Promise<T>,
) => {
  let transaction: StorefrontTransaction | undefined;
  try {
    transaction = await beginStorefrontTransaction(request);
    const result = await operation(transaction);
    await commitStorefrontTransaction(transaction);
    transaction = undefined;
    return result;
  } catch (error) {
    await rollbackStorefrontTransaction(transaction);
    throw error;
  }
};

export const lockWebhookIntent = async (
  transaction: StorefrontTransaction,
  intentId: number,
): Promise<WebhookIntent | null> => {
  const result = await transaction.database.execute(sql`
    SELECT id, status, amount_cents, artist_note, expires_at, checkout_attempt_id,
      checkout_started_at, shipping_amount_cents, total_amount_cents,
      stripe_checkout_session_id, stripe_checkout_session_expires_at
    FROM public.checkout_intents
    WHERE id = ${intentId}
    FOR UPDATE
  `);
  const row = result.rows[0];
  if (!row) return null;

  return {
    amountCents: Number(row.amount_cents),
    artistNote: typeof row.artist_note === "string" ? row.artist_note : null,
    attemptId:
      typeof row.checkout_attempt_id === "string"
        ? row.checkout_attempt_id
        : null,
    checkoutStartedAt: row.checkout_started_at
      ? new Date(String(row.checkout_started_at)).toISOString()
      : null,
    expiresAt: new Date(String(row.expires_at)).toISOString(),
    id: Number(row.id),
    sessionExpiresAt: row.stripe_checkout_session_expires_at
      ? new Date(String(row.stripe_checkout_session_expires_at)).toISOString()
      : null,
    sessionId:
      typeof row.stripe_checkout_session_id === "string"
        ? row.stripe_checkout_session_id
        : null,
    shippingAmountCents:
      row.shipping_amount_cents === null ||
      row.shipping_amount_cents === undefined
        ? null
        : Number(row.shipping_amount_cents),
    status: String(row.status),
    totalAmountCents:
      row.total_amount_cents === null || row.total_amount_cents === undefined
        ? null
        : Number(row.total_amount_cents),
  };
};

export const readWebhookUploads = async (
  transaction: StorefrontTransaction,
  intentId: number,
): Promise<WebhookUpload[]> => {
  const result = await transaction.database.execute(sql`
    SELECT id, position, filename, mime_type, filesize, order_id
    FROM public.order_uploads
    WHERE checkout_intent_id = ${intentId}
    ORDER BY position
    FOR SHARE
  `);

  return result.rows.map((row) => ({
    filename: typeof row.filename === "string" ? row.filename : null,
    filesize: Number(row.filesize),
    id: Number(row.id),
    mimeType: typeof row.mime_type === "string" ? row.mime_type : null,
    orderId:
      row.order_id === null || row.order_id === undefined
        ? null
        : Number(row.order_id),
    position: Number(row.position),
  }));
};

export const readWebhookOrderConflicts = async (
  transaction: StorefrontTransaction,
  intentId: number,
  sessionId: string,
  paymentIntentId: string,
): Promise<WebhookOrder[]> => {
  const result = await transaction.database.execute(sql`
    SELECT id, checkout_intent_id, amount_cents, artist_note, currency,
      stripe_checkout_session_id, stripe_payment_intent_id
    FROM public.orders
    WHERE checkout_intent_id = ${intentId}
      OR stripe_checkout_session_id = ${sessionId}
      OR stripe_payment_intent_id = ${paymentIntentId}
    FOR SHARE
  `);

  return result.rows.map((row) => ({
    amountCents: Number(row.amount_cents),
    artistNote: typeof row.artist_note === "string" ? row.artist_note : null,
    checkoutIntentId: Number(row.checkout_intent_id),
    currency: String(row.currency),
    id: Number(row.id),
    paymentIntentId: String(row.stripe_payment_intent_id),
    sessionId: String(row.stripe_checkout_session_id),
  }));
};

export const lockWebhookOrderByPaymentIntent = async (
  transaction: StorefrontTransaction,
  paymentIntentId: string,
): Promise<WebhookReconciliationOrder | null> => {
  const result = await transaction.database.execute(sql`
    SELECT id, checkout_intent_id, amount_cents, artist_note, currency,
      stripe_checkout_session_id, stripe_payment_intent_id,
      refunded_amount_cents, refund_state, stripe_dispute_id,
      stripe_dispute_status
    FROM public.orders
    WHERE stripe_payment_intent_id = ${paymentIntentId}
    FOR UPDATE
  `);
  const row = result.rows[0];
  if (!row) return null;

  return {
    amountCents: Number(row.amount_cents),
    artistNote: typeof row.artist_note === "string" ? row.artist_note : null,
    checkoutIntentId: Number(row.checkout_intent_id),
    currency: String(row.currency),
    id: Number(row.id),
    paymentIntentId: String(row.stripe_payment_intent_id),
    refundState: String(
      row.refund_state,
    ) as WebhookReconciliationOrder["refundState"],
    refundedAmountCents: Number(row.refunded_amount_cents),
    sessionId: String(row.stripe_checkout_session_id),
    stripeDisputeId:
      typeof row.stripe_dispute_id === "string"
        ? row.stripe_dispute_id
        : null,
    stripeDisputeStatus:
      typeof row.stripe_dispute_status === "string"
        ? row.stripe_dispute_status
        : null,
  };
};

export const readLatestProcessedDisputeEventCreatedAt = async (
  transaction: StorefrontTransaction,
  checkoutIntentId: number,
) => {
  const result = await transaction.database.execute(sql`
    SELECT stripe_created_at
    FROM public.stripe_events
    WHERE checkout_intent_id = ${checkoutIntentId}
      AND disposition = 'processed'
      AND event_type::text IN (
        'charge.dispute.created',
        'charge.dispute.updated',
        'charge.dispute.closed'
      )
    ORDER BY stripe_created_at DESC, id DESC
    LIMIT 1
  `);
  const value = result.rows[0]?.stripe_created_at;
  return value ? new Date(String(value)).toISOString() : null;
};

export const lockWebhookEvent = async (
  transaction: StorefrontTransaction,
  eventId: string,
): Promise<WebhookLedgerEntry | null> => {
  const result = await transaction.database.execute(sql`
    SELECT id, disposition, checkout_intent_id
    FROM public.stripe_events
    WHERE stripe_event_id = ${eventId}
    FOR UPDATE
  `);
  const row = result.rows[0];
  if (!row) return null;

  return {
    checkoutIntentId:
      row.checkout_intent_id === null || row.checkout_intent_id === undefined
        ? null
        : Number(row.checkout_intent_id),
    disposition: String(row.disposition) as WebhookLedgerEntry["disposition"],
    id: Number(row.id),
  };
};

export const persistWebhookLedgerEntry = async ({
  code,
  disposition,
  event,
  existingEventId,
  intentId,
  now,
  request,
}: {
  code?: StripeWebhookCode;
  disposition: "ignored" | "processed" | "rejected";
  event: WebhookEventEnvelope;
  existingEventId?: number;
  intentId?: number;
  now: Date;
  request: PayloadRequest;
}) => {
  if (existingEventId) {
    await request.payload.update({
      collection: "stripe-events",
      data: {
        checkoutIntent: intentId ?? null,
        code: code ?? null,
        disposition,
        processedAt: now.toISOString(),
      },
      depth: 0,
      id: existingEventId,
      overrideAccess: true,
      req: request,
    });
    return;
  }

  await request.payload.create({
    collection: "stripe-events",
    data: {
      ...(code ? { code } : {}),
      ...(intentId ? { checkoutIntent: intentId } : {}),
      disposition,
      eventType: event.type,
      processedAt: now.toISOString(),
      stripeCreatedAt: event.createdAt,
      stripeEventId: event.id,
    },
    depth: 0,
    overrideAccess: true,
    req: request,
  });
};
