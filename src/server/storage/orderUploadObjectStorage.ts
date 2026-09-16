import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { getOrderUploadStorageOptions } from "./orderUploadStorage";

let storageClient: S3Client | undefined;

const getStorage = () => {
  const options = getOrderUploadStorageOptions();
  storageClient ??= new S3Client(options.config);

  return { bucket: options.bucket, client: storageClient };
};

export const readOrderUploadObject = async (filename: string) => {
  const { bucket, client } = getStorage();
  const result = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: filename }),
  );
  if (!result.Body) throw new Error("ORDER_UPLOAD_OBJECT_MISSING");

  return {
    contentType: result.ContentType,
    data: Buffer.from(await result.Body.transformToByteArray()),
  };
};

export const deleteOrderUploadObject = async (filename: string) => {
  const { bucket, client } = getStorage();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: filename }));
};

export const restoreOrderUploadObject = async ({
  contentType,
  data,
  filename,
}: {
  contentType: string;
  data: Buffer;
  filename: string;
}) => {
  const { bucket, client } = getStorage();
  await client.send(
    new PutObjectCommand({
      Body: data,
      Bucket: bucket,
      ContentType: contentType,
      Key: filename,
    }),
  );
};

export const compensateNewOrderUploadObject = async (filename: string) => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await deleteOrderUploadObject(filename);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
};
