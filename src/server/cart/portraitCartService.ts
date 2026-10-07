import { sql } from "@payloadcms/db-postgres";
import { randomUUID } from "node:crypto";
import type { PayloadRequest } from "payload";

import { authorizeCheckoutIntent } from "../storefront/checkoutIntentAccess";
import type { CheckoutIntentCredential } from "../storefront/checkoutIntentCookie";
import { StorefrontApiError } from "../storefront/storefrontApiError";
import {
  beginStorefrontTransaction,
  commitStorefrontTransaction,
  lockAndAuthorizeCheckoutIntent,
  rollbackStorefrontTransaction,
  type LockedCheckoutIntent,
  type StorefrontTransaction,
} from "../storefront/storefrontTransaction";
import {
  PORTRAIT_CART_POLICY,
  calculateCartSubtotalCents,
  calculatePortraitAmountCents,
  isPortraitPublicId,
  resolvePortraitSubjects,
  validateStoredPortraitSubjects,
  type PortraitMutationRequest,
} from "./portraitCartPolicy";

type PortraitDocument = Record<string, unknown> & {
  amountCents: number;
  artistNote?: string | null;
  id: number | string;
  position: number;
  publicId: string;
  subjects?: unknown[] | null;
  template: unknown;
};

type TemplateDocument = Record<string, unknown> & {
  available: boolean;
  description?: string | null;
  id: number | string;
  name: string;
  previewMedia: unknown;
};

const requireDraft = (intent: LockedCheckoutIntent) => {
  if (intent.status !== "draft") {
    throw new StorefrontApiError(409, "INTENT_NOT_DRAFT");
  }
};

const requirePositiveInteger = (value: unknown, code: string) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new StorefrontApiError(500, code);
  }
  return number;
};

const requireShortText = (
  value: unknown,
  maximum: number,
  code: string,
) => {
  if (typeof value !== "string") throw new StorefrontApiError(500, code);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new StorefrontApiError(500, code);
  }
  return normalized;
};

const readPortraitDocuments = async (
  request: PayloadRequest,
  intentId: number,
): Promise<PortraitDocument[]> => {
  const result = await request.payload.find({
    collection: "checkout-portraits",
    depth: 2,
    limit: PORTRAIT_CART_POLICY.maximumPortraits + 1,
    overrideAccess: true,
    pagination: false,
    req: request,
    sort: "position",
    where: { intent: { equals: intentId } },
  });
  return result.docs as unknown as PortraitDocument[];
};

const safeTemplate = (value: unknown) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StorefrontApiError(500, "INVALID_CART_TEMPLATE");
  }
  const template = value as TemplateDocument;
  const id = requirePositiveInteger(template.id, "INVALID_CART_TEMPLATE");
  const name = requireShortText(template.name, 120, "INVALID_CART_TEMPLATE");
  const description =
    typeof template.description === "string"
      ? template.description.trim()
      : "";
  if (description.length > 320 || typeof template.available !== "boolean") {
    throw new StorefrontApiError(500, "INVALID_CART_TEMPLATE");
  }

  let preview: null | {
    alt: string;
    height: number;
    url: string;
    width: number;
  } = null;
  if (template.available) {
    if (
      typeof template.previewMedia !== "object" ||
      template.previewMedia === null ||
      Array.isArray(template.previewMedia)
    ) {
      throw new StorefrontApiError(500, "INVALID_CART_TEMPLATE");
    }
    const media = template.previewMedia as Record<string, unknown>;
    const mediaId = requirePositiveInteger(
      media.id,
      "INVALID_CART_TEMPLATE",
    );
    preview = {
      alt: requireShortText(media.alt, 240, "INVALID_CART_TEMPLATE"),
      height: requirePositiveInteger(media.height, "INVALID_CART_TEMPLATE"),
      url: `/api/storefront/template-media/${mediaId}`,
      width: requirePositiveInteger(media.width, "INVALID_CART_TEMPLATE"),
    };
  }

  return {
    available: template.available,
    description: description || null,
    id,
    name,
    preview,
  };
};

export const buildSafePortraitCartResponse = ({
  intentAmountCents,
  portraits: documents,
}: {
  intentAmountCents: number;
  portraits: PortraitDocument[];
}) => {
  if (documents.length > PORTRAIT_CART_POLICY.maximumPortraits) {
    throw new StorefrontApiError(500, "INVALID_CART_STATE");
  }
  const publicIds = new Set<string>();
  const portraits = documents.map((portrait, index) => {
    if (
      !isPortraitPublicId(portrait.publicId) ||
      publicIds.has(portrait.publicId) ||
      portrait.position !== index + 1
    ) {
      throw new StorefrontApiError(500, "INVALID_CART_STATE");
    }
    publicIds.add(portrait.publicId);
    const subjects = validateStoredPortraitSubjects(portrait.subjects);
    const amountCents = calculatePortraitAmountCents(subjects.length);
    if (portrait.amountCents !== amountCents) {
      throw new StorefrontApiError(500, "INVALID_PORTRAIT_AMOUNT");
    }
    return {
      amountCents,
      artistNote:
        typeof portrait.artistNote === "string" ? portrait.artistNote : "",
      id: portrait.publicId,
      position: index + 1,
      subjects: subjects.map(({ kind, name, position, subjectId }) => ({
        id: subjectId,
        kind,
        name,
        position,
      })),
      template: safeTemplate(portrait.template),
    };
  });
  const subtotalCents =
    portraits.length === 0
      ? 0
      : calculateCartSubtotalCents(
          portraits.map(({ amountCents }) => amountCents),
        );
  if (
    portraits.length > 0 &&
    (!Number.isSafeInteger(intentAmountCents) ||
      intentAmountCents !== subtotalCents)
  ) {
    throw new StorefrontApiError(500, "INVALID_CART_SUBTOTAL");
  }
  return {
    limits: { ...PORTRAIT_CART_POLICY },
    portraits,
    subtotalCents,
  };
};

const readAvailableTemplate = async (
  request: PayloadRequest,
  templateId: number,
) => {
  let template: TemplateDocument;
  try {
    template = (await request.payload.findByID({
      collection: "postcard-templates",
      depth: 1,
      id: templateId,
      overrideAccess: true,
      req: request,
      select: {
        available: true,
        description: true,
        name: true,
        previewMedia: true,
      },
    })) as unknown as TemplateDocument;
  } catch {
    throw new StorefrontApiError(422, "TEMPLATE_UNAVAILABLE");
  }
  if (template.available !== true) {
    throw new StorefrontApiError(422, "TEMPLATE_UNAVAILABLE");
  }
  return template;
};

const updateIntentSubtotal = async (
  request: PayloadRequest,
  intentId: number,
  documents: PortraitDocument[],
) => {
  const subtotalCents = calculateCartSubtotalCents(
    documents.map(({ amountCents }) => amountCents),
  );
  await request.payload.update({
    collection: "checkout-intents",
    data: { amountCents: subtotalCents },
    depth: 0,
    id: intentId,
    overrideAccess: true,
    req: request,
  });
  return subtotalCents;
};

const reorderPositions = async ({
  documents,
  intentId,
  request,
  transaction,
}: {
  documents: PortraitDocument[];
  intentId: number;
  request: PayloadRequest;
  transaction: StorefrontTransaction;
}) => {
  await transaction.database.execute(sql`
    UPDATE public.checkout_portraits
    SET position = -position
    WHERE intent_id = ${intentId}
  `);
  for (const [index, document] of documents.entries()) {
    await request.payload.update({
      collection: "checkout-portraits",
      data: { position: index + 1 },
      depth: 0,
      id: document.id,
      overrideAccess: true,
      req: request,
    });
  }
};

const withDraftCartTransaction = async <T>(
  request: PayloadRequest,
  credential: CheckoutIntentCredential,
  mutate: (
    transaction: StorefrontTransaction,
    intent: LockedCheckoutIntent,
  ) => Promise<T>,
  dependencies: PortraitCartTransactionDependencies =
    defaultTransactionDependencies,
) => {
  let transaction: StorefrontTransaction | undefined;
  try {
    transaction = await dependencies.begin(request);
    const intent = await dependencies.lock(transaction, credential);
    requireDraft(intent);
    const result = await mutate(transaction, intent);
    await dependencies.commit(transaction);
    transaction = undefined;
    return result;
  } catch (error) {
    await dependencies.rollback(transaction);
    if (error instanceof StorefrontApiError) throw error;
    throw new StorefrontApiError(500, "CART_UPDATE_FAILED");
  }
};

export type PortraitCartTransactionDependencies = {
  begin: typeof beginStorefrontTransaction;
  commit: typeof commitStorefrontTransaction;
  lock: typeof lockAndAuthorizeCheckoutIntent;
  rollback: typeof rollbackStorefrontTransaction;
};

const defaultTransactionDependencies: PortraitCartTransactionDependencies = {
  begin: beginStorefrontTransaction,
  commit: commitStorefrontTransaction,
  lock: lockAndAuthorizeCheckoutIntent,
  rollback: rollbackStorefrontTransaction,
};

export const readPortraitCart = async ({
  credential,
  request,
}: {
  credential: CheckoutIntentCredential;
  request: PayloadRequest;
}) => {
  const intent = await authorizeCheckoutIntent(request, credential);
  const portraits = await readPortraitDocuments(request, intent.id);
  return buildSafePortraitCartResponse({
    intentAmountCents: intent.amountCents,
    portraits,
  });
};

export const addPortraitToCart = async ({
  credential,
  input,
  request,
  transactionDependencies,
}: {
  credential: CheckoutIntentCredential;
  input: PortraitMutationRequest;
  request: PayloadRequest;
  transactionDependencies?: PortraitCartTransactionDependencies;
}) =>
  withDraftCartTransaction(request, credential, async (_transaction, intent) => {
    const existing = await readPortraitDocuments(request, intent.id);
    if (existing.length >= PORTRAIT_CART_POLICY.maximumPortraits) {
      throw new StorefrontApiError(409, "PORTRAIT_COUNT_LIMIT");
    }
    await readAvailableTemplate(request, input.templateId);
    const subjects = resolvePortraitSubjects({
      requestedSubjects: input.subjects,
    });
    await request.payload.create({
      collection: "checkout-portraits",
      data: {
        amountCents: calculatePortraitAmountCents(subjects.length),
        artistNote: input.artistNote,
        intent: intent.id,
        position: existing.length + 1,
        publicId: randomUUID(),
        subjects,
        template: input.templateId,
      },
      depth: 0,
      overrideAccess: true,
      req: request,
    });
    const portraits = await readPortraitDocuments(request, intent.id);
    const subtotalCents = await updateIntentSubtotal(
      request,
      intent.id,
      portraits,
    );
    return buildSafePortraitCartResponse({
      intentAmountCents: subtotalCents,
      portraits,
    });
  }, transactionDependencies);

export const replaceCartPortrait = async ({
  credential,
  input,
  portraitId,
  request,
  transactionDependencies,
}: {
  credential: CheckoutIntentCredential;
  input: PortraitMutationRequest;
  portraitId: string;
  request: PayloadRequest;
  transactionDependencies?: PortraitCartTransactionDependencies;
}) =>
  withDraftCartTransaction(request, credential, async (_transaction, intent) => {
    const existing = await readPortraitDocuments(request, intent.id);
    const portrait = existing.find(({ publicId }) => publicId === portraitId);
    if (!portrait) throw new StorefrontApiError(404, "PORTRAIT_NOT_FOUND");
    await readAvailableTemplate(request, input.templateId);
    const subjects = resolvePortraitSubjects({
      existingSubjects: validateStoredPortraitSubjects(portrait.subjects),
      requestedSubjects: input.subjects,
    });
    await request.payload.update({
      collection: "checkout-portraits",
      data: {
        amountCents: calculatePortraitAmountCents(subjects.length),
        artistNote: input.artistNote,
        subjects,
        template: input.templateId,
      },
      depth: 0,
      id: portrait.id,
      overrideAccess: true,
      req: request,
    });
    const portraits = await readPortraitDocuments(request, intent.id);
    const subtotalCents = await updateIntentSubtotal(
      request,
      intent.id,
      portraits,
    );
    return buildSafePortraitCartResponse({
      intentAmountCents: subtotalCents,
      portraits,
    });
  }, transactionDependencies);

export const removeCartPortrait = async ({
  credential,
  portraitId,
  request,
  transactionDependencies,
}: {
  credential: CheckoutIntentCredential;
  portraitId: string;
  request: PayloadRequest;
  transactionDependencies?: PortraitCartTransactionDependencies;
}) =>
  withDraftCartTransaction(request, credential, async (transaction, intent) => {
    const existing = await readPortraitDocuments(request, intent.id);
    if (existing.length <= PORTRAIT_CART_POLICY.minimumPortraits) {
      throw new StorefrontApiError(409, "CART_REQUIRES_PORTRAIT");
    }
    const portrait = existing.find(({ publicId }) => publicId === portraitId);
    if (!portrait) throw new StorefrontApiError(404, "PORTRAIT_NOT_FOUND");
    const uploads = await request.payload.count({
      collection: "order-uploads",
      overrideAccess: true,
      req: request,
      where: { checkoutPortrait: { equals: portrait.id } },
    });
    if (uploads.totalDocs > 0) {
      throw new StorefrontApiError(409, "PORTRAIT_HAS_UPLOADS");
    }
    await request.payload.delete({
      collection: "checkout-portraits",
      id: portrait.id,
      overrideAccess: true,
      req: request,
    });
    const remaining = existing.filter(({ id }) => id !== portrait.id);
    await reorderPositions({
      documents: remaining,
      intentId: intent.id,
      request,
      transaction,
    });
    const portraits = await readPortraitDocuments(request, intent.id);
    const subtotalCents = await updateIntentSubtotal(
      request,
      intent.id,
      portraits,
    );
    return buildSafePortraitCartResponse({
      intentAmountCents: subtotalCents,
      portraits,
    });
  }, transactionDependencies);

export const reorderCartPortraits = async ({
  credential,
  portraitIds,
  request,
  transactionDependencies,
}: {
  credential: CheckoutIntentCredential;
  portraitIds: string[];
  request: PayloadRequest;
  transactionDependencies?: PortraitCartTransactionDependencies;
}) =>
  withDraftCartTransaction(request, credential, async (transaction, intent) => {
    const existing = await readPortraitDocuments(request, intent.id);
    const byPublicId = new Map(existing.map((portrait) => [portrait.publicId, portrait]));
    if (
      portraitIds.length !== existing.length ||
      portraitIds.some((id) => !byPublicId.has(id))
    ) {
      throw new StorefrontApiError(409, "INVALID_CART_ORDER");
    }
    const ordered = portraitIds.map((id) => byPublicId.get(id)!);
    await reorderPositions({
      documents: ordered,
      intentId: intent.id,
      request,
      transaction,
    });
    const portraits = await readPortraitDocuments(request, intent.id);
    return buildSafePortraitCartResponse({
      intentAmountCents: intent.amountCents,
      portraits,
    });
  }, transactionDependencies);

export type SafePortraitCart = Awaited<ReturnType<typeof readPortraitCart>>;
