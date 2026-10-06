import type { CollectionConfig, PayloadRequest } from "payload";

const isAuthenticated = ({ req: { user } }: { req: PayloadRequest }) =>
  user?.collection === "users";

const normalizeOptionalText = (value: unknown) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim();
  return normalized || undefined;
};

export const PostcardTemplates: CollectionConfig = {
  slug: "postcard-templates",
  access: {
    create: isAuthenticated,
    delete: isAuthenticated,
    read: isAuthenticated,
    update: isAuthenticated,
  },
  admin: {
    defaultColumns: ["name", "available", "sortOrder", "updatedAt"],
    group: "Photo Booth",
    useAsTitle: "name",
  },
  defaultSort: ["sortOrder", "name"],
  fields: [
    {
      name: "name",
      type: "text",
      maxLength: 120,
      minLength: 1,
      required: true,
      unique: true,
      hooks: {
        beforeValidate: [({ value }) =>
          typeof value === "string" ? value.trim() : value],
      },
    },
    {
      name: "description",
      type: "textarea",
      maxLength: 320,
      hooks: {
        beforeValidate: [({ value }) => normalizeOptionalText(value)],
      },
    },
    {
      name: "previewMedia",
      type: "relationship",
      relationTo: "template-media",
      required: true,
    },
    {
      name: "sortOrder",
      type: "number",
      admin: {
        description: "Lower numbers appear first. Ties are sorted by template name.",
      },
      defaultValue: 100,
      max: 10_000,
      min: 0,
      required: true,
      validate: (value: unknown) =>
        (typeof value === "number" &&
          Number.isSafeInteger(value) &&
          value >= 0 &&
          value <= 10_000) ||
        "Sort order must be an integer from 0 through 10000.",
    },
    {
      name: "available",
      type: "checkbox",
      defaultValue: true,
      index: true,
      required: true,
    },
  ],
  indexes: [{ fields: ["available", "sortOrder"] }],
};
