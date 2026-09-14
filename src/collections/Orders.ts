import type { CollectionConfig, PayloadRequest } from "payload";

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
      defaultValue: "new",
      options: [
        { label: "New", value: "new" },
        { label: "In progress", value: "in_progress" },
        { label: "Ready to ship", value: "ready_to_ship" },
        { label: "Shipped", value: "shipped" },
        { label: "Completed", value: "completed" },
        { label: "Cancelled", value: "cancelled" },
      ],
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
      type: "text",
      maxLength: 100,
    },
    {
      name: "trackingNumber",
      type: "text",
      maxLength: 200,
    },
    {
      name: "trackingUrl",
      type: "text",
      validate: (value: unknown) => {
        if (value === null || value === undefined || value === "") {
          return true;
        }

        if (typeof value !== "string") {
          return "Tracking URL must be a valid HTTP or HTTPS URL.";
        }

        try {
          const url = new URL(value);

          return (
            ["http:", "https:"].includes(url.protocol) ||
            "Tracking URL must be a valid HTTP or HTTPS URL."
          );
        } catch {
          return "Tracking URL must be a valid HTTP or HTTPS URL.";
        }
      },
    },
    {
      name: "shippedAt",
      type: "date",
      admin: dateAndTimeAdmin,
    },
    {
      name: "completedAt",
      type: "date",
      admin: dateAndTimeAdmin,
    },
  ],
};
