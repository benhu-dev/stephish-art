import path from "node:path";
import type { PayloadRequest } from "payload";

import { openPrivateStorageObject } from "../storage/orderUploadObjectStorage";
import {
  TEMPLATE_MEDIA_MAX_FILE_SIZE_BYTES,
  TEMPLATE_MEDIA_MIME_TYPES,
  TEMPLATE_MEDIA_PREFIX,
} from "./templateMediaPolicy";

const CATALOG_LIMIT = 100;
const allowedMimeTypes = new Set<string>(TEMPLATE_MEDIA_MIME_TYPES);

export class PostcardTemplateCatalogError extends Error {
  constructor(
    readonly status: 400 | 404 | 500,
    readonly code:
      | "CATALOG_UNAVAILABLE"
      | "INVALID_CATALOG_REQUEST"
      | "TEMPLATE_MEDIA_NOT_FOUND",
  ) {
    super(code);
  }
}

const requirePositiveInteger = (value: unknown) => {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw new PostcardTemplateCatalogError(500, "CATALOG_UNAVAILABLE");
  }
  return value;
};

const requirePublicMedia = (value: unknown) => {
  if (typeof value !== "object" || value === null) {
    throw new PostcardTemplateCatalogError(500, "CATALOG_UNAVAILABLE");
  }
  const media = value as Record<string, unknown>;
  const id = requirePositiveInteger(media.id);
  const alt = typeof media.alt === "string" ? media.alt.trim() : "";
  const width = requirePositiveInteger(media.width);
  const height = requirePositiveInteger(media.height);
  if (!alt || alt.length > 240) {
    throw new PostcardTemplateCatalogError(500, "CATALOG_UNAVAILABLE");
  }
  return { alt, height, id, width };
};

export const readAvailablePostcardTemplates = async (
  request: PayloadRequest,
) => {
  const result = await request.payload.find({
    collection: "postcard-templates",
    depth: 1,
    limit: CATALOG_LIMIT,
    overrideAccess: true,
    pagination: false,
    req: request,
    select: {
      description: true,
      name: true,
      previewMedia: true,
      sortOrder: true,
    },
    sort: ["sortOrder", "name", "id"],
    where: { available: { equals: true } },
  });

  return {
    templates: result.docs.map((template) => {
      const id = requirePositiveInteger(template.id);
      const name = typeof template.name === "string" ? template.name.trim() : "";
      const description =
        typeof template.description === "string"
          ? template.description.trim()
          : "";
      if (!name || name.length > 120 || description.length > 320) {
        throw new PostcardTemplateCatalogError(500, "CATALOG_UNAVAILABLE");
      }
      const media = requirePublicMedia(template.previewMedia);

      return {
        description: description || null,
        id,
        name,
        preview: {
          alt: media.alt,
          height: media.height,
          url: `/api/storefront/template-media/${media.id}`,
          width: media.width,
        },
      };
    }),
  };
};

type OpenPrivateStorageObject = typeof openPrivateStorageObject;

export const readAvailableTemplateMedia = async ({
  mediaId,
  openObject = openPrivateStorageObject,
  request,
}: {
  mediaId: number;
  openObject?: OpenPrivateStorageObject;
  request: PayloadRequest;
}) => {
  const references = await request.payload.find({
    collection: "postcard-templates",
    depth: 0,
    limit: 1,
    overrideAccess: true,
    pagination: false,
    req: request,
    select: { available: true },
    where: {
      and: [
        { available: { equals: true } },
        { previewMedia: { equals: mediaId } },
      ],
    },
  });
  if (references.docs.length === 0) {
    throw new PostcardTemplateCatalogError(404, "TEMPLATE_MEDIA_NOT_FOUND");
  }

  let media;
  try {
    media = await request.payload.findByID({
      collection: "template-media",
      depth: 0,
      id: mediaId,
      overrideAccess: true,
      req: request,
      select: {
        filename: true,
        filesize: true,
        mimeType: true,
        prefix: true,
      },
    });
  } catch {
    throw new PostcardTemplateCatalogError(404, "TEMPLATE_MEDIA_NOT_FOUND");
  }

  const filename = media.filename;
  const filesize = Number(media.filesize);
  const mimeType = media.mimeType;
  const prefix = media.prefix;
  if (
    typeof filename !== "string" ||
    !/^[^/\\]{1,255}$/.test(filename) ||
    filename === "." ||
    filename === ".." ||
    !Number.isSafeInteger(filesize) ||
    filesize <= 0 ||
    filesize > TEMPLATE_MEDIA_MAX_FILE_SIZE_BYTES ||
    typeof mimeType !== "string" ||
    !allowedMimeTypes.has(mimeType) ||
    prefix !== TEMPLATE_MEDIA_PREFIX
  ) {
    throw new PostcardTemplateCatalogError(500, "CATALOG_UNAVAILABLE");
  }

  try {
    const object = await openObject(
      path.posix.join(TEMPLATE_MEDIA_PREFIX, filename),
      request.signal,
    );
    if (
      object.contentType !== mimeType ||
      object.contentLength !== filesize
    ) {
      throw new PostcardTemplateCatalogError(500, "CATALOG_UNAVAILABLE");
    }
    return {
      contentLength: filesize,
      contentType: mimeType,
      stream: object.stream,
    };
  } catch (error) {
    if (error instanceof PostcardTemplateCatalogError) throw error;
    throw new PostcardTemplateCatalogError(500, "CATALOG_UNAVAILABLE");
  }
};
