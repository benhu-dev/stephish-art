import {
  MAX_PHOTO_BYTES,
  SUPPORTED_PHOTO_MIME_TYPES,
} from "./clientCheckoutDraft";

const CURRENT_UPLOADS = "/api/storefront/checkout-intents/current/uploads";
const allowedMimeTypes = new Set(SUPPORTED_PHOTO_MIME_TYPES);

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type PreviewResult =
  | { kind: "aborted" | "failed" }
  | { kind: "ready"; previewUrl: string };

type PreviewDependencies = {
  createObjectURL?: (blob: Blob) => string;
  fetchImpl?: FetchLike;
  revokeObjectURL?: (url: string) => void;
};

type ActivePreview = {
  controller: AbortController;
  promise: Promise<PreviewResult>;
};

const validContentLength = (value: string | null, actual: number) => {
  if (value === null) return true;
  if (!/^[1-9]\d*$/.test(value)) return false;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed === actual;
};

export const createCheckoutPhotoPreviewManager = (
  dependencies: PreviewDependencies = {},
) => {
  const active = new Map<number, ActivePreview>();
  const ready = new Map<number, string>();
  let disposed = false;

  const release = (uploadId: number) => {
    const request = active.get(uploadId);
    if (request) {
      active.delete(uploadId);
      request.controller.abort();
    }
    const previewUrl = ready.get(uploadId);
    if (previewUrl) {
      ready.delete(uploadId);
      (dependencies.revokeObjectURL ?? URL.revokeObjectURL)(previewUrl);
    }
  };

  const load = (uploadId: number): Promise<PreviewResult> => {
    if (disposed || !Number.isSafeInteger(uploadId) || uploadId <= 0) {
      return Promise.resolve({ kind: disposed ? "aborted" : "failed" });
    }
    const existingUrl = ready.get(uploadId);
    if (existingUrl) {
      return Promise.resolve({ kind: "ready", previewUrl: existingUrl });
    }
    const existingRequest = active.get(uploadId);
    if (existingRequest) return existingRequest.promise;

    const controller = new AbortController();
    const request = { controller } as ActivePreview;
    const promise = (async (): Promise<PreviewResult> => {
      try {
        const response = await (dependencies.fetchImpl ?? globalThis.fetch)(
          `${CURRENT_UPLOADS}/${uploadId}/preview`,
          {
            cache: "no-store",
            credentials: "same-origin",
            method: "GET",
            signal: controller.signal,
          },
        );
        if (response.status !== 200) return { kind: "failed" };
        const contentType = response.headers.get("content-type");
        if (!contentType || !allowedMimeTypes.has(contentType)) {
          return { kind: "failed" };
        }
        const blob = await response.blob();
        if (
          controller.signal.aborted ||
          active.get(uploadId) !== request ||
          blob.size <= 0 ||
          blob.size > MAX_PHOTO_BYTES ||
          blob.type !== contentType ||
          !validContentLength(response.headers.get("content-length"), blob.size)
        ) {
          return controller.signal.aborted
            ? { kind: "aborted" }
            : { kind: "failed" };
        }

        const previewUrl = (dependencies.createObjectURL ?? URL.createObjectURL)(
          blob,
        );
        if (
          controller.signal.aborted ||
          disposed ||
          active.get(uploadId) !== request
        ) {
          (dependencies.revokeObjectURL ?? URL.revokeObjectURL)(previewUrl);
          return { kind: "aborted" };
        }
        ready.set(uploadId, previewUrl);
        return { kind: "ready", previewUrl };
      } catch {
        return controller.signal.aborted
          ? { kind: "aborted" }
          : { kind: "failed" };
      } finally {
        if (active.get(uploadId) === request) active.delete(uploadId);
      }
    })();
    request.promise = promise;
    active.set(uploadId, request);
    return promise;
  };

  return {
    dispose() {
      disposed = true;
      for (const uploadId of new Set([...active.keys(), ...ready.keys()])) {
        release(uploadId);
      }
    },
    load,
    release,
  };
};
