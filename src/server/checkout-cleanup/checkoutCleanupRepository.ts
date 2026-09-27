import { sql } from "@payloadcms/db-postgres";
import type { PayloadRequest } from "payload";

import {
  beginStorefrontTransaction,
  commitStorefrontTransaction,
  rollbackStorefrontTransaction,
  type StorefrontTransaction,
} from "../storefront/storefrontTransaction";
import type {
  CleanupCandidate,
  CleanupCandidateLock,
  LockedCleanupCandidate,
} from "./checkoutCleanupTypes";

const candidateFrom = (value: Record<string, unknown>): CleanupCandidate => {
  const id = Number(value.id);
  const deleteAfter = new Date(
    String(value.deleteAfter ?? value.delete_after),
  );
  if (!Number.isSafeInteger(id) || !Number.isFinite(deleteAfter.getTime())) {
    throw new Error("INVALID_CLEANUP_CANDIDATE");
  }
  return {
    deleteAfter: deleteAfter.toISOString(),
    id,
    status: String(value.status),
    stripeCheckoutSessionId:
      typeof (value.stripeCheckoutSessionId ??
        value.stripe_checkout_session_id) === "string"
        ? String(
            value.stripeCheckoutSessionId ??
              value.stripe_checkout_session_id,
          )
        : null,
  };
};

const readLockedCandidate = async (
  transaction: StorefrontTransaction,
  id: number,
): Promise<LockedCleanupCandidate | null> => {
  const intentResult = await transaction.database.execute(sql`
    SELECT id, status, delete_after, stripe_checkout_session_id
    FROM public.checkout_intents
    WHERE id = ${id}
    FOR UPDATE
  `);
  const row = intentResult.rows[0];
  if (!row) return null;

  const uploadResult = await transaction.database.execute(sql`
    SELECT id, filename, order_id
    FROM public.order_uploads
    WHERE checkout_intent_id = ${id}
    ORDER BY id
    FOR UPDATE
  `);
  const orderResult = await transaction.database.execute(sql`
    SELECT id
    FROM public.orders
    WHERE checkout_intent_id = ${id}
    LIMIT 1
    FOR SHARE
  `);
  const candidate = candidateFrom(row);
  return {
    ...candidate,
    hasOrder: orderResult.rows.length > 0,
    uploads: uploadResult.rows.map((upload) => {
      const uploadId = Number(upload.id);
      const orderId =
        upload.order_id === null || upload.order_id === undefined
          ? null
          : Number(upload.order_id);
      if (
        !Number.isSafeInteger(uploadId) ||
        typeof upload.filename !== "string" ||
        upload.filename.length === 0 ||
        (orderId !== null && !Number.isSafeInteger(orderId))
      ) {
        throw new Error("INVALID_CLEANUP_UPLOAD");
      }
      return { filename: upload.filename, id: uploadId, orderId };
    }),
  };
};

export const listCleanupCandidates = async (
  request: PayloadRequest,
  { limit, now }: { limit: number; now: Date },
): Promise<CleanupCandidate[]> => {
  const result = await request.payload.find({
    collection: "checkout-intents",
    depth: 0,
    limit,
    overrideAccess: true,
    pagination: false,
    req: request,
    showHiddenFields: true,
    sort: "deleteAfter",
    where: { deleteAfter: { less_than_equal: now.toISOString() } },
  });
  return result.docs.slice(0, limit).map((document) =>
    candidateFrom(document as unknown as Record<string, unknown>),
  );
};

export const lockCleanupCandidate = async (
  request: PayloadRequest,
  id: number,
): Promise<CleanupCandidateLock | null> => {
  let transaction: StorefrontTransaction | undefined;
  try {
    transaction = await beginStorefrontTransaction(request);
    const initial = await readLockedCandidate(transaction, id);
    if (!initial) {
      await rollbackStorefrontTransaction(transaction);
      return null;
    }
    let closed = false;
    const requireOpen = () => {
      if (closed) throw new Error("CLEANUP_LOCK_CLOSED");
    };
    return {
      initial,
      revalidate: async () => {
        requireOpen();
        return readLockedCandidate(transaction!, id);
      },
      deleteUploads: async () => {
        requireOpen();
        const result = await transaction!.database.execute(sql`
          DELETE FROM public.order_uploads
          WHERE checkout_intent_id = ${id} AND order_id IS NULL
          RETURNING id
        `);
        return result.rows.length;
      },
      deleteIntent: async () => {
        requireOpen();
        const result = await transaction!.database.execute(sql`
          DELETE FROM public.checkout_intents
          WHERE id = ${id}
            AND NOT EXISTS (
              SELECT 1 FROM public.orders
              WHERE checkout_intent_id = ${id}
            )
            AND NOT EXISTS (
              SELECT 1 FROM public.order_uploads
              WHERE checkout_intent_id = ${id}
            )
          RETURNING id
        `);
        return result.rows.length === 1;
      },
      commit: async () => {
        requireOpen();
        closed = true;
        await commitStorefrontTransaction(transaction!);
      },
      rollback: async () => {
        if (closed) return;
        closed = true;
        await rollbackStorefrontTransaction(transaction);
      },
    };
  } catch (error) {
    await rollbackStorefrontTransaction(transaction);
    throw error;
  }
};
