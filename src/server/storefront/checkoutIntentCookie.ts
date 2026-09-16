export const CHECKOUT_INTENT_COOKIE_NAME = "stephish_checkout_intent";
export const CHECKOUT_INTENT_COOKIE_PATH =
  "/api/storefront/checkout-intents";

export type CheckoutIntentCredential = {
  intentId: number;
  rawToken: string;
};

type ParsedCookie =
  | { kind: "malformed" }
  | { kind: "missing" }
  | { credential: CheckoutIntentCredential; kind: "valid" };

const rawTokenPattern = /^[A-Za-z0-9_-]{43}$/;

const serializeCredential = ({ intentId, rawToken }: CheckoutIntentCredential) =>
  `v1.${intentId}.${rawToken}`;

const cookieAttributes = (secure: boolean) =>
  `Path=${CHECKOUT_INTENT_COOKIE_PATH}; HttpOnly; SameSite=Strict${
    secure ? "; Secure" : ""
  }`;

export const parseCheckoutIntentCookie = (
  cookieHeader: string | null,
): ParsedCookie => {
  if (!cookieHeader) return { kind: "missing" };

  const matches = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter((part) =>
      part.startsWith(`${CHECKOUT_INTENT_COOKIE_NAME}=`),
    );

  if (matches.length === 0) return { kind: "missing" };
  if (matches.length !== 1) return { kind: "malformed" };

  let value: string;
  try {
    value = decodeURIComponent(matches[0].slice(matches[0].indexOf("=") + 1));
  } catch {
    return { kind: "malformed" };
  }

  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") {
    return { kind: "malformed" };
  }

  const intentId = Number(parts[1]);
  if (
    !Number.isSafeInteger(intentId) ||
    intentId <= 0 ||
    !rawTokenPattern.test(parts[2])
  ) {
    return { kind: "malformed" };
  }

  return {
    kind: "valid",
    credential: { intentId, rawToken: parts[2] },
  };
};

export const serializeCheckoutIntentCookie = (
  credential: CheckoutIntentCredential,
  expiresAt: Date,
  secure: boolean,
) =>
  `${CHECKOUT_INTENT_COOKIE_NAME}=${encodeURIComponent(
    serializeCredential(credential),
  )}; Expires=${expiresAt.toUTCString()}; ${cookieAttributes(secure)}`;

export const clearCheckoutIntentCookie = (secure: boolean) =>
  `${CHECKOUT_INTENT_COOKIE_NAME}=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; ${cookieAttributes(
    secure,
  )}`;
