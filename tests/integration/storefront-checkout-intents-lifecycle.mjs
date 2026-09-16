import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import nextEnvironment from "@next/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import sharp from "sharp";
import { createLocalReq, getPayload } from "payload";

import { parseCheckoutIntentCookie } from "../../src/server/storefront/checkoutIntentCookie.ts";
import {
  deleteCheckoutIntentFile,
  uploadCheckoutIntentFile,
} from "../../src/server/storefront/orderUploadService.ts";

const { loadEnvConfig } = nextEnvironment;
const { Client } = pg;
const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const baseURL = process.argv[2] ?? "http://127.0.0.1:3000";
const expectSecureCookie = process.argv[3] === "production";
const requestOrigin = new URL(baseURL).origin;
const testRun = `unit-2-6-${randomUUID()}`;
const maximumFileBytes = 15 * 1024 * 1024;

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

let payload;
let database;
let storage;
let checkoutSettingsBefore;
let stage = "INITIALIZE";
let completed = false;
let cleanupFallbackUsed = false;
const intentIDs = new Set();
const objectKeys = new Set();

const checkNoStore = (response) => {
  assert.equal(response.headers.get("cache-control"), "no-store");
};

const request = async (path, init) => {
  const response = await fetch(new URL(path, baseURL), init);
  checkNoStore(response);
  return response;
};

const cookieHeaderFromSetCookie = (setCookie) => {
  assert.ok(setCookie);
  return setCookie.split(";", 1)[0];
};

const credentialFromCookie = (cookieHeader) => {
  const parsed = parseCheckoutIntentCookie(cookieHeader);
  assert.equal(parsed.kind, "valid");
  intentIDs.add(parsed.credential.intentId);
  return parsed.credential;
};

const jsonBody = async (response) => {
  const body = await response.json();
  assert.equal(typeof body, "object");
  return body;
};

const assertSafeState = (body, minimumAmountCents) => {
  assert.deepEqual(Object.keys(body).sort(), [
    "amountCents",
    "expiresAt",
    "limits",
    "status",
    "uploads",
  ]);
  assert.deepEqual(body.limits, {
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    maxFileBytes: maximumFileBytes,
    maxFiles: 3,
    maxTotalBytes: 30 * 1024 * 1024,
    minimumAmountCents,
  });
  for (const upload of body.uploads) {
    assert.deepEqual(Object.keys(upload).sort(), [
      "id",
      "mimeType",
      "position",
      "sizeBytes",
    ]);
  }
};

const createIntent = async (amountCents, cookie) => {
  const response = await request("/api/storefront/checkout-intents", {
    body: JSON.stringify({ amountCents }),
    headers: {
      "content-type": "application/json",
      origin: requestOrigin,
      ...(cookie ? { cookie } : {}),
    },
    method: "POST",
  });
  const body = await jsonBody(response);
  const setCookie = response.headers.get("set-cookie");
  const cookieHeader = cookieHeaderFromSetCookie(setCookie);
  const credential = credentialFromCookie(cookieHeader);
  return { body, cookie: cookieHeader, credential, response, setCookie };
};

const upload = async (
  cookie,
  { data = png, filename = `${testRun}-client.png`, mimeType = "image/png", position = 1 } = {},
  extraField,
) => {
  const form = new FormData();
  form.append("file", new Blob([data], { type: mimeType }), filename);
  form.append("_payload", JSON.stringify({ position }));
  if (extraField) form.append(extraField, "unexpected");
  return request("/api/storefront/checkout-intents/current/uploads", {
    body: form,
    headers: { cookie, origin: requestOrigin },
    method: "POST",
  });
};

const listObjects = async () => {
  const result = await storage.send(
    new ListObjectsV2Command({
      Bucket: process.env.SUPABASE_STORAGE_BUCKET,
      MaxKeys: 1000,
    }),
  );
  return result.Contents ?? [];
};

const countRows = async () => {
  const result = await database.query(
    "SELECT " +
      "(SELECT count(*)::int FROM public.checkout_intents) AS checkout_intents, " +
      "(SELECT count(*)::int FROM public.order_uploads) AS order_uploads, " +
      "(SELECT count(*)::int FROM public.customers) AS customers, " +
      "(SELECT count(*)::int FROM public.orders) AS orders",
  );
  return result.rows[0];
};

const uploadsForIntent = async (intentId) => {
  const result = await database.query(
    "SELECT id, position::int, filename, mime_type, filesize::int " +
      "FROM public.order_uploads WHERE checkout_intent_id = $1 ORDER BY position",
    [intentId],
  );
  for (const row of result.rows) {
    if (row.filename) objectKeys.add(row.filename);
  }
  return result.rows;
};

const paddedImage = (data, size) => {
  assert.ok(data.length <= size);
  return Buffer.concat([data, Buffer.alloc(size - data.length)]);
};

const crc32 = (data) => {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const excessivePixelPNG = () => {
  const image = Buffer.from(png);
  image.writeUInt32BE(10_001, 16);
  image.writeUInt32BE(10_000, 20);
  image.writeUInt32BE(crc32(image.subarray(12, 29)), 29);
  return image;
};

const expectStatus = async (response, status) => {
  assert.equal(response.status, status);
  return jsonBody(response);
};

const createLocalRequest = () => createLocalReq({}, payload);

loadEnvConfig(projectRoot, true, { error() {}, info() {} });

try {
  stage = "CONNECT";
  const { default: config } = await import("../../src/payload.config.ts");
  payload = await getPayload({ config });
  database = new Client({ connectionString: process.env.DATABASE_URL });
  await database.connect();
  storage = new S3Client({
    credentials: {
      accessKeyId: process.env.SUPABASE_STORAGE_ACCESS_KEY_ID,
      secretAccessKey: process.env.SUPABASE_STORAGE_SECRET_ACCESS_KEY,
    },
    endpoint: process.env.SUPABASE_STORAGE_ENDPOINT,
    forcePathStyle: true,
    region: process.env.SUPABASE_STORAGE_REGION,
  });

  stage = "BASELINE";
  assert.deepEqual(await countRows(), {
    checkout_intents: 0,
    customers: 0,
    order_uploads: 0,
    orders: 0,
  });
  assert.equal((await listObjects()).length, 0);
  checkoutSettingsBefore = (
    await database.query("SELECT * FROM public.checkout_settings ORDER BY id")
  ).rows[0];
  assert.ok(checkoutSettingsBefore);

  stage = "REQUEST_SECURITY";
  for (const headers of [
    { "content-type": "application/json" },
    { "content-type": "application/json", origin: "https://elsewhere.invalid" },
  ]) {
    await expectStatus(
      await request("/api/storefront/checkout-intents", {
        body: JSON.stringify({ amountCents: 500 }),
        headers,
        method: "POST",
      }),
      403,
    );
  }
  await expectStatus(
    await request("/api/storefront/checkout-intents", {
      body: "amountCents=500",
      headers: { "content-type": "text/plain", origin: requestOrigin },
      method: "POST",
    }),
    415,
  );
  for (const body of [
    {},
    { amountCents: "500" },
    { amountCents: 500.5 },
    { amountCents: 0 },
    { amountCents: 500, unexpected: true },
  ]) {
    const response = await request("/api/storefront/checkout-intents", {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", origin: requestOrigin },
      method: "POST",
    });
    assert.ok(response.status === 400 || response.status === 422);
    await jsonBody(response);
  }
  assert.equal((await countRows()).checkout_intents, 0);

  stage = "DYNAMIC_MINIMUM_AND_CREATE";
  await payload.updateGlobal({
    data: { minimumAmountCents: 700 },
    overrideAccess: true,
    slug: "checkout-settings",
  });
  await expectStatus(
    await request("/api/storefront/checkout-intents", {
      body: JSON.stringify({ amountCents: 699 }),
      headers: { "content-type": "application/json", origin: requestOrigin },
      method: "POST",
    }),
    422,
  );
  const primary = await createIntent(700);
  assert.equal(primary.response.status, 201);
  assertSafeState(primary.body, 700);
  assert.equal(primary.body.amountCents, 700);
  assert.equal(primary.body.status, "draft");
  assert.deepEqual(primary.body.uploads, []);
  assert.match(primary.setCookie, /HttpOnly/i);
  assert.match(primary.setCookie, /SameSite=Strict/i);
  assert.match(
    primary.setCookie,
    /Path=\/api\/storefront\/checkout-intents/i,
  );
  assert.equal(/Domain=/i.test(primary.setCookie), false);
  assert.equal(/; Secure/i.test(primary.setCookie), expectSecureCookie);
  assert.equal(
    JSON.stringify(primary.body).includes(primary.credential.rawToken),
    false,
  );

  const persistedBeforeResume = (
    await database.query(
      "SELECT amount_cents::int, access_token_hash, expires_at, delete_after, updated_at " +
        "FROM public.checkout_intents WHERE id = $1",
      [primary.credential.intentId],
    )
  ).rows[0];
  assert.notEqual(persistedBeforeResume.access_token_hash, primary.credential.rawToken);
  assert.equal(persistedBeforeResume.access_token_hash.length, 64);
  const cookieExpiry = new Date(
    primary.setCookie.match(/Expires=([^;]+)/i)[1],
  ).getTime();
  assert.ok(cookieExpiry <= new Date(persistedBeforeResume.expires_at).getTime());

  stage = "RESUME_AND_CURRENT";
  const resumed = await createIntent(725, primary.cookie);
  assert.equal(resumed.response.status, 200);
  assert.equal(resumed.credential.intentId, primary.credential.intentId);
  assert.equal(resumed.cookie, primary.cookie);
  assert.equal(resumed.body.amountCents, 725);
  const persistedAfterResume = (
    await database.query(
      "SELECT amount_cents::int, access_token_hash, expires_at, delete_after, updated_at " +
        "FROM public.checkout_intents WHERE id = $1",
      [primary.credential.intentId],
    )
  ).rows[0];
  assert.equal(persistedAfterResume.amount_cents, 725);
  assert.equal(
    persistedAfterResume.access_token_hash,
    persistedBeforeResume.access_token_hash,
  );
  assert.equal(
    new Date(persistedAfterResume.expires_at).toISOString(),
    new Date(persistedBeforeResume.expires_at).toISOString(),
  );
  assert.equal(
    new Date(persistedAfterResume.delete_after).toISOString(),
    new Date(persistedBeforeResume.delete_after).toISOString(),
  );
  const beforeCurrent = JSON.stringify(persistedAfterResume);
  const currentResponse = await request(
    "/api/storefront/checkout-intents/current",
    { headers: { cookie: primary.cookie } },
  );
  assert.equal(currentResponse.status, 200);
  assert.equal(currentResponse.headers.get("set-cookie"), null);
  assertSafeState(await jsonBody(currentResponse), 700);
  const afterCurrent = (
    await database.query(
      "SELECT amount_cents::int, access_token_hash, expires_at, delete_after, updated_at " +
        "FROM public.checkout_intents WHERE id = $1",
      [primary.credential.intentId],
    )
  ).rows[0];
  assert.equal(JSON.stringify(afterCurrent), beforeCurrent);

  stage = "GENERIC_CREDENTIAL_DENIAL";
  const malformed = await request("/api/storefront/checkout-intents/current", {
    headers: { cookie: "stephish_checkout_intent=malformed" },
  });
  const malformedBody = await expectStatus(malformed, 401);
  assert.match(malformed.headers.get("set-cookie"), /Max-Age=0/);
  const wrongToken = `${primary.cookie.slice(0, primary.cookie.lastIndexOf(".") + 1)}${"B".repeat(43)}`;
  const wrongResponse = await request("/api/storefront/checkout-intents/current", {
    headers: { cookie: wrongToken },
  });
  const wrongBody = await expectStatus(wrongResponse, 401);
  const unknownCookie = `stephish_checkout_intent=v1.2147483000.${"C".repeat(43)}`;
  const unknownBody = await expectStatus(
    await request("/api/storefront/checkout-intents/current", {
      headers: { cookie: unknownCookie },
    }),
    401,
  );
  assert.deepEqual(malformedBody, wrongBody);
  assert.deepEqual(wrongBody, unknownBody);
  await expectStatus(
    await request("/api/storefront/checkout-intents/current"),
    401,
  );

  stage = "VALID_UPLOADS_AND_DELETE";
  const jpeg = await sharp({
    create: { background: "red", channels: 3, height: 2, width: 2 },
  })
    .jpeg()
    .toBuffer();
  const webp = await sharp({
    create: { background: "blue", channels: 3, height: 2, width: 2 },
  })
    .webp()
    .toBuffer();
  let response = await upload(primary.cookie, { position: 1 });
  assert.equal(response.status, 201);
  let uploadBody = await jsonBody(response);
  assertSafeState(uploadBody, 700);
  assert.equal(uploadBody.uploads.length, 1);
  await expectStatus(
    await upload(primary.cookie, {
      data: jpeg,
      filename: `${testRun}-duplicate.jpg`,
      mimeType: "image/jpeg",
      position: 1,
    }),
    409,
  );
  response = await upload(primary.cookie, {
    data: webp,
    filename: `${testRun}-original-name.webp`,
    mimeType: "image/webp",
    position: 2,
  });
  assert.equal(response.status, 201);
  response = await upload(primary.cookie, {
    data: jpeg,
    mimeType: "image/jpeg",
    position: 3,
  });
  assert.equal(response.status, 201);
  uploadBody = await jsonBody(response);
  assert.deepEqual(
    uploadBody.uploads.map(({ position }) => position),
    [1, 2, 3],
  );
  await expectStatus(await upload(primary.cookie, { position: 2 }), 409);
  let primaryUploads = await uploadsForIntent(primary.credential.intentId);
  assert.equal(primaryUploads.length, 3);
  assert.match(primaryUploads[0].filename, /^[0-9a-f-]{36}\.png$/);
  assert.equal(primaryUploads.some(({ filename }) => filename.includes(testRun)), false);

  const secondary = await createIntent(700);
  assert.equal(secondary.response.status, 201);
  const crossReadCookie = `stephish_checkout_intent=v1.${secondary.credential.intentId}.${primary.credential.rawToken}`;
  await expectStatus(
    await request("/api/storefront/checkout-intents/current", {
      headers: { cookie: crossReadCookie },
    }),
    401,
  );
  const positionTwo = primaryUploads.find(({ position }) => position === 2);
  const crossDeleteBody = await expectStatus(
    await request(
      `/api/storefront/checkout-intents/current/uploads/${positionTwo.id}`,
      {
        headers: { cookie: secondary.cookie, origin: requestOrigin },
        method: "DELETE",
      },
    ),
    404,
  );
  const absentDeleteBody = await expectStatus(
    await request(
      "/api/storefront/checkout-intents/current/uploads/2147483000",
      {
        headers: { cookie: secondary.cookie, origin: requestOrigin },
        method: "DELETE",
      },
    ),
    404,
  );
  assert.deepEqual(crossDeleteBody, absentDeleteBody);
  response = await request(
    `/api/storefront/checkout-intents/current/uploads/${positionTwo.id}`,
    {
      headers: { cookie: primary.cookie, origin: requestOrigin },
      method: "DELETE",
    },
  );
  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
  primaryUploads = await uploadsForIntent(primary.credential.intentId);
  assert.deepEqual(primaryUploads.map(({ position }) => position), [1, 3]);
  response = await upload(primary.cookie, {
    data: webp,
    mimeType: "image/webp",
    position: 2,
  });
  assert.equal(response.status, 201);

  stage = "INVALID_IMAGES_AND_MULTIPART";
  const invalidIntent = await createIntent(700);
  for (const invalidResponse of [
    await upload(invalidIntent.cookie, {
      data: Buffer.from("not an image"),
      mimeType: "image/png",
      position: 1,
    }),
    await upload(invalidIntent.cookie, {
      data: png,
      mimeType: "image/jpeg",
      position: 1,
    }),
    await upload(invalidIntent.cookie, {
      data: Buffer.alloc(0),
      mimeType: "image/png",
      position: 1,
    }),
    await upload(invalidIntent.cookie, {
      data: excessivePixelPNG(),
      mimeType: "image/png",
      position: 1,
    }),
  ]) {
    assert.ok(invalidResponse.status === 400 || invalidResponse.status === 422);
    await jsonBody(invalidResponse);
  }
  await expectStatus(
    await upload(invalidIntent.cookie, { position: 1 }, "extra"),
    400,
  );
  await expectStatus(
    await upload(invalidIntent.cookie, { position: 4 }),
    400,
  );
  await expectStatus(
    await upload(invalidIntent.cookie, {
      data: paddedImage(png, maximumFileBytes + 1),
      position: 1,
    }),
    413,
  );
  assert.equal((await uploadsForIntent(invalidIntent.credential.intentId)).length, 0);

  stage = "EXACT_SIZE_BOUNDARIES";
  const boundaryIntent = await createIntent(700);
  const exactMaximumImage = paddedImage(png, maximumFileBytes);
  const firstBoundaryUpload = await upload(boundaryIntent.cookie, {
    data: exactMaximumImage,
    position: 1,
  });
  if (firstBoundaryUpload.status !== 201) {
    const failure = await jsonBody(firstBoundaryUpload);
    throw new Error(failure.error?.code ?? "BOUNDARY_UPLOAD_FAILED");
  }
  assert.equal(
    (await upload(boundaryIntent.cookie, { data: exactMaximumImage, position: 2 })).status,
    201,
  );
  await expectStatus(
    await upload(boundaryIntent.cookie, { position: 3 }),
    413,
  );
  assert.equal(
    (await uploadsForIntent(boundaryIntent.credential.intentId)).reduce(
      (total, item) => total + item.filesize,
      0,
    ),
    30 * 1024 * 1024,
  );

  stage = "CONCURRENCY";
  const duplicateRace = await createIntent(700);
  const duplicateResults = await Promise.all([
    upload(duplicateRace.cookie, { data: png, position: 1 }),
    upload(duplicateRace.cookie, {
      data: jpeg,
      mimeType: "image/jpeg",
      position: 1,
    }),
  ]);
  assert.deepEqual(
    duplicateResults.map(({ status }) => status).sort(),
    [201, 409],
  );
  assert.equal((await uploadsForIntent(duplicateRace.credential.intentId)).length, 1);

  const countRace = await createIntent(700);
  const countResults = await Promise.all([
    upload(countRace.cookie, { position: 1 }),
    upload(countRace.cookie, { data: jpeg, mimeType: "image/jpeg", position: 2 }),
    upload(countRace.cookie, { data: webp, mimeType: "image/webp", position: 3 }),
    upload(countRace.cookie, { data: jpeg, mimeType: "image/jpeg", position: 1 }),
  ]);
  assert.equal(countResults.filter(({ status }) => status === 201).length, 3);
  assert.equal((await uploadsForIntent(countRace.credential.intentId)).length, 3);

  const aggregateRace = await createIntent(700);
  const elevenMiB = paddedImage(png, 11 * 1024 * 1024);
  const aggregateResults = await Promise.all([
    upload(aggregateRace.cookie, { data: elevenMiB, position: 1 }),
    upload(aggregateRace.cookie, { data: elevenMiB, position: 2 }),
    upload(aggregateRace.cookie, { data: elevenMiB, position: 3 }),
  ]);
  assert.equal(aggregateResults.filter(({ status }) => status === 201).length, 2);
  assert.equal(
    (await uploadsForIntent(aggregateRace.credential.intentId)).reduce(
      (total, item) => total + item.filesize,
      0,
    ),
    22 * 1024 * 1024,
  );

  stage = "INACTIVE_INTENTS";
  const expiredIntent = await createIntent(700);
  assert.equal((await upload(expiredIntent.cookie)).status, 201);
  const expiredUpload = (await uploadsForIntent(expiredIntent.credential.intentId))[0];
  await database.query(
    "UPDATE public.checkout_intents SET expires_at = now() - interval '1 hour', " +
      "delete_after = now() + interval '1 hour' WHERE id = $1",
    [expiredIntent.credential.intentId],
  );
  for (const inactiveResponse of [
    await upload(expiredIntent.cookie, { position: 2 }),
    await request(
      `/api/storefront/checkout-intents/current/uploads/${expiredUpload.id}`,
      {
        headers: { cookie: expiredIntent.cookie, origin: requestOrigin },
        method: "DELETE",
      },
    ),
  ]) {
    assert.equal(inactiveResponse.status, 401);
    assert.match(inactiveResponse.headers.get("set-cookie"), /Max-Age=0/);
  }
  const nonDraftIntent = await createIntent(700);
  assert.equal((await upload(nonDraftIntent.cookie)).status, 201);
  const nonDraftUpload = (await uploadsForIntent(nonDraftIntent.credential.intentId))[0];
  await database.query(
    "UPDATE public.checkout_intents SET status = 'checkout_created' WHERE id = $1",
    [nonDraftIntent.credential.intentId],
  );
  assert.equal(
    (await upload(nonDraftIntent.cookie, { position: 2 })).status,
    409,
  );
  assert.equal(
    (
      await request(
        `/api/storefront/checkout-intents/current/uploads/${nonDraftUpload.id}`,
        {
          headers: { cookie: nonDraftIntent.cookie, origin: requestOrigin },
          method: "DELETE",
        },
      )
    ).status,
    409,
  );

  stage = "FORCED_FAILURE_COMPENSATION";
  const failedUploadIntent = await createIntent(700);
  let forcedUploadKey;
  const forcedUploadRequest = await createLocalRequest();
  await assert.rejects(() =>
    uploadCheckoutIntentFile(
      {
        credential: failedUploadIntent.credential,
        file: { data: png, mimetype: "image/png", size: png.length },
        position: 1,
        request: forcedUploadRequest,
      },
      {
        afterPersistence: ({ filename }) => {
          forcedUploadKey = filename;
          objectKeys.add(filename);
          throw new Error("FORCED_AFTER_PERSISTENCE");
        },
      },
    ),
  );
  assert.equal((await uploadsForIntent(failedUploadIntent.credential.intentId)).length, 0);
  assert.equal((await listObjects()).some(({ Key }) => Key === forcedUploadKey), false);

  const failedDeleteIntent = await createIntent(700);
  assert.equal((await upload(failedDeleteIntent.cookie)).status, 201);
  const failedDeleteUpload = (
    await uploadsForIntent(failedDeleteIntent.credential.intentId)
  )[0];
  const forcedDeleteRequest = await createLocalRequest();
  await assert.rejects(() =>
    deleteCheckoutIntentFile(
      {
        credential: failedDeleteIntent.credential,
        request: forcedDeleteRequest,
        uploadId: failedDeleteUpload.id,
      },
      {
        afterPersistence: () => {
          throw new Error("FORCED_AFTER_DELETE");
        },
      },
    ),
  );
  assert.equal((await uploadsForIntent(failedDeleteIntent.credential.intentId)).length, 1);
  assert.equal(
    (await listObjects()).some(({ Key }) => Key === failedDeleteUpload.filename),
    true,
  );

  stage = "DIRECT_ACCESS_DENIAL";
  for (const [path, init] of [
    ["/api/checkout-intents", undefined],
    ["/api/order-uploads", undefined],
    ["/api/order-uploads", { body: JSON.stringify({}), headers: { "content-type": "application/json" }, method: "POST" }],
  ]) {
    const directResponse = await fetch(new URL(path, baseURL), init);
    assert.ok(directResponse.status === 401 || directResponse.status === 403);
  }
  const unsignedKey = (await uploadsForIntent(primary.credential.intentId))[0]
    .filename;
  const unsignedURL =
    `${process.env.SUPABASE_STORAGE_ENDPOINT.replace(/\/$/, "")}/` +
    `${encodeURIComponent(process.env.SUPABASE_STORAGE_BUCKET)}/` +
    encodeURIComponent(unsignedKey);
  assert.equal((await fetch(unsignedURL)).status, 403);

  completed = true;
} catch (error) {
  console.log("STOREFRONT_LIFECYCLE_RESULT=FAIL");
  console.log(`STOREFRONT_LIFECYCLE_STAGE=${stage}`);
  if (error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)) {
    console.log(`STOREFRONT_LIFECYCLE_FAILURE=${error.message}`);
  } else {
    console.log("STOREFRONT_LIFECYCLE_FAILURE=ASSERTION_OR_RUNTIME_ERROR");
  }
  process.exitCode = 1;
} finally {
  stage = "CLEANUP";
  if (payload) {
    for (const intentId of intentIDs) {
      try {
        const uploads = await payload.find({
          collection: "order-uploads",
          depth: 0,
          limit: 100,
          overrideAccess: true,
          pagination: false,
          where: { checkoutIntent: { equals: intentId } },
        });
        for (const document of uploads.docs) {
          if (document.filename) objectKeys.add(document.filename);
          await payload.delete({
            collection: "order-uploads",
            id: document.id,
            overrideAccess: true,
          });
        }
        await payload.delete({
          collection: "checkout-intents",
          id: intentId,
          overrideAccess: true,
        });
      } catch {
        cleanupFallbackUsed = true;
      }
    }
  }

  if (database && checkoutSettingsBefore) {
    try {
      await database.query(
        "UPDATE public.checkout_settings SET minimum_amount_cents = $1, updated_at = $2 WHERE id = $3",
        [
          checkoutSettingsBefore.minimum_amount_cents,
          checkoutSettingsBefore.updated_at,
          checkoutSettingsBefore.id,
        ],
      );
    } catch {
      cleanupFallbackUsed = true;
    }
  }

  if (storage) {
    for (const key of objectKeys) {
      try {
        const remaining = await listObjects();
        if (remaining.some(({ Key }) => Key === key)) {
          cleanupFallbackUsed = true;
          await storage.send(
            new DeleteObjectCommand({
              Bucket: process.env.SUPABASE_STORAGE_BUCKET,
              Key: key,
            }),
          );
        }
      } catch {
        cleanupFallbackUsed = true;
      }
    }
  }

  let finalCounts;
  let finalObjectCount;
  try {
    finalCounts = database ? await countRows() : undefined;
    finalObjectCount = storage ? (await listObjects()).length : undefined;
    assert.deepEqual(finalCounts, {
      checkout_intents: 0,
      customers: 0,
      order_uploads: 0,
      orders: 0,
    });
    assert.equal(finalObjectCount, 0);
  } catch {
    process.exitCode = 1;
  }

  await database?.end().catch(() => {});
  storage?.destroy();
  await Promise.race([
    payload?.destroy().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);

  if (completed && !cleanupFallbackUsed && !process.exitCode) {
    console.log("STOREFRONT_LIFECYCLE_RESULT=PASS");
    console.log("DYNAMIC_MINIMUM_AND_SAFE_RESPONSE=PASS");
    console.log("COOKIE_AND_CREDENTIAL_CONTRACT=PASS");
    console.log("UPLOAD_VALIDATION_AND_BOUNDARIES=PASS");
    console.log("ROW_LOCK_CONCURRENCY=PASS");
    console.log("DELETE_AND_COMPENSATION=PASS");
    console.log("ORIGIN_AND_DIRECT_ACCESS=DENIED");
    console.log(`FINAL_CHECKOUT_INTENT_COUNT=${finalCounts.checkout_intents}`);
    console.log(`FINAL_ORDER_UPLOAD_COUNT=${finalCounts.order_uploads}`);
    console.log(`FINAL_BUCKET_OBJECT_COUNT=${finalObjectCount}`);
    console.log(`FINAL_CUSTOMER_COUNT=${finalCounts.customers}`);
    console.log(`FINAL_ORDER_COUNT=${finalCounts.orders}`);
  } else if (cleanupFallbackUsed) {
    console.log("CLEANUP_FALLBACK_USED=true");
    process.exitCode = 1;
  }

  process.exit(process.exitCode ?? 0);
}
