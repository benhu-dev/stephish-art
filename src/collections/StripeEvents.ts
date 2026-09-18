import type { CollectionConfig, PayloadRequest } from "payload";

import {
  STRIPE_WEBHOOK_CODES,
  STRIPE_WEBHOOK_EVENT_TYPES,
} from "../server/stripe/stripeWebhookContract";

const isAuthenticated = ({ req: { user } }: { req: PayloadRequest }) =>
  Boolean(user);
const denyAccess = () => false;

const selectOptions = (values: readonly string[]) =>
  values.map((value) => ({ label: value, value }));

const dateAndTimeAdmin = {
  date: { pickerAppearance: "dayAndTime" as const },
};

export const StripeEvents: CollectionConfig = {
  slug: "stripe-events",
  access: {
    create: denyAccess,
    delete: denyAccess,
    read: isAuthenticated,
    update: denyAccess,
  },
  admin: {
    defaultColumns: [
      "stripeEventId",
      "eventType",
      "disposition",
      "code",
      "processedAt",
    ],
    group: "Orders",
  },
  disableBulkDelete: true,
  disableBulkEdit: true,
  disableDuplicate: true,
  fields: [
    {
      name: "stripeEventId",
      type: "text",
      maxLength: 255,
      required: true,
      unique: true,
    },
    {
      name: "eventType",
      type: "select",
      options: selectOptions(STRIPE_WEBHOOK_EVENT_TYPES),
      required: true,
    },
    {
      name: "disposition",
      type: "select",
      options: selectOptions(["processed", "ignored", "rejected"]),
      required: true,
    },
    {
      name: "checkoutIntent",
      type: "relationship",
      index: true,
      relationTo: "checkout-intents",
    },
    {
      name: "stripeCreatedAt",
      type: "date",
      admin: dateAndTimeAdmin,
      required: true,
    },
    {
      name: "processedAt",
      type: "date",
      admin: dateAndTimeAdmin,
      required: true,
    },
    {
      name: "code",
      type: "select",
      options: selectOptions(STRIPE_WEBHOOK_CODES),
    },
  ],
};
