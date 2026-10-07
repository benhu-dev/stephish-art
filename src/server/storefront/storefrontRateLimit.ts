import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import type { PayloadRequest } from "payload";

import type { CheckoutIntentCredential } from "./checkoutIntentCookie";
import {
  consumeRateLimitBucket,
  type RateLimitBucketInput,
  type RateLimitDecision,
} from "./storefrontRateLimitRepository";

export const STOREFRONT_RATE_LIMIT_POLICY = {
  abandon: { limit: 10, requiresCredential: true, windowSeconds: 15 * 60 },
  amountSave: { limit: 30, requiresCredential: true, windowSeconds: 15 * 60 },
  cartMutate: { limit: 30, requiresCredential: true, windowSeconds: 15 * 60 },
  cartRead: { limit: 60, requiresCredential: true, windowSeconds: 15 * 60 },
  checkoutSession: { limit: 10, requiresCredential: true, windowSeconds: 15 * 60 },
  currentRead: { limit: 60, requiresCredential: false, windowSeconds: 15 * 60 },
  intentCreate: { limit: 10, requiresCredential: false, windowSeconds: 15 * 60 },
  noteSave: { limit: 30, requiresCredential: true, windowSeconds: 15 * 60 },
  photoPreview: { limit: 90, requiresCredential: true, windowSeconds: 15 * 60 },
  photoRemove: { limit: 20, requiresCredential: true, windowSeconds: 15 * 60 },
  photoUpload: { limit: 12, requiresCredential: true, windowSeconds: 15 * 60 },
  statusPoll: { limit: 90, requiresCredential: true, windowSeconds: 5 * 60 },
} as const;

export type StorefrontRateLimitAction = keyof typeof STOREFRONT_RATE_LIMIT_POLICY;
type SubjectKind = "credential" | "network";

type RuntimeIdentity = {
  nodeEnv?: string;
  vercel?: string;
};

type RateLimitDependencies = {
  consume: (input: RateLimitBucketInput) => Promise<RateLimitDecision>;
  networkIdentity: (request: Pick<Request, "headers">) => string;
  secret: () => string;
};

export const resolveTrustedNetworkIdentity = (
  request: Pick<Request, "headers">,
  runtime: RuntimeIdentity = {
    nodeEnv: process.env.NODE_ENV,
    vercel: process.env.VERCEL,
  },
) => {
  if (runtime.nodeEnv !== "production") return "loopback";
  if (runtime.vercel !== "1") {
    throw new Error("RATE_LIMIT_IDENTITY_UNAVAILABLE");
  }
  const value = request.headers.get("x-vercel-forwarded-for");
  if (!value || value !== value.trim() || value.includes(",") || isIP(value) === 0) {
    throw new Error("RATE_LIMIT_IDENTITY_UNAVAILABLE");
  }
  return value;
};

const readRateLimitSecret = () => {
  const secret = process.env.PAYLOAD_SECRET;
  if (!secret) throw new Error("RATE_LIMIT_SECRET_UNAVAILABLE");
  return secret;
};

export const hashRateLimitSubject = ({
  action,
  kind,
  secret,
  subject,
}: {
  action: StorefrontRateLimitAction;
  kind: SubjectKind;
  secret: string;
  subject: string;
}) => {
  if (!secret || !subject) throw new Error("RATE_LIMIT_SUBJECT_INVALID");
  return createHmac("sha256", secret)
    .update("stephish-storefront-rate-limit\0v1\0", "utf8")
    .update(action, "utf8")
    .update("\0", "utf8")
    .update(kind, "utf8")
    .update("\0", "utf8")
    .update(subject, "utf8")
    .digest("hex");
};

const credentialSubject = (credential: CheckoutIntentCredential) =>
  `${credential.intentId}.${credential.rawToken}`;

export const enforceStorefrontRateLimit = async ({
  action,
  credential,
  dependencies: provided = {},
  request,
}: {
  action: StorefrontRateLimitAction;
  credential?: CheckoutIntentCredential;
  dependencies?: Partial<RateLimitDependencies>;
  request: PayloadRequest;
}): Promise<RateLimitDecision> => {
  const policy = STOREFRONT_RATE_LIMIT_POLICY[action];
  const consume = provided.consume ?? consumeRateLimitBucket;
  const networkIdentity = (provided.networkIdentity ?? resolveTrustedNetworkIdentity)(request);
  const secret = (provided.secret ?? readRateLimitSecret)();
  const consumeSubject = (kind: SubjectKind, subject: string) =>
    consume({
      limit: policy.limit,
      request,
      scope: `${action}:${kind}`,
      subjectHash: hashRateLimitSubject({ action, kind, secret, subject }),
      windowSeconds: policy.windowSeconds,
    });

  const networkDecision = await consumeSubject("network", networkIdentity);
  if (!networkDecision.allowed || !policy.requiresCredential || !credential) {
    return networkDecision;
  }
  return consumeSubject("credential", credentialSubject(credential));
};
