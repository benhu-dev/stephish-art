import { GENERIC_RATE_LIMIT_MESSAGE } from "./checkoutRateLimitClient";

export type SubjectInput = {
  id?: string;
  kind: "person" | "pet";
  name: string;
};
export type PortraitInput = {
  artistNote: string;
  subjects: SubjectInput[];
  templateId: number;
};
export type TemplatePreview = {
  alt: string;
  height: number;
  url: string;
  width: number;
};
export type CatalogTemplate = {
  description: string | null;
  id: number;
  name: string;
  preview: TemplatePreview;
};
export type PortraitPhoto = {
  height: number;
  id: number;
  mimeType: string;
  position: number;
  previewUrl: string;
  sizeBytes: number;
  subjectIds: string[];
  width: number;
};
export type CartPortrait = {
  amountCents: number;
  artistNote: string;
  id: string;
  position: number;
  subjects: (SubjectInput & { id: string; position: number })[];
  photos: PortraitPhoto[];
  photoState: {
    complete: boolean;
    coveredSubjectIds: string[];
    totalBytes: number;
  };
  template: Omit<CatalogTemplate, "preview"> & {
    available: boolean;
    preview: TemplatePreview | null;
  };
};
export type PortraitCart = {
  limits: {
    additionalSubjectAmountCents: number;
    baseAmountCents: number;
    maximumPortraits: number;
    maximumSubjectNameCharacters: number;
    maximumSubjectsPerPortrait: number;
    minimumPortraits: number;
    minimumSubjectsPerPortrait: number;
  };
  portraits: CartPortrait[];
  subtotalCents: number;
  uploadLimits: {
    maximumBytesPerCart: number;
    maximumBytesPerPortrait: number;
    maximumFilesPerCart: number;
    maximumFilesPerPortrait: number;
    maximumPixels: number;
    perFileUploadLimitBytes: number;
  };
};
type FetchLike = typeof globalThis.fetch;
type Options = { fetchImpl?: FetchLike; signal?: AbortSignal };
export type ClientResult<T> =
  | { kind: "ready"; value: T }
  | {
      kind: "fresh" | "locked" | "uncertain" | "aborted" | "failed";
      message: string;
    };

const ROOT = "/api/storefront/checkout-intents/current";
const CART = `${ROOT}/cart`;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const integer = (v: unknown, min = 1): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min;
const text = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.length <= max;
const uuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const keys = (v: Record<string, unknown>, names: string[]) =>
  Object.keys(v).length === names.length &&
  names.every((key) => Object.hasOwn(v, key));
const preview = (v: unknown): v is TemplatePreview =>
  record(v) &&
  keys(v, ["alt", "height", "url", "width"]) &&
  text(v.alt, 240) &&
  v.alt.trim().length > 0 &&
  integer(v.height) &&
  integer(v.width) &&
  typeof v.url === "string" &&
  /^\/api\/storefront\/template-media\/[1-9]\d*$/.test(v.url);
const template = (v: unknown): v is CatalogTemplate =>
  record(v) &&
  integer(v.id) &&
  text(v.name, 120) &&
  v.name.trim().length > 0 &&
  (v.description === null || text(v.description, 320)) &&
  preview(v.preview);

export const parseTemplateCatalog = (v: unknown): CatalogTemplate[] | null => {
  if (
    !record(v) ||
    !keys(v, ["templates"]) ||
    !Array.isArray(v.templates) ||
    v.templates.length > 100 ||
    !v.templates.every(
      (t) =>
        record(t) &&
        keys(t, ["description", "id", "name", "preview"]) &&
        template(t),
    )
  )
    return null;
  return new Set(v.templates.map((t) => t.id)).size === v.templates.length
    ? v.templates
    : null;
};

export const parsePortraitCart = (v: unknown): PortraitCart | null => {
  if (
    !record(v) ||
    !keys(v, ["limits", "portraits", "subtotalCents", "uploadLimits"]) ||
    !record(v.limits) ||
    !record(v.uploadLimits) ||
    !Array.isArray(v.portraits) ||
    !integer(v.subtotalCents, 0)
  )
    return null;
  const l = v.limits;
  const u = v.uploadLimits;
  if (
    !keys(l, [
      "additionalSubjectAmountCents",
      "baseAmountCents",
      "maximumPortraits",
      "maximumSubjectNameCharacters",
      "maximumSubjectsPerPortrait",
      "minimumPortraits",
      "minimumSubjectsPerPortrait",
    ]) ||
    !keys(u, [
      "maximumBytesPerCart",
      "maximumBytesPerPortrait",
      "maximumFilesPerCart",
      "maximumFilesPerPortrait",
      "maximumPixels",
      "perFileUploadLimitBytes",
    ]) ||
    !Object.values(l).every((n) => integer(n)) ||
    !Object.values(u).every((n) => integer(n)) ||
    Number(l.maximumPortraits) > 5 ||
    Number(l.maximumSubjectsPerPortrait) > 3 ||
    Number(l.maximumSubjectNameCharacters) > 80 ||
    Number(u.maximumFilesPerCart) > 15 ||
    Number(u.maximumFilesPerPortrait) > 3 ||
    Number(u.maximumPixels) > 50_000_000 ||
    Number(l.minimumSubjectsPerPortrait) !== 1 ||
    Number(l.minimumPortraits) !== 1 ||
    Number(u.perFileUploadLimitBytes) > 15 * 1024 * 1024 ||
    Number(u.maximumBytesPerPortrait) > 30 * 1024 * 1024 ||
    Number(u.maximumBytesPerCart) > 100 * 1024 * 1024 ||
    v.portraits.length > Number(l.maximumPortraits)
  )
    return null;
  const portraitIds = new Set<string>();
  const photoIds = new Set<number>();
  let bytes = 0;
  let subtotal = 0;
  for (const [index, p] of v.portraits.entries()) {
    if (
      !record(p) ||
      !keys(p, [
        "amountCents",
        "artistNote",
        "id",
        "position",
        "subjects",
        "photos",
        "photoState",
        "template",
      ]) ||
      !uuid(p.id) ||
      portraitIds.has(p.id) ||
      p.position !== index + 1 ||
      !text(p.artistNote, 1000) ||
      !Array.isArray(p.subjects) ||
      p.subjects.length < Number(l.minimumSubjectsPerPortrait) ||
      p.subjects.length > Number(l.maximumSubjectsPerPortrait) ||
      !Array.isArray(p.photos) ||
      p.photos.length > p.subjects.length ||
      !record(p.template)
    )
      return null;
    portraitIds.add(p.id);
    const t = p.template;
    if (
      !keys(t, ["available", "description", "id", "name", "preview"]) ||
      typeof t.available !== "boolean" ||
      !integer(t.id) ||
      !text(t.name, 120) ||
      !t.name.trim() ||
      !(t.description === null || text(t.description, 320)) ||
      (t.available ? !preview(t.preview) : t.preview !== null)
    )
      return null;
    const ids = new Set<string>();
    for (const [position, s] of p.subjects.entries()) {
      if (
        !record(s) ||
        !keys(s, ["id", "kind", "name", "position"]) ||
        !uuid(s.id) ||
        ids.has(s.id) ||
        !["person", "pet"].includes(String(s.kind)) ||
        !text(s.name, Number(l.maximumSubjectNameCharacters)) ||
        !s.name.trim() ||
        s.position !== position + 1
      )
        return null;
      ids.add(s.id);
    }
    const amount =
      Number(l.baseAmountCents) +
      (p.subjects.length - 1) * Number(l.additionalSubjectAmountCents);
    if (p.amountCents !== amount) return null;
    subtotal += amount;
    const covered = new Set<string>();
    let portraitBytes = 0;
    for (const [position, photo] of p.photos.entries()) {
      if (
        !record(photo) ||
        !keys(photo, [
          "height",
          "id",
          "mimeType",
          "position",
          "previewUrl",
          "sizeBytes",
          "subjectIds",
          "width",
        ]) ||
        !integer(photo.id) ||
        photoIds.has(photo.id) ||
        photo.position !== position + 1 ||
        !integer(photo.sizeBytes) ||
        photo.sizeBytes > Number(u.perFileUploadLimitBytes) ||
        !integer(photo.width) ||
        !integer(photo.height) ||
        photo.width * photo.height > Number(u.maximumPixels) ||
        !MIME.has(String(photo.mimeType)) ||
        photo.previewUrl !==
          `${CART}/portraits/${p.id}/uploads/${photo.id}/preview` ||
        !Array.isArray(photo.subjectIds) ||
        photo.subjectIds.length < 1 ||
        photo.subjectIds.length > ids.size ||
        new Set(photo.subjectIds).size !== photo.subjectIds.length ||
        !photo.subjectIds.every((id) => typeof id === "string" && ids.has(id))
      )
        return null;
      photoIds.add(photo.id);
      photo.subjectIds.forEach((id: string) => covered.add(id));
      portraitBytes += photo.sizeBytes;
    }
    if (
      !record(p.photoState) ||
      !keys(p.photoState, ["complete", "coveredSubjectIds", "totalBytes"]) ||
      p.photoState.complete !== (covered.size === ids.size) ||
      p.photoState.totalBytes !== portraitBytes ||
      !Array.isArray(p.photoState.coveredSubjectIds) ||
      p.photoState.coveredSubjectIds.length !== covered.size ||
      new Set(p.photoState.coveredSubjectIds).size !== covered.size ||
      !p.photoState.coveredSubjectIds.every(
        (id) => typeof id === "string" && covered.has(id),
      ) ||
      portraitBytes > Number(u.maximumBytesPerPortrait)
    )
      return null;
    bytes += portraitBytes;
  }
  if (
    subtotal !== v.subtotalCents ||
    bytes > Number(u.maximumBytesPerCart) ||
    photoIds.size > Number(u.maximumFilesPerCart)
  )
    return null;
  return v as unknown as PortraitCart;
};

const generic =
  "We couldn't save that change. Check your connection and try again.";
const errorMessage = (status: number, code: unknown) => {
  if (status === 429) return GENERIC_RATE_LIMIT_MESSAGE;
  if (code === "TEMPLATE_UNAVAILABLE")
    return "That template is no longer available. Choose another design.";
  if (
    code === "PORTRAIT_UPLOAD_MAPPING_CONFLICT" ||
    code === "UNKNOWN_PHOTO_SUBJECT" ||
    code === "INVALID_PHOTO_COUNT"
  )
    return "Adjust or remove the affected photos before removing a subject.";
  if (status === 413 || status === 422)
    return "Check the names, photo assignments and image limits, then try again.";
  if (status === 409)
    return "This draft changed or can no longer be edited. Reload it before continuing.";
  return generic;
};

async function request<T>(
  path: string,
  init: RequestInit,
  parse: (v: unknown) => T | null,
  { fetchImpl = globalThis.fetch, signal }: Options = {},
): Promise<ClientResult<T>> {
  const mutation = init.method !== "GET";
  try {
    const response = await fetchImpl(path, {
      ...init,
      cache: "no-store",
      credentials: "same-origin",
      ...(signal ? { signal } : {}),
    });
    if ([401, 410].includes(response.status))
      return {
        kind: "fresh",
        message: "This draft has expired. Start a new portrait.",
      };
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const code = record(body) && record(body.error) ? body.error.code : null;
      return {
        kind:
          mutation && response.status >= 500
            ? "uncertain"
            : code === "INTENT_NOT_DRAFT" || code === "CHECKOUT_ALREADY_STARTED"
              ? "locked"
              : "failed",
        message: errorMessage(response.status, code),
      };
    }
    const value = parse(await response.json());
    return value === null
      ? { kind: mutation ? "uncertain" : "failed", message: generic }
      : { kind: "ready", value };
  } catch {
    return {
      kind: signal?.aborted ? "aborted" : mutation ? "uncertain" : "failed",
      message: generic,
    };
  }
}

export const readTemplateCatalog = (options?: Options) =>
  request(
    "/api/storefront/postcard-templates",
    { method: "GET" },
    parseTemplateCatalog,
    options,
  );
export const readCart = (options?: Options) =>
  request(CART, { method: "GET" }, parsePortraitCart, options);
export const startPortraitDraft = (options?: Options) =>
  request(
    "/api/storefront/checkout-intents/portrait-draft",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
    (v) =>
      record(v) && keys(v, ["status"]) && v.status === "draft"
        ? ("draft" as const)
        : null,
    options,
  );
export const savePortrait = (
  input: PortraitInput,
  id?: string,
  options?: Options,
) => {
  if (id !== undefined && !uuid(id))
    return Promise.resolve<ClientResult<PortraitCart>>({
      kind: "failed",
      message: generic,
    });
  return request(
    `${CART}/portraits${id ? `/${id}` : ""}`,
    {
      method: id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    parsePortraitCart,
    options,
  );
};
export const removePortrait = (id: string, options?: Options) =>
  uuid(id)
    ? request(
        `${CART}/portraits/${id}`,
        { method: "DELETE" },
        parsePortraitCart,
        options,
      )
    : Promise.resolve<ClientResult<PortraitCart>>({
        kind: "failed",
        message: generic,
      });
export const changePortraitPhoto = (
  portraitId: string,
  photoId: number,
  metadata: { position: number; subjectIds: string[] } | null,
  options?: Options,
) => {
  if (!uuid(portraitId) || !integer(photoId))
    return Promise.resolve<ClientResult<PortraitCart>>({
      kind: "failed",
      message: generic,
    });
  return request(
    `${CART}/portraits/${portraitId}/uploads/${photoId}`,
    metadata
      ? {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(metadata),
        }
      : { method: "DELETE" },
    parsePortraitCart,
    options,
  );
};
export const uploadPortraitPhoto = (
  portraitId: string,
  file: File,
  metadata: { position: number; subjectIds: string[] },
  options?: Options,
) => {
  if (!uuid(portraitId))
    return Promise.resolve<ClientResult<PortraitCart>>({
      kind: "failed",
      message: generic,
    });
  const form = new FormData();
  form.append("file", file);
  form.append("_payload", JSON.stringify(metadata));
  return request(
    `${CART}/portraits/${portraitId}/uploads`,
    { method: "POST", body: form },
    parsePortraitCart,
    options,
  );
};

// Read-only current state does not retrieve Stripe Sessions, unlike /recovery.
export const readPreviewIntent = (options?: Options) =>
  request(
    ROOT,
    { method: "GET" },
    (v) => {
      if (
        !record(v) ||
        ![
          "draft",
          "checkout_pending",
          "checkout_created",
          "completed",
          "expired",
        ].includes(String(v.status)) ||
        !Array.isArray(v.uploads) ||
        !integer(v.amountCents)
      )
        return null;
      return {
        status: v.status as
          | "draft"
          | "checkout_pending"
          | "checkout_created"
          | "completed"
          | "expired",
        hasUploads: v.uploads.length > 0,
      };
    },
    options,
  );

export const money = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(cents / 100);
export const cartReady = (cart: PortraitCart) =>
  cart.portraits.length >= cart.limits.minimumPortraits &&
  cart.portraits.every((p) => p.template.available && p.photoState.complete);

export function validateNewPhoto(
  file: File,
  portrait: CartPortrait,
  cart: PortraitCart,
  subjectIds: string[],
): string | null {
  if (!MIME.has(file.type)) return "Choose a JPEG, PNG or WebP image.";
  if (file.size <= 0 || file.size > cart.uploadLimits.perFileUploadLimitBytes)
    return "Each photo must be 15 MiB or smaller.";
  if (!subjectIds.length) return "Choose who appears in this photo.";
  if (
    portrait.photos.length >= portrait.subjects.length ||
    portrait.photos.length >= cart.uploadLimits.maximumFilesPerPortrait
  )
    return "You can upload at most one photo per person or pet.";
  if (
    portrait.photoState.totalBytes + file.size >
    cart.uploadLimits.maximumBytesPerPortrait
  )
    return "Keep this portrait's photos within 30 MiB.";
  if (
    cart.portraits.reduce((sum, p) => sum + p.photoState.totalBytes, 0) +
      file.size >
      cart.uploadLimits.maximumBytesPerCart ||
    cart.portraits.reduce((sum, p) => sum + p.photos.length, 0) >=
      cart.uploadLimits.maximumFilesPerCart
  )
    return "This cart has reached its photo limit.";
  return null;
}
