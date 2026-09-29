import type { PayloadRequest } from "payload";

import { readEmailDeliveryEnvironment } from "./emailDeliveryEnvironment";
import { createEmailOutboxRepository } from "./emailOutboxRepository";
import { processEmailOutbox } from "./emailOutboxProcessor";
import { createResendEmailGateway } from "./resendEmailGateway";

export const deliverEmailOutbox = async ({
  orderId,
  request,
}: {
  orderId?: number;
  request: PayloadRequest;
}) => {
  const configuration = readEmailDeliveryEnvironment();
  return processEmailOutbox({
    configuration,
    gateway: configuration.enabled
      ? createResendEmailGateway({ apiKey: configuration.apiKey })
      : undefined,
    orderId,
    repository: createEmailOutboxRepository(request),
  });
};
