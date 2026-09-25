import {
  parseSafeCurrentResponse,
  type SafeIntentState,
} from "./checkoutIntentClient";

const CURRENT_ENDPOINT = "/api/storefront/checkout-intents/current";
const ABANDON_ENDPOINT = `${CURRENT_ENDPOINT}/abandon`;
const GENERIC_ERROR = "We couldn't update this checkout. Please try again.";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Options = { fetchImpl?: FetchLike; signal?: AbortSignal };

export type CurrentCheckoutResult =
  | { kind: "draft"; state: SafeIntentState }
  | { kind: "recovery" }
  | { kind: "processing" }
  | { kind: "fresh" }
  | { kind: "aborted" }
  | { kind: "failed" };

export type AbandonCheckoutResult =
  | { kind: "abandoned" | "aborted" | "fresh" | "processing" }
  | { kind: "failed"; message: string };

const isAbort = (error: unknown) =>
  error instanceof DOMException && error.name === "AbortError";

export async function readCurrentCheckoutState(
  { fetchImpl = globalThis.fetch, signal }: Options = {},
): Promise<CurrentCheckoutResult> {
  try {
    const response = await fetchImpl(CURRENT_ENDPOINT, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json", "Cache-Control": "no-store" },
      method: "GET",
      ...(signal ? { signal } : {}),
    });
    if (response.status === 401 || response.status === 410) return { kind: "fresh" };
    if (response.status !== 200) return { kind: "failed" };
    const state = parseSafeCurrentResponse(await response.json());
    if (!state) return { kind: "failed" };
    if (state.status === "checkout_created" || state.status === "checkout_pending") {
      return { kind: "recovery" };
    }
    if (state.status === "completed") return { kind: "processing" };
    if (state.status === "expired") return { kind: "fresh" };
    return {
      kind: "draft",
      state: {
        amountCents: state.amountCents,
        artistNote: state.artistNote,
        limits: state.limits,
        uploads: state.uploads,
      },
    };
  } catch (error) {
    return { kind: isAbort(error) ? "aborted" : "failed" };
  }
}

export async function abandonCurrentCheckout(
  { fetchImpl = globalThis.fetch, signal }: Options = {},
): Promise<AbandonCheckoutResult> {
  try {
    const response = await fetchImpl(ABANDON_ENDPOINT, {
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
    if (response.status === 204) return { kind: "abandoned" };
    if (response.status === 409) return { kind: "processing" };
    if (response.status === 401 || response.status === 410) return { kind: "fresh" };
    return { kind: "failed", message: GENERIC_ERROR };
  } catch (error) {
    return isAbort(error)
      ? { kind: "aborted" }
      : { kind: "failed", message: GENERIC_ERROR };
  }
}
