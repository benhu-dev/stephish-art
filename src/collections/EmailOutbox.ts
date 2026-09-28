import type { CollectionConfig, PayloadRequest } from "payload";

import { ORDER_EMAIL_OUTBOX_KINDS } from "../server/email/emailOutbox";

const isAuthenticated = ({ req: { user } }: { req: PayloadRequest }) =>
  Boolean(user);
const denyAccess = () => false;

const selectOptions = (values: readonly string[]) =>
  values.map((value) => ({ label: value, value }));

const dateAndTimeAdmin = {
  date: { pickerAppearance: "dayAndTime" as const },
};

export const EmailOutbox: CollectionConfig = {
  slug: "email-outbox",
  access: {
    create: denyAccess,
    delete: denyAccess,
    read: isAuthenticated,
    update: denyAccess,
  },
  admin: {
    defaultColumns: ["order", "kind", "status", "attempts", "nextAttemptAt"],
    group: "Orders",
    useAsTitle: "kind",
  },
  disableBulkDelete: true,
  disableBulkEdit: true,
  disableDuplicate: true,
  fields: [
    {
      name: "order",
      type: "relationship",
      relationTo: "orders",
      required: true,
    },
    {
      name: "kind",
      type: "select",
      options: selectOptions(ORDER_EMAIL_OUTBOX_KINDS),
      required: true,
    },
    {
      name: "status",
      type: "select",
      defaultValue: "pending",
      options: selectOptions(["pending", "processing", "sent", "failed"]),
      required: true,
    },
    {
      name: "attempts",
      type: "number",
      defaultValue: 0,
      min: 0,
      required: true,
      validate: (value: unknown) =>
        (typeof value === "number" && Number.isInteger(value) && value >= 0) ||
        "Attempts must be a non-negative integer.",
    },
    {
      name: "nextAttemptAt",
      type: "date",
      admin: dateAndTimeAdmin,
    },
    {
      name: "lockedAt",
      type: "date",
      admin: dateAndTimeAdmin,
    },
    {
      name: "sentAt",
      type: "date",
      admin: dateAndTimeAdmin,
    },
    {
      name: "providerMessageId",
      type: "text",
      maxLength: 255,
    },
    {
      name: "lastErrorCode",
      type: "text",
      maxLength: 100,
      validate: (value: unknown) =>
        value === null ||
        value === undefined ||
        value === "" ||
        (typeof value === "string" && /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(value)) ||
        "Error code must use lowercase letters, digits, and underscores.",
    },
  ],
  indexes: [{ fields: ["order", "kind"], unique: true }],
};
