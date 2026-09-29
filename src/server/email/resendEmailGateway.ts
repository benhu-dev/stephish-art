import type { EmailGateway, OrderEmailMessage } from "./emailDeliveryTypes";

export class EmailProviderError extends Error {
  code: string;
  retryable: boolean;

  constructor(code: string, retryable: boolean) {
    super("EMAIL_PROVIDER_REQUEST_FAILED");
    this.name = "EmailProviderError";
    this.code = code;
    this.retryable = retryable;
  }
}

const providerErrorFor = (status: number) => {
  if (status === 408 || status === 409 || status === 429 || status >= 500) {
    return new EmailProviderError(
      status === 429 ? "provider_rate_limited" : "provider_unavailable",
      true,
    );
  }
  return new EmailProviderError("provider_rejected", false);
};

export const createResendEmailGateway = ({
  apiKey,
  fetchImplementation = fetch,
}: {
  apiKey: string;
  fetchImplementation?: typeof fetch;
}): EmailGateway => ({
  async send(message: OrderEmailMessage, idempotencyKey: string) {
    let response: Response;
    try {
      response = await fetchImplementation("https://api.resend.com/emails", {
        body: JSON.stringify({
          from: message.from,
          html: message.html,
          reply_to: message.replyTo,
          subject: message.subject,
          text: message.text,
          to: [message.to],
        }),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        method: "POST",
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      throw new EmailProviderError("provider_network_error", true);
    }
    if (!response.ok) throw providerErrorFor(response.status);

    let result: unknown;
    try {
      result = await response.json();
    } catch {
      throw new EmailProviderError("provider_invalid_response", true);
    }
    const providerMessageId =
      typeof result === "object" &&
      result !== null &&
      "id" in result &&
      typeof result.id === "string" &&
      result.id.length > 0 &&
      result.id.length <= 255
        ? result.id
        : null;
    if (!providerMessageId) {
      throw new EmailProviderError("provider_invalid_response", true);
    }
    return { providerMessageId };
  },
});
