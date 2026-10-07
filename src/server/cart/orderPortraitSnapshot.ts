import { StorefrontApiError } from "../storefront/storefrontApiError";
import { MAX_ARTIST_NOTE_CHARACTERS } from "../../lib/artistNoteContract";
import {
  calculatePortraitAmountCents,
  isPortraitPublicId,
  validateStoredPortraitSubjects,
} from "./portraitCartPolicy";

const positiveInteger = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new StorefrontApiError(500, "INVALID_PORTRAIT_SNAPSHOT");
  }
  return parsed;
};

const boundedText = (
  value: unknown,
  maximum: number,
  { optional = false }: { optional?: boolean } = {},
) => {
  if (optional && (value === null || value === undefined || value === "")) {
    return null;
  }
  if (typeof value !== "string") {
    throw new StorefrontApiError(500, "INVALID_PORTRAIT_SNAPSHOT");
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new StorefrontApiError(500, "INVALID_PORTRAIT_SNAPSHOT");
  }
  return normalized;
};

export const buildOrderPortraitSnapshot = ({
  orderId,
  portrait,
}: {
  orderId: unknown;
  portrait: Record<string, unknown>;
}) => {
  if (!isPortraitPublicId(portrait.publicId)) {
    throw new StorefrontApiError(500, "INVALID_PORTRAIT_SNAPSHOT");
  }
  const subjects = validateStoredPortraitSubjects(portrait.subjects);
  const amountCents = calculatePortraitAmountCents(subjects.length);
  if (portrait.amountCents !== amountCents) {
    throw new StorefrontApiError(500, "INVALID_PORTRAIT_SNAPSHOT");
  }
  if (
    typeof portrait.template !== "object" ||
    portrait.template === null ||
    Array.isArray(portrait.template)
  ) {
    throw new StorefrontApiError(500, "INVALID_PORTRAIT_SNAPSHOT");
  }
  const template = portrait.template as Record<string, unknown>;
  if (
    typeof template.previewMedia !== "object" ||
    template.previewMedia === null ||
    Array.isArray(template.previewMedia)
  ) {
    throw new StorefrontApiError(500, "INVALID_PORTRAIT_SNAPSHOT");
  }
  const preview = template.previewMedia as Record<string, unknown>;
  const position = positiveInteger(portrait.position);
  if (position > 5) {
    throw new StorefrontApiError(500, "INVALID_PORTRAIT_SNAPSHOT");
  }
  const artistNote =
    portrait.artistNote === null || portrait.artistNote === undefined
      ? null
      : boundedText(portrait.artistNote, MAX_ARTIST_NOTE_CHARACTERS, {
          optional: true,
        });

  return {
    amountCents,
    artistNote,
    order: positiveInteger(orderId),
    position,
    sourceCheckoutPortraitId: portrait.publicId,
    subjects: subjects.map((subject) => ({ ...subject })),
    templateDescription: boundedText(template.description, 320, {
      optional: true,
    }),
    templateId: positiveInteger(template.id),
    templateName: boundedText(template.name, 120),
    templatePreviewAlt: boundedText(preview.alt, 240),
    templatePreviewMedia: positiveInteger(preview.id),
  };
};
