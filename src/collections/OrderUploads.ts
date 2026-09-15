import type { CollectionConfig, PayloadRequest } from "payload";

const isAuthenticated = ({ req: { user } }: { req: PayloadRequest }) =>
  Boolean(user);

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
  fields: [],
  upload: {
    disableLocalStorage: true,
    filesRequiredOnCreate: true,
    mimeTypes: ["image/jpeg", "image/png", "image/webp"],
    pasteURL: false,
  },
};
