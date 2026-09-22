import { parseSafeResponse, type SafeIntentState } from "./checkoutIntentClient";

const CURRENT = "/api/storefront/checkout-intents/current";
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Options = { fetchImpl?: FetchLike; signal?: AbortSignal };
export type PhotoRequestResult =
  | { kind: "confirmed"; state: SafeIntentState }
  | { kind: "deleted" }
  | { kind: "unavailable" }
  | { kind: "uncertain" }
  | { kind: "failed" };

const unavailable = (status: number) => status === 401 || status === 410;
const requestOptions = (signal?: AbortSignal) => ({
  cache: "no-store" as const,
  credentials: "same-origin" as const,
  ...(signal ? { signal } : {}),
});

export async function uploadPhoto(
  file: File,
  position: number,
  { fetchImpl = globalThis.fetch, signal }: Options = {},
): Promise<PhotoRequestResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("_payload", JSON.stringify({ position }));
  try {
    const response = await fetchImpl(`${CURRENT}/uploads`, {
      ...requestOptions(signal), body: form, method: "POST",
    });
    if (unavailable(response.status)) return { kind: "unavailable" };
    if (response.status === 201) {
      const state = parseSafeResponse(await response.json());
      return state ? { kind: "confirmed", state } : { kind: "uncertain" };
    }
    return { kind: response.status >= 500 || response.status === 409 ? "uncertain" : "failed" };
  } catch {
    return { kind: "uncertain" };
  }
}

export async function deletePhoto(
  uploadId: number,
  { fetchImpl = globalThis.fetch, signal }: Options = {},
): Promise<PhotoRequestResult> {
  if (!Number.isSafeInteger(uploadId) || uploadId <= 0) return { kind: "failed" };
  try {
    const response = await fetchImpl(`${CURRENT}/uploads/${uploadId}`, {
      ...requestOptions(signal), method: "DELETE",
    });
    if (unavailable(response.status)) return { kind: "unavailable" };
    if (response.status === 204) return { kind: "deleted" };
    return { kind: response.status >= 500 || response.status === 404 ? "uncertain" : "failed" };
  } catch {
    return { kind: "uncertain" };
  }
}

export async function readCurrentPhotos(
  { fetchImpl = globalThis.fetch, signal }: Options = {},
): Promise<PhotoRequestResult> {
  try {
    const response = await fetchImpl(CURRENT, {
      ...requestOptions(signal), method: "GET",
    });
    if (unavailable(response.status)) return { kind: "unavailable" };
    if (response.status !== 200) return { kind: "uncertain" };
    const state = parseSafeResponse(await response.json());
    return state ? { kind: "confirmed", state } : { kind: "unavailable" };
  } catch {
    return { kind: "uncertain" };
  }
}
