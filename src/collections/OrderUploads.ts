import type { CollectionConfig, PayloadRequest } from "payload";

import { CHECKOUT_INTENT_POLICY } from "../server/checkout-intents/checkoutIntentPolicy";

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
