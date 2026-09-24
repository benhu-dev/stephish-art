import type { CollectionConfig, PayloadRequest } from "payload";

import { CHECKOUT_INTENT_POLICY } from "../server/checkout-intents/checkoutIntentPolicy";
import {
  MAX_ARTIST_NOTE_CHARACTERS,
  normalizeArtistNote,
} from "../server/storefront/artistNote";

const isAuthenticated = ({ req: { user } }: { req: PayloadRequest }) =>
  Boolean(user);

const denyAccess = () => false;

const dateAndTimeAdmin = {
  date: {
    pickerAppearance: "dayAndTime" as const,
  },
};

export const CheckoutIntents: CollectionConfig = {
  slug: "checkout-intents",
  access: {
    create: denyAccess,
    delete: denyAccess,
    read: isAuthenticated,
    update: denyAccess,
  },
  admin: {
    defaultColumns: ["status", "amountCents", "expiresAt", "createdAt"],
    group: "Orders",
  },
  disableBulkDelete: true,
  disableBulkEdit: true,
  disableDuplicate: true,
  timestamps: true,
  fields: [
    {
      name: "status",
      type: "select",
      defaultValue: "draft",
      options: [
        { label: "Draft", value: "draft" },
        { label: "Checkout pending", value: "checkout_pending" },
        { label: "Checkout created", value: "checkout_created" },
        { label: "Completed", value: "completed" },
        { label: "Expired", value: "expired" },
      ],
      required: true,
    },
    {
      name: "amountCents",
      type: "number",
      min: 1,
      required: true,
      validate: (value: unknown) => {
        if (
          typeof value !== "number" ||
          !Number.isFinite(value) ||
          !Number.isInteger(value)
        ) {
          return "Amount must be a finite integer number of cents.";
        }

        return value >= 1 || "Amount must be at least one cent.";
      },
    },
    {
      name: "artistNote",
      type: "textarea",
      admin: {
        description: "Private note supplied by the customer for this checkout.",
      },
      hooks: {
        beforeValidate: [({ value }) =>
          typeof value === "string" ? normalizeArtistNote(value) : value],
      },
      maxLength: MAX_ARTIST_NOTE_CHARACTERS,
    },
    {
      name: "accessTokenHash",
      type: "text",
      access: {
        read: denyAccess,
        update: denyAccess,
      },
      admin: {
        hidden: true,
      },
      maxLength: 64,
      minLength: 64,
      required: true,
      unique: true,
      validate: (value: unknown) =>
        (typeof value === "string" && /^[0-9a-f]{64}$/.test(value)) ||
        "Token hash must be 64 lowercase hexadecimal characters.",
    },
    {
      name: "expiresAt",
      type: "date",
      admin: dateAndTimeAdmin,
      index: true,
      required: true,
    },
    {
      name: "deleteAfter",
      type: "date",
      admin: dateAndTimeAdmin,
      index: true,
      required: true,
      validate: (value: unknown, { siblingData }: { siblingData: unknown }) => {
        const expiresAt =
          typeof siblingData === "object" && siblingData !== null
            ? (siblingData as { expiresAt?: unknown }).expiresAt
            : undefined;
        const deleteAfterMilliseconds = new Date(String(value)).getTime();
        const expiresAtMilliseconds = new Date(String(expiresAt)).getTime();

        return (
          (Number.isFinite(deleteAfterMilliseconds) &&
            Number.isFinite(expiresAtMilliseconds) &&
            deleteAfterMilliseconds > expiresAtMilliseconds) ||
          "Deletion eligibility must be later than expiration."
        );
      },
    },
    {
      name: "checkoutAttemptId",
      type: "text",
      access: {
        read: denyAccess,
        update: denyAccess,
      },
      admin: { hidden: true },
      maxLength: 36,
      minLength: 36,
      unique: true,
      validate: (value: unknown) =>
        (value === null ||
          value === undefined ||
          (typeof value === "string" &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
              value,
            ))) ||
        "Checkout attempt ID must be a version 4 UUID.",
    },
    {
      name: "checkoutStartedAt",
      type: "date",
      access: {
        read: denyAccess,
        update: denyAccess,
      },
      admin: { hidden: true },
    },
    {
      name: "shippingAmountCents",
      type: "number",
      access: {
        read: denyAccess,
        update: denyAccess,
      },
      admin: { hidden: true },
      min: 0,
      validate: (value: unknown) =>
        (value === null ||
          value === undefined ||
          (typeof value === "number" &&
            Number.isSafeInteger(value) &&
            value >= 0 &&
            value <= 10_000)) ||
        "Shipping amount must be an integer from 0 through 10000 cents.",
    },
    {
      name: "totalAmountCents",
      type: "number",
      access: {
        read: denyAccess,
        update: denyAccess,
      },
      admin: { hidden: true },
      min: 1,
      validate: (value: unknown) =>
        (value === null ||
          value === undefined ||
          (typeof value === "number" &&
            Number.isSafeInteger(value) &&
            value >= 1)) ||
        "Total amount must be a positive integer number of cents.",
    },
    {
      name: "stripeCheckoutSessionId",
      type: "text",
      access: {
        read: denyAccess,
        update: denyAccess,
      },
      admin: { hidden: true },
      unique: true,
    },
    {
      name: "stripeCheckoutSessionExpiresAt",
      type: "date",
      access: {
        read: denyAccess,
        update: denyAccess,
      },
      admin: { hidden: true },
    },
    {
      name: "uploads",
      type: "join",
      admin: { allowCreate: false },
      collection: "order-uploads",
      defaultLimit: CHECKOUT_INTENT_POLICY.maximumUploads,
      defaultSort: "position",
      on: "checkoutIntent",
    },
  ],
};
