import { postgresAdapter } from "@payloadcms/db-postgres";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildConfig } from "payload";

import { Customers } from "./collections/Customers";
import { Orders } from "./collections/Orders";
import { Users } from "./collections/Users";
import { CheckoutSettings } from "./globals/CheckoutSettings";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

const requireEnvironmentVariable = (
  name: "DATABASE_URL" | "PAYLOAD_SECRET",
): string => {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
};

const databaseURL = requireEnvironmentVariable("DATABASE_URL");
const payloadSecret = requireEnvironmentVariable("PAYLOAD_SECRET");

export default buildConfig({
  admin: {
    user: Users.slug,
  },
  collections: [Users, Customers, Orders],
  globals: [CheckoutSettings],
  db: postgresAdapter({
    pool: {
      connectionString: databaseURL,
    },
    push: false,
  }),
  graphQL: {
    disable: true,
  },
  secret: payloadSecret,
  typescript: {
    outputFile: path.resolve(dirname, "payload-types.ts"),
  },
});
