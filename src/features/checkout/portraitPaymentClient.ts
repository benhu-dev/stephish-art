import {
  requestCheckoutSession,
  type CheckoutSessionResult,
} from "./checkoutSessionClient";
import { GENERIC_RATE_LIMIT_MESSAGE } from "./checkoutRateLimitClient";

type Options = { fetchImpl?: typeof fetch; signal?: AbortSignal };
export type PortraitRecovery = {
  status:
    "draft" | "checkout_pending" | "checkout_created" | "completed" | "expired";
  checkoutKind: "portrait" | "legacy";
  shippingRegion: "us" | "international" | null;
  totalAmountCents: number | null;
};
type RecoveryResult =
  | { kind: "ready"; value: PortraitRecovery }
  | { kind: "fresh" | "aborted" | "failed"; message: string };
export const readPortraitRecovery = async ({
  fetchImpl = fetch,
  signal,
}: Options = {}): Promise<RecoveryResult> => {
  try {
    const response = await fetchImpl(
      "/api/storefront/checkout-intents/current/cart/recovery",
      {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        signal,
      },
    );
    if (response.status === 401 || response.status === 410)
      return { kind: "fresh", message: "This checkout has expired." };
    if (response.status === 429)
      return { kind: "failed", message: GENERIC_RATE_LIMIT_MESSAGE };
    if (!response.ok)
      return {
        kind: "failed",
        message: "We couldn't read your checkout. Please retry.",
      };
    const v: unknown = await response.json();
    if (typeof v !== "object" || v === null || Array.isArray(v))
      throw new Error();
    const r = v as PortraitRecovery;
    if (
      Object.keys(r).sort().join(",") !==
        "checkoutKind,shippingRegion,status,totalAmountCents" ||
      ![
        "draft",
        "checkout_pending",
        "checkout_created",
        "completed",
        "expired",
      ].includes(r.status) ||
      !["portrait", "legacy"].includes(r.checkoutKind) ||
      !["us", "international", null].includes(r.shippingRegion) ||
      (r.totalAmountCents !== null &&
        (!Number.isSafeInteger(r.totalAmountCents) ||
          r.totalAmountCents < 1)) ||
      (r.shippingRegion === null) !== (r.totalAmountCents === null) ||
      (r.checkoutKind === "legacy" && r.shippingRegion !== null) ||
      (r.status === "draft" && r.shippingRegion !== null)
    )
      throw new Error();
    return { kind: "ready", value: r };
  } catch {
    return {
      kind: signal?.aborted ? "aborted" : "failed",
      message: "We couldn't read your checkout. Please retry.",
    };
  }
};

export const requestPortraitPayment = (
  region: "us" | "international",
  options?: Options,
): Promise<CheckoutSessionResult> =>
  requestCheckoutSession({
    ...options,
    portraitCheckout: { shippingRegion: region, policyAccepted: true },
  });
