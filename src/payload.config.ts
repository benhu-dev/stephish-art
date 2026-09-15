import { postgresAdapter } from "@payloadcms/db-postgres";
import { s3Storage } from "@payloadcms/storage-s3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildConfig } from "payload";

import { Customers } from "./collections/Customers";
import { CheckoutIntents } from "./collections/CheckoutIntents";
import { OrderUploads } from "./collections/OrderUploads";
import { Orders } from "./collections/Orders";
import { Users } from "./collections/Users";
import { CheckoutSettings } from "./globals/CheckoutSettings";
import {
  getOrderUploadStorageOptions,
  ORDER_UPLOAD_MAX_FILE_SIZE_BYTES,
} from "./server/storage/orderUploadStorage";

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
  collections: [Users, Customers, Orders, CheckoutIntents, OrderUploads],
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
  plugins: [s3Storage(getOrderUploadStorageOptions())],
  secret: payloadSecret,
  typescript: {
    outputFile: path.resolve(dirname, "payload-types.ts"),
  },
  upload: {
    abortOnLimit: true,
    limits: {
      fileSize: ORDER_UPLOAD_MAX_FILE_SIZE_BYTES,
    },
  },
});
