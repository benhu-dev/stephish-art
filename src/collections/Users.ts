import type { CollectionConfig, PayloadRequest } from "payload";

const isAuthenticated = ({ req: { user } }: { req: PayloadRequest }) =>
  Boolean(user);

export const Users: CollectionConfig = {
  slug: "users",
  auth: true,
  access: {
    admin: isAuthenticated,
    create: isAuthenticated,
    delete: isAuthenticated,
    read: isAuthenticated,
    unlock: isAuthenticated,
    update: isAuthenticated,
  },
  admin: {
    useAsTitle: "email",
  },
  fields: [],
};
