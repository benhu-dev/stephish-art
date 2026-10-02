import type { OrderEmailOutboxKind } from "./emailOutbox";

export type EmailDeliveryConfiguration =
  | { enabled: false }
  | {
      apiKey: string;
      artistOrderEmail: string;
      enabled: true;
      from: string;
      replyTo: string;
    };

export type OrderEmailData = {
  artistNote: string | null;
  currency: "usd";
  customerEmail: string;
  customerName: string;
  referencePhotoCount: number;
  shippingAddress: {
    city: string;
    country: string;
    line1: string;
    line2: string | null;
    postalCode: string | null;
    recipientName: string;
    state: string | null;
  };
  shippingCents: number;
  shipment: {
    carrier: "fedex" | "other" | "ups" | "usps" | null;
    shippedAt: string;
    trackingNumber: string | null;
  } | null;
  subtotalCents: number;
  totalCents: number;
};

export type OrderEmailMessage = {
  from: string;
  html: string;
  replyTo: string;
  subject: string;
  text: string;
  to: string;
};

export type EmailGateway = {
  send: (
    message: OrderEmailMessage,
    idempotencyKey: string,
  ) => Promise<{ providerMessageId: string }>;
};

export type ClaimedEmailOutboxJob = {
  attempts: number;
  id: number;
  kind: OrderEmailOutboxKind;
  lease: string;
  orderId: number;
};

export type EmailOutboxSummary = {
  failed: number;
  retried: number;
  scanned: number;
  sent: number;
  skipped: number;
};

export type EmailOutboxRepository = {
  claim: (options: {
    kind?: OrderEmailOutboxKind;
    leaseExpiresBefore: Date;
    limit: number;
    now: Date;
    orderId?: number;
  }) => Promise<ClaimedEmailOutboxJob[]>;
  failExhausted: (options: {
    kind?: OrderEmailOutboxKind;
    leaseExpiresBefore: Date;
    limit: number;
    orderId?: number;
  }) => Promise<number>;
  loadOrder: (orderId: number) => Promise<OrderEmailData | null>;
  markFailed: (job: ClaimedEmailOutboxJob, code: string) => Promise<boolean>;
  markRetry: (
    job: ClaimedEmailOutboxJob,
    code: string,
    nextAttemptAt: Date,
  ) => Promise<boolean>;
  markSent: (
    job: ClaimedEmailOutboxJob,
    providerMessageId: string,
    sentAt: Date,
  ) => Promise<boolean>;
};
