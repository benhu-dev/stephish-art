import type {
  EmailDeliveryConfiguration,
  EmailGateway,
  EmailOutboxRepository,
  EmailOutboxSummary,
} from "./emailDeliveryTypes";
import type { OrderEmailOutboxKind } from "./emailOutbox";
import {
  buildOrderEmailMessage,
  emailIdempotencyKey,
} from "./orderEmailTemplates";
import { EmailProviderError } from "./resendEmailGateway";

export const EMAIL_OUTBOX_BATCH_SIZE = 10;
export const EMAIL_OUTBOX_LEASE_MILLISECONDS = 10 * 60 * 1_000;
export const EMAIL_OUTBOX_MAX_ATTEMPTS = 5;

const emptySummary = (): EmailOutboxSummary => ({
  failed: 0,
  retried: 0,
  scanned: 0,
  sent: 0,
  skipped: 0,
});

const retryAt = (now: Date, attempts: number) =>
  new Date(
    now.getTime() + Math.min(6 * 60, 2 ** Math.max(0, attempts - 1)) * 60_000,
  );

export const processEmailOutbox = async ({
  configuration,
  gateway,
  now = new Date(),
  orderId,
  kind,
  repository,
}: {
  configuration: EmailDeliveryConfiguration;
  gateway?: EmailGateway;
  now?: Date;
  orderId?: number;
  kind?: OrderEmailOutboxKind;
  repository: EmailOutboxRepository;
}): Promise<EmailOutboxSummary> => {
  const summary = emptySummary();
  if (!configuration.enabled) {
    summary.skipped = 1;
    return summary;
  }

  if (!gateway) throw new Error("EMAIL_PROVIDER_UNAVAILABLE");

  const exhausted = await repository.failExhausted({
    leaseExpiresBefore: new Date(now.getTime() - EMAIL_OUTBOX_LEASE_MILLISECONDS),
    limit: EMAIL_OUTBOX_BATCH_SIZE,
    orderId,
    kind,
  });
  summary.failed = exhausted;
  summary.scanned = exhausted;

  const jobs = await repository.claim({
    leaseExpiresBefore: new Date(now.getTime() - EMAIL_OUTBOX_LEASE_MILLISECONDS),
    limit: EMAIL_OUTBOX_BATCH_SIZE - exhausted,
    now,
    orderId,
    kind,
  });
  summary.scanned += jobs.length;

  for (const job of jobs) {
    let message;
    try {
      const order = await repository.loadOrder(job.orderId);
      if (!order) throw new Error("ORDER_EMAIL_DATA_INVALID");
      message = buildOrderEmailMessage(job.kind, order, configuration);
    } catch {
      if (await repository.markFailed(job, "order_data_invalid")) {
        summary.failed += 1;
      } else {
        summary.skipped += 1;
      }
      continue;
    }

    try {
      const { providerMessageId } = await gateway.send(
        message,
        emailIdempotencyKey(job.id, job.kind),
      );
      if (await repository.markSent(job, providerMessageId, now)) {
        summary.sent += 1;
      } else {
        summary.skipped += 1;
      }
    } catch (error) {
      const providerError =
        error instanceof EmailProviderError
          ? error
          : new EmailProviderError("provider_unavailable", true);
      if (providerError.retryable && job.attempts < EMAIL_OUTBOX_MAX_ATTEMPTS) {
        if (
          await repository.markRetry(
            job,
            providerError.code,
            retryAt(now, job.attempts),
          )
        ) {
          summary.retried += 1;
        } else {
          summary.skipped += 1;
        }
      } else if (await repository.markFailed(job, providerError.code)) {
        summary.failed += 1;
      } else {
        summary.skipped += 1;
      }
    }
  }

  return summary;
};
