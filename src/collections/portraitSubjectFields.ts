import type { Field } from "payload";

import {
  PORTRAIT_CART_POLICY,
  PORTRAIT_SUBJECT_KINDS,
  isPortraitPublicId,
} from "../server/cart/portraitCartPolicy";

export const createPortraitSubjectFields = (): Field[] => [
  {
    name: "subjectId",
    type: "text",
    maxLength: 36,
    minLength: 36,
    required: true,
    validate: (value: unknown) =>
      isPortraitPublicId(value) || "Subject ID must be a version 4 UUID.",
  },
  {
    name: "name",
    type: "text",
    maxLength: PORTRAIT_CART_POLICY.maximumSubjectNameCharacters,
    minLength: 1,
    required: true,
    validate: (value: unknown) =>
      (typeof value === "string" &&
        value === value.replace(/\s+/g, " ").trim() &&
        value.length >= 1 &&
        value.length <= PORTRAIT_CART_POLICY.maximumSubjectNameCharacters) ||
      "Subject name must be normalized and within the allowed length.",
  },
  {
    name: "kind",
    type: "select",
    options: PORTRAIT_SUBJECT_KINDS.map((value) => ({
      label: value === "person" ? "Person" : "Pet",
      value,
    })),
    required: true,
  },
  {
    name: "position",
    type: "number",
    max: PORTRAIT_CART_POLICY.maximumSubjectsPerPortrait,
    min: PORTRAIT_CART_POLICY.minimumSubjectsPerPortrait,
    required: true,
    validate: (value: unknown) =>
      (typeof value === "number" &&
        Number.isSafeInteger(value) &&
        value >= PORTRAIT_CART_POLICY.minimumSubjectsPerPortrait &&
        value <= PORTRAIT_CART_POLICY.maximumSubjectsPerPortrait) ||
      "Subject position is invalid.",
  },
];
