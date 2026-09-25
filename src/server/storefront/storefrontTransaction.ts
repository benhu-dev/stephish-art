import { sql } from "@payloadcms/db-postgres";
import { timingSafeEqual } from "node:crypto";
import type { PayloadRequest } from "payload";

import { hashCheckoutIntentToken } from "../checkout-intents/checkoutIntentCredentials";
import type { CheckoutIntentCredential } from "./checkoutIntentCookie";
import {
  StorefrontApiError,
  unauthorizedIntentError,
} from "./storefrontApiError";

type TransactionDatabase = {
  execute: (query: unknown) => Promise<{ rows: Record<string, unknown>[] }>;
};

type TransactionSession = {
  db: TransactionDatabase;
  reject: () => Promise<void>;
  resolve: () => Promise<void>;
};

export type StorefrontTransaction = {
  database: TransactionDatabase;
  id: string;
  request: PayloadRequest;
  session: TransactionSession;
};

export type LockedCheckoutIntent = {
  amountCents: number;
  checkoutAttemptId: string | null;
  checkoutStartedAt: string | null;
  deleteAfter: string;
  expiresAt: string;
  id: number;
  shippingAmountCents: number | null;
  status: string;
  stripeCheckoutSessionExpiresAt: string | null;
  stripeCheckoutSessionId: string | null;
  totalAmountCents: number | null;
};

const safelyMatchesHash = (actual: unknown, expected: string) => {
  if (typeof actual !== "string" || actual.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
};

export const beginStorefrontTransaction = async (
  request: PayloadRequest,
): Promise<StorefrontTransaction> => {
  if (request.transactionID) {
    throw new StorefrontApiError(500, "TRANSACTION_STATE_INVALID");
  }

  const id = await request.payload.db.beginTransaction();
  if (id === null || id === undefined) {
    throw new StorefrontApiError(500, "TRANSACTIONS_UNAVAILABLE");
  }
  request.transactionID = id;
  const session = request.payload.db.sessions?.[String(id)] as
    | TransactionSession
    | undefined;
  if (!session) {
    delete request.transactionID;
    throw new StorefrontApiError(500, "TRANSACTION_SESSION_UNAVAILABLE");
  }

  return { database: session.db, id: String(id), request, session };
};

export const lockAndAuthorizeCheckoutIntent = async (
  transaction: StorefrontTransaction,
  credential: CheckoutIntentCredential,
  { allowExpired = false }: { allowExpired?: boolean } = {},
): Promise<LockedCheckoutIntent> => {
  const result = await transaction.database.execute(sql`
    SELECT id, status, amount_cents, access_token_hash, expires_at, delete_after,
      checkout_attempt_id, checkout_started_at, shipping_amount_cents,
      total_amount_cents, stripe_checkout_session_id,
      stripe_checkout_session_expires_at
    FROM public.checkout_intents
    WHERE id = ${credential.intentId}
    FOR UPDATE
  `);
  const row = result.rows[0];
  const expectedHash = hashCheckoutIntentToken(credential.rawToken);
  if (!row || !safelyMatchesHash(row.access_token_hash, expectedHash)) {
    throw unauthorizedIntentError();
  }

  const expiresAt = new Date(String(row.expires_at));
  if (
    !Number.isFinite(expiresAt.getTime()) ||
    (!allowExpired && expiresAt <= new Date())
  ) {
    throw unauthorizedIntentError(true);
  }

  const amountCents = Number(row.amount_cents);
  const id = Number(row.id);
  if (!Number.isSafeInteger(amountCents) || !Number.isSafeInteger(id)) {
    throw new StorefrontApiError(500, "INVALID_PERSISTED_INTENT");
  }

  return {
    amountCents,
    checkoutAttemptId:
      typeof row.checkout_attempt_id === "string"
        ? row.checkout_attempt_id
        : null,
    checkoutStartedAt: row.checkout_started_at
      ? new Date(String(row.checkout_started_at)).toISOString()
      : null,
    deleteAfter: new Date(String(row.delete_after)).toISOString(),
    expiresAt: expiresAt.toISOString(),
    id,
    shippingAmountCents:
      row.shipping_amount_cents === null ||
      row.shipping_amount_cents === undefined
        ? null
        : Number(row.shipping_amount_cents),
    status: String(row.status),
    stripeCheckoutSessionExpiresAt: row.stripe_checkout_session_expires_at
      ? new Date(String(row.stripe_checkout_session_expires_at)).toISOString()
      : null,
    stripeCheckoutSessionId:
      typeof row.stripe_checkout_session_id === "string"
        ? row.stripe_checkout_session_id
        : null,
    totalAmountCents:
      row.total_amount_cents === null || row.total_amount_cents === undefined
        ? null
        : Number(row.total_amount_cents),
  };
};

export const commitStorefrontTransaction = async (
  transaction: StorefrontTransaction,
) => {
  const sessions = transaction.request.payload.db.sessions;
  if (!sessions?.[transaction.id]) {
    throw new StorefrontApiError(500, "TRANSACTION_ALREADY_CLOSED");
  }

  delete sessions[transaction.id];
  delete transaction.request.transactionID;
  await transaction.session.resolve();
};

export const rollbackStorefrontTransaction = async (
  transaction: StorefrontTransaction | undefined,
) => {
  if (!transaction) return;
  const sessions = transaction.request.payload.db.sessions;
  if (sessions?.[transaction.id]) {
    delete sessions[transaction.id];
    delete transaction.request.transactionID;
    await transaction.session.reject().catch(() => {});
  } else {
    delete transaction.request.transactionID;
  }
};
