import type { CollectionConfig, PayloadRequest } from "payload";

const isAuthenticated = ({ req: { user } }: { req: PayloadRequest }) =>
  Boolean(user);

export const Customers: CollectionConfig = {
  slug: "customers",
  access: {
    create: isAuthenticated,
    delete: isAuthenticated,
    read: isAuthenticated,
    update: isAuthenticated,
  },
  admin: {
    defaultColumns: ["fullName", "email", "updatedAt"],
    useAsTitle: "email",
  },
  fields: [
    {
      name: "fullName",
      type: "text",
      hooks: {
        beforeValidate: [
          ({ value }) => (typeof value === "string" ? value.trim() : value),
        ],
      },
      maxLength: 150,
      required: true,
    },
    {
      name: "email",
      type: "email",
      hooks: {
        beforeValidate: [
          ({ value }) =>
            typeof value === "string" ? value.trim().toLowerCase() : value,
        ],
      },
      required: true,
      unique: true,
    },
    {
      name: "stripeCustomerId",
      type: "text",
      unique: true,
    },
  ],
};
