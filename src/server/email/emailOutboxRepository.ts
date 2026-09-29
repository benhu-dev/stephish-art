import type { PayloadRequest } from "payload";

import { ORDER_EMAIL_OUTBOX_KINDS } from "./emailOutbox";
import type {
  ClaimedEmailOutboxJob,
  EmailOutboxRepository,
  OrderEmailData,
} from "./emailDeliveryTypes";
import { EMAIL_OUTBOX_MAX_ATTEMPTS } from "./emailOutboxProcessor";

type QueryResult = {
  rowCount?: number | null;
  rows: Record<string, unknown>[];
};
type DatabasePool = {
  query: (text: string, values?: unknown[]) => Promise<QueryResult>;
};

const poolFor = (request: PayloadRequest) => {
  const pool = request.payload.db.pool as DatabasePool | undefined;
  if (!pool) throw new Error("EMAIL_OUTBOX_DATABASE_UNAVAILABLE");
  return pool;
};

const validInteger = (value: unknown, minimum = 0) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : null;
};

const validString = (value: unknown) =>
  typeof value === "string" && value.length > 0 ? value : null;

const claimedJob = (
  row: Record<string, unknown>,
  lease: string,
): ClaimedEmailOutboxJob | null => {
  const attempts = validInteger(row.attempts, 1);
  const id = validInteger(row.id, 1);
  const orderId = validInteger(row.order_id, 1);
  const kind = row.kind;
  if (
    attempts === null ||
    id === null ||
    orderId === null ||
    !ORDER_EMAIL_OUTBOX_KINDS.includes(kind as never)
  ) {
    return null;
  }
  return {
    attempts,
    id,
    kind: kind as ClaimedEmailOutboxJob["kind"],
    lease,
    orderId,
  };
};

const orderData = (row: Record<string, unknown>): OrderEmailData | null => {
  const subtotalCents = validInteger(row.subtotal_cents);
  const shippingCents = validInteger(row.shipping_cents);
  const totalCents = validInteger(row.total_cents);
  const referencePhotoCount = validInteger(row.reference_photo_count, 1);
  const customerEmail = validString(row.customer_email);
  const customerName = validString(row.customer_name);
  const recipientName = validString(row.recipient_name);
  const line1 = validString(row.line1);
  const city = validString(row.city);
  const country = validString(row.country);
  if (
    subtotalCents === null ||
    shippingCents === null ||
    totalCents === null ||
    referencePhotoCount === null ||
    !customerEmail ||
    !customerName ||
    !recipientName ||
    !line1 ||
    !city ||
    !country ||
    row.currency !== "usd" ||
    subtotalCents + shippingCents !== totalCents
  ) {
    return null;
  }
  return {
    artistNote: typeof row.artist_note === "string" ? row.artist_note : null,
    currency: "usd",
    customerEmail,
    customerName,
    referencePhotoCount,
    shippingAddress: {
      city,
      country,
      line1,
      line2: typeof row.line2 === "string" ? row.line2 : null,
      postalCode: typeof row.postal_code === "string" ? row.postal_code : null,
      recipientName,
      state: typeof row.state === "string" ? row.state : null,
    },
    shippingCents,
    subtotalCents,
    totalCents,
  };
};

const changed = (result: QueryResult) => (result.rowCount ?? 0) === 1;

export const createEmailOutboxRepository = (
  request: PayloadRequest,
): EmailOutboxRepository => {
  const pool = poolFor(request);
  return {
    async claim({ leaseExpiresBefore, limit, now, orderId }) {
      const lease = now.toISOString();
      const result = await pool.query(
        `WITH candidates AS (
          SELECT id FROM public.email_outbox
          WHERE attempts < $4
            AND ($5::integer IS NULL OR order_id = $5)
            AND (
              (status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= $1))
              OR (status = 'processing' AND locked_at <= $2)
            )
          ORDER BY next_attempt_at NULLS FIRST, id
          FOR UPDATE SKIP LOCKED
          LIMIT $3
        )
        UPDATE public.email_outbox AS jobs
        SET status = 'processing', attempts = jobs.attempts + 1,
          locked_at = $1, next_attempt_at = NULL, updated_at = $1
        FROM candidates
        WHERE jobs.id = candidates.id
        RETURNING jobs.id, jobs.order_id, jobs.kind, jobs.attempts`,
        [lease, leaseExpiresBefore.toISOString(), limit, EMAIL_OUTBOX_MAX_ATTEMPTS, orderId ?? null],
      );
      return result.rows.map((row) => claimedJob(row, lease)).filter((job): job is ClaimedEmailOutboxJob => Boolean(job));
    },

    async failExhausted({ leaseExpiresBefore, limit, orderId }) {
      const result = await pool.query(
        `WITH candidates AS (
          SELECT id FROM public.email_outbox
          WHERE status = 'processing' AND attempts >= $2 AND locked_at <= $1
            AND ($4::integer IS NULL OR order_id = $4)
          ORDER BY id
          FOR UPDATE SKIP LOCKED
          LIMIT $3
        )
        UPDATE public.email_outbox AS jobs
        SET status = 'failed', locked_at = NULL, next_attempt_at = NULL,
          last_error_code = 'lease_exhausted', updated_at = now()
        FROM candidates
        WHERE jobs.id = candidates.id
        RETURNING jobs.id`,
        [leaseExpiresBefore.toISOString(), EMAIL_OUTBOX_MAX_ATTEMPTS, limit, orderId ?? null],
      );
      return result.rows.length;
    },

    async loadOrder(orderId) {
      const result = await pool.query(
        `SELECT customers.full_name AS customer_name,
          orders.contact_email AS customer_email, orders.artist_note,
          orders.currency, orders.amount_cents AS total_cents,
          intents.amount_cents AS subtotal_cents,
          intents.shipping_amount_cents AS shipping_cents,
          orders.shipping_address_recipient_name AS recipient_name,
          orders.shipping_address_line1 AS line1,
          orders.shipping_address_line2 AS line2,
          orders.shipping_address_city AS city,
          orders.shipping_address_state AS state,
          orders.shipping_address_postal_code AS postal_code,
          orders.shipping_address_country AS country,
          count(uploads.id)::integer AS reference_photo_count
        FROM public.orders
        INNER JOIN public.customers ON customers.id = orders.customer_id
        INNER JOIN public.checkout_intents AS intents ON intents.id = orders.checkout_intent_id
        LEFT JOIN public.order_uploads AS uploads ON uploads.order_id = orders.id
        WHERE orders.id = $1 AND orders.payment_status = 'paid'
        GROUP BY orders.id, customers.id, intents.id`,
        [orderId],
      );
      return result.rows.length === 1 ? orderData(result.rows[0]) : null;
    },

    async markFailed(job, code) {
      return changed(await pool.query(
        `UPDATE public.email_outbox
        SET status = 'failed', locked_at = NULL, next_attempt_at = NULL,
          last_error_code = $3, updated_at = now()
        WHERE id = $1 AND status = 'processing' AND locked_at = $2
        RETURNING id`,
        [job.id, job.lease, code],
      ));
    },

    async markRetry(job, code, nextAttemptAt) {
      return changed(await pool.query(
        `UPDATE public.email_outbox
        SET status = 'pending', locked_at = NULL, next_attempt_at = $3,
          last_error_code = $4, updated_at = now()
        WHERE id = $1 AND status = 'processing' AND locked_at = $2
        RETURNING id`,
        [job.id, job.lease, nextAttemptAt.toISOString(), code],
      ));
    },

    async markSent(job, providerMessageId, sentAt) {
      return changed(await pool.query(
        `UPDATE public.email_outbox
        SET status = 'sent', locked_at = NULL, next_attempt_at = NULL,
          sent_at = $3, provider_message_id = $4, last_error_code = NULL,
          updated_at = $3
        WHERE id = $1 AND status = 'processing' AND locked_at = $2
        RETURNING id`,
        [job.id, job.lease, sentAt.toISOString(), providerMessageId],
      ));
    },
  };
};
