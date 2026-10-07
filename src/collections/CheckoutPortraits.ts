import { APIError, type CollectionConfig, type PayloadRequest } from "payload";

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

export const CheckoutPortraits: CollectionConfig = {
  slug: "checkout-portraits",
  access: {
    create: denyAccess,
    delete: denyAccess,
    read: isArtist,
    update: denyAccess,
  },
  admin: {
    defaultColumns: [
      "intent",
      "position",
      "template",
      "amountCents",
      "updatedAt",
    ],
    group: "Orders",
    useAsTitle: "publicId",
  },
  defaultSort: "position",
  disableBulkDelete: true,
  disableBulkEdit: true,
  disableDuplicate: true,
  fields: [
    {
      name: "intent",
      type: "relationship",
      index: true,
      relationTo: "checkout-intents",
      required: true,
    },
    {
      name: "publicId",
      type: "text",
      admin: { readOnly: true },
      maxLength: 36,
      minLength: 36,
      required: true,
      unique: true,
      validate: (value: unknown) =>
        isPortraitPublicId(value) ||
        "Portrait public ID must be a version 4 UUID.",
    },
    {
      name: "template",
      type: "relationship",
      relationTo: "postcard-templates",
      required: true,
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
      name: "subjects",
      type: "array",
      fields: createPortraitSubjectFields(),
      maxRows: PORTRAIT_CART_POLICY.maximumSubjectsPerPortrait,
      minRows: PORTRAIT_CART_POLICY.minimumSubjectsPerPortrait,
      required: true,
    },
    {
      name: "artistNote",
      type: "textarea",
      maxLength: MAX_ARTIST_NOTE_CHARACTERS,
    },
    {
      name: "amountCents",
      type: "number",
      admin: {
        description: "Server-calculated portrait subtotal in integer USD cents.",
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
            "Portrait amount must match server pricing."
          );
        } catch {
          return "Portrait amount must match server pricing.";
        }
      },
    },
  ],
  hooks: {
    beforeDelete: [
      async ({ id, req }) => {
        const uploads = await req.payload.count({
          collection: "order-uploads",
          overrideAccess: true,
          req,
          where: { checkoutPortrait: { equals: id } },
        });
        if (uploads.totalDocs > 0) {
          throw new APIError(
            "Remove this portrait's uploads before deleting the portrait.",
            409,
            null,
            true,
          );
        }
      },
    ],
  },
  indexes: [{ fields: ["intent", "position"], unique: true }],
};
