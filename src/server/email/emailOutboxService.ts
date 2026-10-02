import type { PayloadRequest } from "payload";
import type { OrderEmailOutboxKind } from "./emailOutbox";

import { readEmailDeliveryEnvironment } from "./emailDeliveryEnvironment";
import { createEmailOutboxRepository } from "./emailOutboxRepository";
import { processEmailOutbox } from "./emailOutboxProcessor";
import { createResendEmailGateway } from "./resendEmailGateway";

export const deliverEmailOutbox = async ({
  kind,
  orderId,
  request,
}: {
  kind?: OrderEmailOutboxKind;
  orderId?: number;
  request: PayloadRequest;
}) => {
  const configuration = readEmailDeliveryEnvironment();
  return processEmailOutbox({
    configuration,
    gateway: configuration.enabled
      ? createResendEmailGateway({ apiKey: configuration.apiKey })
      : undefined,
    kind,
    orderId,
    repository: createEmailOutboxRepository(request),
  });
};
