const CHECKOUT_SESSION_ENDPOINT =
  "/api/storefront/checkout-intents/current/checkout-session";
const CHECKOUT_ERROR = "We couldn't open secure checkout. Please try again.";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type RequestOptions = { fetchImpl?: FetchLike; signal?: AbortSignal };

export type CheckoutSessionResult =
  | { checkoutUrl: string; kind: "ready" }
  | { kind: "aborted" }
  | { kind: "fresh" | "processing" }
  | { kind: "failed"; message: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseCheckoutUrl = (value: unknown) => {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "checkout.stripe.com"
      && url.username === ""
      && url.password === ""
      && url.port === ""
      ? url.href
      : null;
  } catch {
    return null;
  }
};

const parseResponse = (value: unknown) => {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== "checkoutUrl" || keys[1] !== "expiresAt") {
    return null;
  }
  const checkoutUrl = parseCheckoutUrl(value.checkoutUrl);
  if (
    !checkoutUrl
    || typeof value.expiresAt !== "string"
    || !Number.isFinite(Date.parse(value.expiresAt))
  ) return null;
  return checkoutUrl;
};

export async function requestCheckoutSession(
  { fetchImpl = globalThis.fetch, signal }: RequestOptions = {},
): Promise<CheckoutSessionResult> {
  try {
    const response = await fetchImpl(CHECKOUT_SESSION_ENDPOINT, {
      body: JSON.stringify({}),
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
      },
      method: "POST",
      ...(signal ? { signal } : {}),
    });
    if (response.status === 409) return { kind: "processing" };
    if (response.status === 401 || response.status === 410) return { kind: "fresh" };
    if (response.status !== 200 && response.status !== 201) {
      return { kind: "failed", message: CHECKOUT_ERROR };
    }
    const checkoutUrl = parseResponse(await response.json());
    return checkoutUrl
      ? { checkoutUrl, kind: "ready" }
      : { kind: "failed", message: CHECKOUT_ERROR };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { kind: "aborted" };
    }
    return { kind: "failed", message: CHECKOUT_ERROR };
  }
}
