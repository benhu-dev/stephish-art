import type Stripe from "stripe";

export const MAX_STRIPE_WEBHOOK_BODY_BYTES = 1024 * 1024;

type WebhookEndpointDependencies = {
  processEvent: (event: Stripe.Event) => Promise<unknown>;
  verifyEvent: (body: Buffer, signature: string) => Stripe.Event;
};

class InvalidWebhookRequest extends Error {}

const response = (status: number, body: Record<string, unknown>) =>
  Response.json(body, {
    headers: { "cache-control": "no-store" },
    status,
  });

const readBoundedBody = async (request: Request) => {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    if (!/^\d+$/.test(declaredLength)) throw new InvalidWebhookRequest();
    if (Number(declaredLength) > MAX_STRIPE_WEBHOOK_BODY_BYTES) {
      throw new InvalidWebhookRequest();
    }
  }

  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_STRIPE_WEBHOOK_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        throw new InvalidWebhookRequest();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, size);
};

const readSingleSignature = (headers: Headers) => {
  const signature = headers.get("stripe-signature");
  if (!signature || signature.length > 8192) throw new InvalidWebhookRequest();

  const timestamps = signature
    .split(",")
    .filter((part) => part.trimStart().startsWith("t="));
  if (timestamps.length !== 1) throw new InvalidWebhookRequest();

  return signature;
};

export const handleStripeWebhookRequest = async (
  request: Request,
  dependencies: WebhookEndpointDependencies,
) => {
  let event: Stripe.Event;
  try {
    const signature = readSingleSignature(request.headers);
    const body = await readBoundedBody(request);
    event = dependencies.verifyEvent(body, signature);
  } catch {
    return response(400, { error: "Invalid webhook request." });
  }

  try {
    await dependencies.processEvent(event);
    return response(200, { received: true });
  } catch {
    return response(500, { error: "Webhook processing failed." });
  }
};
