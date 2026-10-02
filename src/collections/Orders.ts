import type { CollectionConfig, PayloadRequest } from "payload";

import {
  MAX_ARTIST_NOTE_CHARACTERS,
  normalizeArtistNote,
} from "../server/storefront/artistNote";
import { STRIPE_DISPUTE_STATUSES } from "../server/stripe/stripeWebhookContract";
import {
  FULFILLMENT_STATES,
  TRACKING_CARRIERS,
} from "../server/orders/orderFulfillmentContract";

const isAuthenticated = ({ req: { user } }: { req: PayloadRequest }) =>
  Boolean(user);

const denyAccess = () => false;

const dateAndTimeAdmin = {
  date: {
    pickerAppearance: "dayAndTime" as const,
  },
};

export const Orders: CollectionConfig = {
  slug: "orders",
  access: {
    create: denyAccess,
    delete: denyAccess,
    read: isAuthenticated,
    update: isAuthenticated,
  },
  admin: {
    defaultColumns: [
      "customer",
      "checkoutIntent",
      "contactEmail",
      "orderStatus",
      "paymentStatus",
      "amountCents",
      "createdAt",
    ],
  },
  disableDuplicate: true,
  fields: [
    {
      name: "customer",
      type: "relationship",
      access: {
        update: denyAccess,
      },
      relationTo: "customers",
      required: true,
    },
    {
      name: "checkoutIntent",
      type: "relationship",
      access: {
        update: denyAccess,
      },
      relationTo: "checkout-intents",
      required: true,
      unique: true,
    },
    {
      name: "contactEmail",
      type: "email",
      access: {
        update: denyAccess,
      },
      hooks: {
        beforeValidate: [
          ({ value }) =>
            typeof value === "string" ? value.trim().toLowerCase() : value,
        ],
      },
      required: true,
    },
    {
      name: "amountCents",
      type: "number",
      access: {
        update: denyAccess,
      },
      min: 1,
      required: true,
      validate: (value: unknown) => {
        if (typeof value !== "number" || !Number.isInteger(value)) {
          return "Amount must be an integer number of cents.";
        }

        return value >= 1 || "Amount must be at least one cent.";
      },
    },
    {
      name: "artistNote",
      type: "textarea",
      access: {
        update: denyAccess,
      },
      admin: {
        description: "Immutable customer note snapshot captured at payment fulfillment.",
      },
      hooks: {
        beforeValidate: [({ value }) =>
          typeof value === "string" ? normalizeArtistNote(value) : value],
      },
      maxLength: MAX_ARTIST_NOTE_CHARACTERS,
    },
    {
      name: "currency",
      type: "select",
      access: {
        update: denyAccess,
      },
      defaultValue: "usd",
      options: [{ label: "USD", value: "usd" }],
      required: true,
    },
    {
      name: "stripeCheckoutSessionId",
      type: "text",
      access: {
        update: denyAccess,
      },
      required: true,
      unique: true,
    },
    {
      name: "stripePaymentIntentId",
      type: "text",
      access: {
        update: denyAccess,
      },
      required: true,
      unique: true,
    },
    {
      name: "paidAt",
      type: "date",
      access: {
        update: denyAccess,
      },
      admin: dateAndTimeAdmin,
      required: true,
    },
    {
      name: "orderStatus",
      type: "select",
      access: {
        update: denyAccess,
      },
      defaultValue: "unfulfilled",
      options: FULFILLMENT_STATES.map((value) => ({
        label: value
          .split("_")
          .map((part) => part[0].toUpperCase() + part.slice(1))
          .join(" "),
        value,
      })),
      required: true,
    },
    {
      name: "paymentStatus",
      type: "select",
      access: {
        update: denyAccess,
      },
      defaultValue: "paid",
      options: [
        { label: "Paid", value: "paid" },
        { label: "Partially refunded", value: "partially_refunded" },
        { label: "Refunded", value: "refunded" },
        { label: "Disputed", value: "disputed" },
      ],
      required: true,
    },
    {
      name: "refundedAmountCents",
      type: "number",
      access: {
        update: denyAccess,
      },
      defaultValue: 0,
      min: 0,
      required: true,
      validate: (value: unknown) =>
        (typeof value === "number" && Number.isInteger(value) && value >= 0) ||
        "Refunded amount must be a non-negative integer number of cents.",
    },
    {
      name: "refundState",
      type: "select",
      access: {
        update: denyAccess,
      },
      defaultValue: "none",
      options: [
        { label: "None", value: "none" },
        { label: "Partial", value: "partial" },
        { label: "Full", value: "full" },
      ],
      required: true,
    },
    {
      name: "stripeDisputeId",
      type: "text",
      access: {
        update: denyAccess,
      },
      index: true,
      maxLength: 255,
    },
    {
      name: "stripeDisputeStatus",
      type: "select",
      access: {
        update: denyAccess,
      },
      options: STRIPE_DISPUTE_STATUSES.map((value) => ({
        label: value,
        value,
      })),
    },
    {
      name: "shippingAddress",
      type: "group",
      fields: [
        {
          name: "recipientName",
          type: "text",
          maxLength: 150,
          required: true,
        },
        {
          name: "line1",
          type: "text",
          maxLength: 200,
          required: true,
        },
        {
          name: "line2",
          type: "text",
          maxLength: 200,
        },
        {
          name: "city",
          type: "text",
          maxLength: 100,
          required: true,
        },
        {
          name: "state",
          type: "text",
          maxLength: 100,
        },
        {
          name: "postalCode",
          type: "text",
          maxLength: 32,
        },
        {
          name: "country",
          type: "text",
          hooks: {
            beforeValidate: [
              ({ value }) =>
                typeof value === "string"
                  ? value.trim().toUpperCase()
                  : value,
            ],
          },
          maxLength: 2,
          minLength: 2,
          required: true,
          validate: (value: unknown) =>
            (typeof value === "string" && /^[A-Z]{2}$/.test(value)) ||
            "Country must be a two-letter uppercase code.",
        },
      ],
      required: true,
    },
    {
      name: "trackingCarrier",
      type: "select",
      access: {
        update: denyAccess,
      },
      options: TRACKING_CARRIERS.map((value) => ({
        label: value === "other" ? "Other" : value.toUpperCase(),
        value,
      })),
    },
    {
      name: "trackingNumber",
      type: "text",
      access: {
        update: denyAccess,
      },
      maxLength: 64,
    },
    {
      name: "shippedAt",
      type: "date",
      access: {
        update: denyAccess,
      },
      admin: dateAndTimeAdmin,
    },
    {
      name: "deliveredAt",
      type: "date",
      access: {
        update: denyAccess,
      },
      admin: dateAndTimeAdmin,
    },
  ],
};
