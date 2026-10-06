import { APIError, type CollectionConfig, type PayloadRequest } from "payload";

import {
  TEMPLATE_MEDIA_MIME_TYPES,
  TEMPLATE_MEDIA_PREFIX,
  validateTemplateMediaFile,
} from "../server/templates/templateMediaPolicy";

const isAuthenticated = ({ req: { user } }: { req: PayloadRequest }) =>
  user?.collection === "users";

export const TemplateMedia: CollectionConfig = {
  slug: "template-media",
  access: {
    create: isAuthenticated,
    delete: isAuthenticated,
    read: isAuthenticated,
    update: isAuthenticated,
  },
  admin: {
    defaultColumns: ["alt", "filename", "filesize", "updatedAt"],
    group: "Photo Booth",
    useAsTitle: "alt",
  },
  fields: [
    {
      name: "alt",
      type: "text",
      admin: {
        description: "Describe the template artwork for customers using assistive technology.",
      },
      maxLength: 240,
      minLength: 1,
      required: true,
      hooks: {
        beforeValidate: [({ value }) =>
          typeof value === "string" ? value.trim() : value],
      },
    },
  ],
  hooks: {
    beforeDelete: [
      async ({ id, req }) => {
        const references = await req.payload.count({
          collection: "postcard-templates",
          overrideAccess: true,
          req,
          where: { previewMedia: { equals: id } },
        });
        if (references.totalDocs > 0) {
          throw new APIError(
            "This preview is still used by a postcard template.",
            409,
            null,
            true,
          );
        }
      },
    ],
    beforeValidate: [
      async ({ data, req }) => {
        if (req.file) await validateTemplateMediaFile(req.file);
        return { ...data, prefix: TEMPLATE_MEDIA_PREFIX };
      },
    ],
  },
  upload: {
    disableLocalStorage: true,
    filesRequiredOnCreate: true,
    mimeTypes: [...TEMPLATE_MEDIA_MIME_TYPES],
    pasteURL: false,
  },
};
