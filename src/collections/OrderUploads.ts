import type { CollectionConfig, PayloadRequest } from "payload";

import { CHECKOUT_INTENT_POLICY } from "../server/checkout-intents/checkoutIntentPolicy";
import { validateStoredSubjectIdList } from "../server/cart/portraitCartPolicy";

const isAuthenticated = ({ req: { user } }: { req: PayloadRequest }) =>
  Boolean(user);
const denyAccess = () => false;

export const OrderUploads: CollectionConfig = {
  slug: "order-uploads",
  access: {
    create: isAuthenticated,
    delete: isAuthenticated,
    read: isAuthenticated,
    update: isAuthenticated,
  },
  admin: {
    defaultColumns: ["filename", "mimeType", "filesize", "createdAt"],
    group: "Orders",
  },
  fields: [
    {
      name: "checkoutIntent",
      type: "relationship",
      index: true,
      relationTo: "checkout-intents",
      required: true,
    },
    {
      name: "order",
      type: "relationship",
      access: { update: denyAccess },
      index: true,
      relationTo: "orders",
    },
    {
      name: "checkoutPortrait",
      type: "relationship",
      access: { update: denyAccess },
      admin: { readOnly: true },
      index: true,
      relationTo: "checkout-portraits",
    },
    {
      name: "subjectIds",
      type: "json",
      access: { update: denyAccess },
      admin: {
        description:
          "Subject UUIDs represented by this photo. Populated by the portrait upload workflow.",
        readOnly: true,
      },
      validate: (value: unknown) => {
        try {
          validateStoredSubjectIdList(value, { optional: true });
          return true;
        } catch {
          return "Subject mappings must contain one to three unique subject UUIDs.";
        }
      },
    },
    {
      name: "position",
      type: "number",
      max: CHECKOUT_INTENT_POLICY.maximumUploads,
      min: 1,
      required: true,
      validate: (value: unknown) =>
        (typeof value === "number" &&
          Number.isFinite(value) &&
          Number.isInteger(value) &&
          value >= 1 &&
          value <= CHECKOUT_INTENT_POLICY.maximumUploads) ||
        "Position must be an integer from 1 through 3.",
    },
  ],
  indexes: [
    {
      fields: ["checkoutIntent", "position"],
      unique: true,
    },
  ],
  upload: {
    disableLocalStorage: true,
    filesRequiredOnCreate: true,
    mimeTypes: ["image/jpeg", "image/png", "image/webp"],
    pasteURL: false,
  },
};
