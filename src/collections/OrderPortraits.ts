import type { CollectionConfig, PayloadRequest } from "payload";

import { MAX_ARTIST_NOTE_CHARACTERS } from "../lib/artistNoteContract";
import {
  PORTRAIT_CART_POLICY,
  calculatePortraitAmountCents,
  isPortraitPublicId,
} from "../server/cart/portraitCartPolicy";
import { createPortraitSubjectFields } from "./portraitSubjectFields";

const isArtist = ({ req: { user } }: { req: PayloadRequest }) =>
  user?.collection === "users";
const denyAccess = () => false;

export const OrderPortraits: CollectionConfig = {
  slug: "order-portraits",
  access: {
    create: denyAccess,
    delete: denyAccess,
    read: isArtist,
    update: denyAccess,
  },
  admin: {
    defaultColumns: ["order", "position", "templateName", "amountCents"],
    group: "Orders",
    useAsTitle: "templateName",
  },
  defaultSort: "position",
  disableBulkDelete: true,
  disableBulkEdit: true,
  disableDuplicate: true,
  fields: [
    {
      name: "order",
      type: "relationship",
      index: true,
      relationTo: "orders",
      required: true,
    },
    {
      name: "sourceCheckoutPortraitId",
      type: "text",
      admin: { readOnly: true },
      maxLength: 36,
      minLength: 36,
      required: true,
      unique: true,
      validate: (value: unknown) =>
        isPortraitPublicId(value) ||
        "Source portrait ID must be a version 4 UUID.",
    },
    {
      name: "position",
      type: "number",
      max: PORTRAIT_CART_POLICY.maximumPortraits,
      min: PORTRAIT_CART_POLICY.minimumPortraits,
      required: true,
      validate: (value: unknown) =>
        (typeof value === "number" &&
          Number.isSafeInteger(value) &&
          value >= PORTRAIT_CART_POLICY.minimumPortraits &&
          value <= PORTRAIT_CART_POLICY.maximumPortraits) ||
        "Portrait position is invalid.",
    },
    {
      name: "templateId",
      type: "number",
      admin: { readOnly: true },
      min: 1,
      required: true,
      validate: (value: unknown) =>
        (typeof value === "number" &&
          Number.isSafeInteger(value) &&
          value > 0) ||
        "Template snapshot ID must be a positive integer.",
    },
    {
      name: "templateName",
      type: "text",
      admin: { readOnly: true },
      maxLength: 120,
      minLength: 1,
      required: true,
    },
    {
      name: "templateDescription",
      type: "textarea",
      admin: { readOnly: true },
      maxLength: 320,
    },
    {
      name: "templatePreviewMedia",
      type: "relationship",
      admin: { readOnly: true },
      relationTo: "template-media",
      required: true,
    },
    {
      name: "templatePreviewAlt",
      type: "text",
      admin: { readOnly: true },
      maxLength: 240,
      minLength: 1,
      required: true,
    },
    {
      name: "subjects",
      type: "array",
      admin: { readOnly: true },
      fields: createPortraitSubjectFields(),
      maxRows: PORTRAIT_CART_POLICY.maximumSubjectsPerPortrait,
      minRows: PORTRAIT_CART_POLICY.minimumSubjectsPerPortrait,
      required: true,
    },
    {
      name: "artistNote",
      type: "textarea",
      admin: { readOnly: true },
      maxLength: MAX_ARTIST_NOTE_CHARACTERS,
    },
    {
      name: "amountCents",
      type: "number",
      admin: {
        description: "Immutable paid portrait amount in integer USD cents.",
        readOnly: true,
      },
      max: 3_000,
      min: 2_000,
      required: true,
      validate: (value: unknown, { siblingData }: { siblingData: unknown }) => {
        const subjects =
          typeof siblingData === "object" && siblingData !== null
            ? (siblingData as { subjects?: unknown }).subjects
            : undefined;
        if (!Array.isArray(subjects)) return "Portrait subjects are required.";
        try {
          return (
            value === calculatePortraitAmountCents(subjects.length) ||
            "Portrait amount must match its immutable subject snapshot."
          );
        } catch {
          return "Portrait amount must match its immutable subject snapshot.";
        }
      },
    },
  ],
  indexes: [{ fields: ["order", "position"], unique: true }],
};
