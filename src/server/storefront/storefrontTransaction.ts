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
  deleteAfter: string;
  expiresAt: string;
  id: number;
  status: string;
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
): Promise<LockedCheckoutIntent> => {
  const result = await transaction.database.execute(sql`
    SELECT id, status, amount_cents, access_token_hash, expires_at, delete_after
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
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date()) {
    throw unauthorizedIntentError(true);
  }

  const amountCents = Number(row.amount_cents);
  const id = Number(row.id);
  if (!Number.isSafeInteger(amountCents) || !Number.isSafeInteger(id)) {
    throw new StorefrontApiError(500, "INVALID_PERSISTED_INTENT");
  }

  return {
    amountCents,
    deleteAfter: new Date(String(row.delete_after)).toISOString(),
    expiresAt: expiresAt.toISOString(),
    id,
    status: String(row.status),
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
