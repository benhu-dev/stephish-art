import { randomUUID } from "node:crypto";

import { normalizeArtistNote } from "../storefront/artistNote";
import { StorefrontApiError } from "../storefront/storefrontApiError";

export const PORTRAIT_CART_POLICY = Object.freeze({
  additionalSubjectAmountCents: 500,
  baseAmountCents: 2_000,
  maximumPortraits: 5,
  maximumSubjectNameCharacters: 80,
  maximumSubjectsPerPortrait: 3,
  minimumPortraits: 1,
  minimumSubjectsPerPortrait: 1,
});

export const PORTRAIT_SUBJECT_KINDS = ["person", "pet"] as const;

export type PortraitSubjectKind = (typeof PORTRAIT_SUBJECT_KINDS)[number];
export type PortraitSubjectRequest = {
  id?: string;
  kind: PortraitSubjectKind;
  name: string;
};
export type PortraitSubject = {
  kind: PortraitSubjectKind;
  name: string;
  position: number;
  subjectId: string;
};
export type PortraitMutationRequest = {
  artistNote: string | null;
  subjects: PortraitSubjectRequest[];
  templateId: number;
};

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const isPortraitPublicId = (value: unknown): value is string =>
  typeof value === "string" && UUID_V4.test(value);

const hasExactKeys = (value: object, keys: string[]) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
};

const invalidRequest = () => new StorefrontApiError(400, "INVALID_REQUEST");

const normalizeSubjectName = (value: unknown) => {
  if (typeof value !== "string") throw invalidRequest();
  const normalized = value.replace(/\s+/g, " ").trim();
  if (
    normalized.length < 1 ||
    normalized.length > PORTRAIT_CART_POLICY.maximumSubjectNameCharacters
  ) {
    throw new StorefrontApiError(422, "INVALID_SUBJECT_NAME");
  }
  return normalized;
};

const parseTemplateId = (value: unknown) => {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw invalidRequest();
  }
  return Number(value);
};

const parseSubject = (
  value: unknown,
  { allowId }: { allowId: boolean },
): PortraitSubjectRequest => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidRequest();
  }
  const subject = value as Record<string, unknown>;
  const hasId = Object.hasOwn(subject, "id");
  if (
    !hasExactKeys(subject, hasId ? ["id", "kind", "name"] : ["kind", "name"]) ||
    (hasId && !allowId)
  ) {
    throw invalidRequest();
  }
  if (
    typeof subject.kind !== "string" ||
    !PORTRAIT_SUBJECT_KINDS.includes(subject.kind as PortraitSubjectKind)
  ) {
    throw new StorefrontApiError(422, "INVALID_SUBJECT_KIND");
  }
  if (hasId && !isPortraitPublicId(subject.id)) {
    throw invalidRequest();
  }
  return {
    ...(hasId ? { id: subject.id as string } : {}),
    kind: subject.kind as PortraitSubjectKind,
    name: normalizeSubjectName(subject.name),
  };
};

const parsePortraitMutationRequest = (
  value: unknown,
  { allowSubjectIds }: { allowSubjectIds: boolean },
): PortraitMutationRequest => {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !hasExactKeys(value, ["artistNote", "subjects", "templateId"])
  ) {
    throw invalidRequest();
  }
  const request = value as Record<string, unknown>;
  if (typeof request.artistNote !== "string" || !Array.isArray(request.subjects)) {
    throw invalidRequest();
  }
  if (
    request.subjects.length < PORTRAIT_CART_POLICY.minimumSubjectsPerPortrait ||
    request.subjects.length > PORTRAIT_CART_POLICY.maximumSubjectsPerPortrait
  ) {
    throw new StorefrontApiError(422, "INVALID_SUBJECT_COUNT");
  }
  return {
    artistNote: normalizeArtistNote(request.artistNote),
    subjects: request.subjects.map((subject) =>
      parseSubject(subject, { allowId: allowSubjectIds }),
    ),
    templateId: parseTemplateId(request.templateId),
  };
};

export const parsePortraitCreateRequest = (value: unknown) =>
  parsePortraitMutationRequest(value, { allowSubjectIds: false });

export const parsePortraitReplaceRequest = (value: unknown) =>
  parsePortraitMutationRequest(value, { allowSubjectIds: true });

export const parsePortraitReorderRequest = (value: unknown) => {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !hasExactKeys(value, ["portraitIds"])
  ) {
    throw invalidRequest();
  }
  const portraitIds = (value as { portraitIds?: unknown }).portraitIds;
  if (
    !Array.isArray(portraitIds) ||
    portraitIds.length < PORTRAIT_CART_POLICY.minimumPortraits ||
    portraitIds.length > PORTRAIT_CART_POLICY.maximumPortraits ||
    portraitIds.some((id) => !isPortraitPublicId(id)) ||
    new Set(portraitIds).size !== portraitIds.length
  ) {
    throw invalidRequest();
  }
  return { portraitIds: portraitIds as string[] };
};

export const calculatePortraitAmountCents = (subjectCount: unknown) => {
  if (
    !Number.isSafeInteger(subjectCount) ||
    Number(subjectCount) < PORTRAIT_CART_POLICY.minimumSubjectsPerPortrait ||
    Number(subjectCount) > PORTRAIT_CART_POLICY.maximumSubjectsPerPortrait
  ) {
    throw new StorefrontApiError(422, "INVALID_SUBJECT_COUNT");
  }
  return (
    PORTRAIT_CART_POLICY.baseAmountCents +
    (Number(subjectCount) - 1) *
      PORTRAIT_CART_POLICY.additionalSubjectAmountCents
  );
};

export const calculateCartSubtotalCents = (amounts: unknown[]) => {
  if (
    !Array.isArray(amounts) ||
    amounts.length < PORTRAIT_CART_POLICY.minimumPortraits ||
    amounts.length > PORTRAIT_CART_POLICY.maximumPortraits
  ) {
    throw new StorefrontApiError(422, "INVALID_PORTRAIT_COUNT");
  }
  const allowedAmounts = new Set([2_000, 2_500, 3_000]);
  if (
    amounts.some(
      (amount) =>
        !Number.isSafeInteger(amount) || !allowedAmounts.has(Number(amount)),
    )
  ) {
    throw new StorefrontApiError(500, "INVALID_PORTRAIT_AMOUNT");
  }
  const subtotal = amounts.reduce<number>((sum, amount) => sum + Number(amount), 0);
  if (!Number.isSafeInteger(subtotal)) {
    throw new StorefrontApiError(500, "INVALID_CART_SUBTOTAL");
  }
  return subtotal;
};

export const validateStoredPortraitSubjects = (
  value: unknown,
): PortraitSubject[] => {
  if (
    !Array.isArray(value) ||
    value.length < PORTRAIT_CART_POLICY.minimumSubjectsPerPortrait ||
    value.length > PORTRAIT_CART_POLICY.maximumSubjectsPerPortrait
  ) {
    throw new StorefrontApiError(500, "INVALID_PORTRAIT_SUBJECTS");
  }
  const subjects = value.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new StorefrontApiError(500, "INVALID_PORTRAIT_SUBJECTS");
    }
    const subject = entry as Record<string, unknown>;
    let normalizedName: string;
    try {
      normalizedName = normalizeSubjectName(subject.name);
    } catch {
      throw new StorefrontApiError(500, "INVALID_PORTRAIT_SUBJECTS");
    }
    if (
      !isPortraitPublicId(subject.subjectId) ||
      typeof subject.name !== "string" ||
      normalizedName !== subject.name ||
      typeof subject.kind !== "string" ||
      !PORTRAIT_SUBJECT_KINDS.includes(subject.kind as PortraitSubjectKind) ||
      subject.position !== index + 1
    ) {
      throw new StorefrontApiError(500, "INVALID_PORTRAIT_SUBJECTS");
    }
    return {
      kind: subject.kind as PortraitSubjectKind,
      name: subject.name,
      position: index + 1,
      subjectId: subject.subjectId,
    };
  });
  if (new Set(subjects.map(({ subjectId }) => subjectId)).size !== subjects.length) {
    throw new StorefrontApiError(500, "INVALID_PORTRAIT_SUBJECTS");
  }
  return subjects;
};

export const resolvePortraitSubjects = ({
  existingSubjects = [],
  issueId = randomUUID,
  requestedSubjects,
}: {
  existingSubjects?: PortraitSubject[];
  issueId?: () => string | undefined;
  requestedSubjects: PortraitSubjectRequest[];
}): PortraitSubject[] => {
  if (
    requestedSubjects.length < PORTRAIT_CART_POLICY.minimumSubjectsPerPortrait ||
    requestedSubjects.length > PORTRAIT_CART_POLICY.maximumSubjectsPerPortrait
  ) {
    throw new StorefrontApiError(422, "INVALID_SUBJECT_COUNT");
  }
  const existingIds = new Set(existingSubjects.map(({ subjectId }) => subjectId));
  const subjects = requestedSubjects.map((subject, index) => {
    if (subject.id && !existingIds.has(subject.id)) {
      throw new StorefrontApiError(409, "UNKNOWN_SUBJECT_ID");
    }
    const subjectId = subject.id ?? issueId();
    if (!isPortraitPublicId(subjectId)) {
      throw new StorefrontApiError(500, "SUBJECT_ID_UNAVAILABLE");
    }
    return {
      kind: subject.kind,
      name: subject.name,
      position: index + 1,
      subjectId,
    };
  });
  if (new Set(subjects.map(({ subjectId }) => subjectId)).size !== subjects.length) {
    throw new StorefrontApiError(422, "DUPLICATE_SUBJECT_ID");
  }
  return subjects;
};

export const validateStoredSubjectIdList = (
  value: unknown,
  { optional = false }: { optional?: boolean } = {},
) => {
  if (optional && (value === null || value === undefined)) return undefined;
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > PORTRAIT_CART_POLICY.maximumSubjectsPerPortrait ||
    value.some((id) => !isPortraitPublicId(id)) ||
    new Set(value).size !== value.length
  ) {
    throw new StorefrontApiError(422, "INVALID_PHOTO_SUBJECTS");
  }
  return value as string[];
};

export const validatePhotoSubjectMappings = ({
  photoSubjectIds,
  subjectIds,
}: {
  photoSubjectIds: unknown[];
  subjectIds: unknown[];
}) => {
  const knownSubjects = validateStoredSubjectIdList(subjectIds);
  if (!knownSubjects) {
    throw new StorefrontApiError(422, "INVALID_PHOTO_SUBJECTS");
  }
  if (
    photoSubjectIds.length < 1 ||
    photoSubjectIds.length > knownSubjects.length
  ) {
    throw new StorefrontApiError(422, "INVALID_PHOTO_COUNT");
  }
  const known = new Set(knownSubjects);
  const covered = new Set<string>();
  const mappings = photoSubjectIds.map((mapping) => {
    const ids = validateStoredSubjectIdList(mapping);
    if (!ids) {
      throw new StorefrontApiError(422, "INVALID_PHOTO_SUBJECTS");
    }
    for (const id of ids) {
      if (!known.has(id)) {
        throw new StorefrontApiError(422, "UNKNOWN_PHOTO_SUBJECT");
      }
      covered.add(id);
    }
    return ids;
  });
  if (covered.size !== known.size) {
    throw new StorefrontApiError(422, "SUBJECT_PHOTO_REQUIRED");
  }
  return mappings;
};
