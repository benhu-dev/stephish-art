import type { S3StorageOptions } from "@payloadcms/storage-s3";

export const ORDER_UPLOAD_MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;

type StorageEnvironmentName =
  | "SUPABASE_STORAGE_ACCESS_KEY_ID"
  | "SUPABASE_STORAGE_BUCKET"
  | "SUPABASE_STORAGE_ENDPOINT"
  | "SUPABASE_STORAGE_REGION"
  | "SUPABASE_STORAGE_SECRET_ACCESS_KEY";

type StorageEnvironment = Readonly<Record<string, string | undefined>>;

const requireStorageEnvironmentVariable = (
  environment: StorageEnvironment,
  name: StorageEnvironmentName,
): string => {
  const value = environment[name];

  if (!value?.trim()) {
    throw new Error(`Missing required server storage configuration: ${name}`);
  }

  return value;
};

export const getOrderUploadStorageOptions = (
  environment: StorageEnvironment = process.env,
): S3StorageOptions => {
  const bucket = requireStorageEnvironmentVariable(
    environment,
    "SUPABASE_STORAGE_BUCKET",
  );
  const endpoint = requireStorageEnvironmentVariable(
    environment,
    "SUPABASE_STORAGE_ENDPOINT",
  );
  const region = requireStorageEnvironmentVariable(
    environment,
    "SUPABASE_STORAGE_REGION",
  );
  const accessKeyId = requireStorageEnvironmentVariable(
    environment,
    "SUPABASE_STORAGE_ACCESS_KEY_ID",
  );
  const secretAccessKey = requireStorageEnvironmentVariable(
    environment,
    "SUPABASE_STORAGE_SECRET_ACCESS_KEY",
  );

  if (bucket !== "order-uploads") {
    throw new Error(
      "SUPABASE_STORAGE_BUCKET must name the approved private bucket.",
    );
  }

  try {
    if (new URL(endpoint).protocol !== "https:") {
      throw new Error();
    }
  } catch {
    throw new Error("SUPABASE_STORAGE_ENDPOINT must be a valid HTTPS URL.");
  }

  return {
    bucket,
    clientUploads: false,
    collections: {
      "order-uploads": true,
    },
    config: {
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      endpoint,
      forcePathStyle: true,
      region,
    },
    disableLocalStorage: true,
    signedDownloads: true,
  };
};
