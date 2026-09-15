import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import nextEnvironment from "@next/env";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { getPayload, jwtSign } from "payload";

const { loadEnvConfig } = nextEnvironment;
const { Client } = pg;
const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const baseURL = process.argv[2] ?? "http://127.0.0.1:3000";
const testPrefix = `unit-2-4-${randomUUID()}`;
const fixtureName = `${testPrefix}.png`;
const fixture = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

let stage = "INITIALIZE";
let payload;
let database;
let storage;
let document;
let completed = false;
let cleanupFallbackUsed = false;
let authenticationProbeResults;
let authenticatedDocumentStatus;
let signedResponseStatus;

const check = (condition, code) => {
  if (!condition) {
    throw new Error(code);
  }
};

const isDenied = (status) => status === 401 || status === 403;
const settleWithin = (promise, milliseconds = 5_000) =>
  Promise.race([
    promise.catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ]);

const fetchStatus = async (path, init) =>
  (await fetch(new URL(path, baseURL), init)).status;

const listObjects = async (prefix) => {
  const result = await storage.send(
    new ListObjectsV2Command({
      Bucket: process.env.SUPABASE_STORAGE_BUCKET,
      MaxKeys: 100,
      ...(prefix ? { Prefix: prefix } : {}),
    }),
  );

  return result.Contents ?? [];
};

const countUploadRecords = async (prefix) => {
  const values = [];
  let query = "SELECT count(*)::int AS count FROM public.order_uploads";

  if (prefix) {
    values.push(`${prefix}%`);
    query += " WHERE filename LIKE $1";
  }

  const result = await database.query(query, values);

  return result.rows[0].count;
};

const runAsDatabaseRole = async (role, query, values = []) => {
  check(role === "anon" || role === "authenticated", "UNAPPROVED_ROLE");
  await database.query("BEGIN");

  try {
    await database.query(`SET LOCAL ROLE ${role}`);
  } catch {
    await database.query("ROLLBACK");
    throw new Error("ROLE_SWITCH_FAILED");
  }

  try {
    const result = await database.query(query, values);
    await database.query("ROLLBACK");

    return { denied: false, result };
  } catch (error) {
    await database.query("ROLLBACK");

    return { denied: error?.code === "42501" };
  }
};

const verifyDatabaseRoleDenial = async (role) => {
  const select = await runAsDatabaseRole(
    role,
    "SELECT count(*)::int AS count FROM public.order_uploads WHERE filename = $1",
    [fixtureName],
  );
  check(
    select.denied || select.result.rows[0].count === 0,
    "ROLE_SELECT_EXPOSED_METADATA",
  );

  const insert = await runAsDatabaseRole(
    role,
    "INSERT INTO public.order_uploads (filename) VALUES ($1)",
    [`${testPrefix}-${role}-insert.png`],
  );
  check(insert.denied, "ROLE_INSERT_ALLOWED");

  for (const operation of ["UPDATE", "DELETE"]) {
    const query =
      operation === "UPDATE"
        ? "UPDATE public.order_uploads SET filename = filename WHERE filename = $1"
        : "DELETE FROM public.order_uploads WHERE filename = $1";
    const result = await runAsDatabaseRole(role, query, [fixtureName]);
    check(
      result.denied || result.result.rowCount === 0,
      `ROLE_${operation}_ALLOWED`,
    );
  }
};

loadEnvConfig(projectRoot, true, { error() {}, info() {} });

try {
  stage = "IMPORT_CONFIG";
  const { default: config } = await import("../../src/payload.config.ts");
  stage = "INITIALIZE_PAYLOAD";
  payload = await getPayload({ config });
  stage = "CONNECT_DATABASE";
  database = new Client({ connectionString: process.env.DATABASE_URL });
  await database.connect();
  stage = "INITIALIZE_STORAGE_CLIENT";
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
  check((await countUploadRecords()) === 0, "UPLOAD_TABLE_NOT_EMPTY");
  check((await listObjects()).length === 0, "BUCKET_NOT_EMPTY");
  const existingCounts = await database.query(
    "SELECT (SELECT count(*)::int FROM public.users) AS users, " +
      "(SELECT count(*)::int FROM public.customers) AS customers, " +
      "(SELECT count(*)::int FROM public.orders) AS orders",
  );
  check(existingCounts.rows[0].users === 1, "ADMIN_BASELINE_CHANGED");
  check(existingCounts.rows[0].customers === 0, "CUSTOMERS_NOT_EMPTY");
  check(existingCounts.rows[0].orders === 0, "ORDERS_NOT_EMPTY");
  const checkoutBefore = await database.query(
    "SELECT * FROM public.checkout_settings ORDER BY id",
  );
  const adminBefore = await database.query(
    "SELECT id, created_at, updated_at FROM public.users ORDER BY id",
  );

  stage = "DATABASE_SECURITY";
  const tableSecurity = await database.query(
    "SELECT c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced, " +
      "(SELECT count(*)::int FROM pg_policies p WHERE p.schemaname = 'public' " +
      "AND p.tablename = 'order_uploads') AS policy_count " +
      "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
      "WHERE n.nspname = 'public' AND c.relname = 'order_uploads'",
  );
  check(tableSecurity.rowCount === 1, "UPLOAD_TABLE_MISSING");
  check(tableSecurity.rows[0].rls_enabled === true, "RLS_NOT_ENABLED");
  check(tableSecurity.rows[0].rls_forced === false, "RLS_FORCED");
  check(tableSecurity.rows[0].policy_count === 0, "RLS_POLICY_PRESENT");

  stage = "ADMIN";
  const admins = await payload.find({
    collection: "users",
    limit: 2,
    overrideAccess: true,
    showHiddenFields: true,
  });
  check(admins.docs.length === 1, "ADMIN_COUNT_CHANGED");
  const admin = admins.docs[0];
  const adminSession = admin.sessions?.[0];
  check(Boolean(adminSession?.id), "ADMIN_SESSION_MISSING");

  stage = "UPLOAD";
  document = await payload.create({
    collection: "order-uploads",
    data: {},
    file: {
      data: fixture,
      mimetype: "image/png",
      name: fixtureName,
      size: fixture.length,
    },
    overrideAccess: false,
    user: admin,
  });
  check(document.filename === fixtureName, "FILENAME_CHANGED");
  check(document.mimeType === "image/png", "MIME_METADATA_WRONG");
  check(document.filesize === fixture.length, "SIZE_METADATA_WRONG");
  check((await countUploadRecords(testPrefix)) === 1, "UPLOAD_RECORD_COUNT_WRONG");
  const uploadedObjects = await listObjects(testPrefix);
  check(uploadedObjects.length === 1, "UPLOAD_OBJECT_COUNT_WRONG");
  check(uploadedObjects[0].Key === fixtureName, "UPLOAD_OBJECT_KEY_WRONG");

  stage = "AUTHENTICATED_LOCAL_API";
  const authorizedRead = await payload.findByID({
    collection: "order-uploads",
    id: document.id,
    overrideAccess: false,
    user: admin,
  });
  check(authorizedRead.id === document.id, "AUTHENTICATED_READ_FAILED");
  const authorizedList = await payload.find({
    collection: "order-uploads",
    overrideAccess: false,
    user: admin,
  });
  check(authorizedList.totalDocs === 1, "AUTHENTICATED_LIST_FAILED");
  const authorizedUpdate = await payload.update({
    collection: "order-uploads",
    data: {},
    id: document.id,
    overrideAccess: false,
    user: admin,
  });
  check(authorizedUpdate.id === document.id, "AUTHENTICATED_UPDATE_FAILED");

  stage = "DATABASE_ROLE_DENIAL";
  await verifyDatabaseRoleDenial("anon");
  await verifyDatabaseRoleDenial("authenticated");

  stage = "ROUTES";
  const rootResponse = await fetch(new URL("/", baseURL));
  check(rootResponse.status === 200, "ROOT_ROUTE_FAILED");
  check((await rootResponse.text()).includes("postcard-scene"), "SCENE_MARKUP_MISSING");
  check((await fetch(new URL("/admin", baseURL))).status === 200, "ADMIN_ROUTE_FAILED");

  for (const path of [
    "/api/users",
    "/api/customers",
    "/api/orders",
    "/api/globals/checkout-settings",
  ]) {
    check(isDenied(await fetchStatus(path)), "PROTECTED_API_EXPOSED");
  }
  for (const path of ["/api/graphql", "/api/graphql-playground"]) {
    check((await fetchStatus(path)) === 404, "GRAPHQL_ROUTE_AVAILABLE");
  }

  stage = "ANONYMOUS_UPLOAD_ACCESS";
  const collectionPath = "/api/order-uploads";
  const documentPath = `${collectionPath}/${document.id}`;
  const filePath = `${collectionPath}/file/${encodeURIComponent(fixtureName)}`;
  for (const [path, init] of [
    [collectionPath, undefined],
    [documentPath, undefined],
    [collectionPath, { body: JSON.stringify({}), headers: { "content-type": "application/json" }, method: "POST" }],
    [documentPath, { body: JSON.stringify({}), headers: { "content-type": "application/json" }, method: "PATCH" }],
    [documentPath, { method: "DELETE" }],
    [filePath, { redirect: "manual" }],
  ]) {
    check(isDenied(await fetchStatus(path, init)), "ANONYMOUS_OPERATION_ALLOWED");
  }

  const unsignedObjectURL = new URL(
    `${process.env.SUPABASE_STORAGE_ENDPOINT.replace(/\/$/, "")}/` +
      `${encodeURIComponent(process.env.SUPABASE_STORAGE_BUCKET)}/` +
      encodeURIComponent(fixtureName),
  );
  check((await fetch(unsignedObjectURL)).status === 403, "UNSIGNED_OBJECT_AVAILABLE");

  stage = "SIGNED_DOWNLOAD";
  const { token } = await jwtSign({
    fieldsToSign: {
      collection: "users",
      id: admin.id,
      sid: adminSession.id,
    },
    secret: payload.secret,
    tokenExpiration: payload.collections.users.config.auth.tokenExpiration,
  });
  const authenticationHeaders = [
    { Authorization: `JWT ${token}` },
    { Authorization: `Bearer ${token}` },
    { Cookie: `${payload.config.cookiePrefix}-token=${encodeURIComponent(token)}` },
  ];
  const authenticationProbes = await Promise.all(
    authenticationHeaders.map(async (headers) => {
      const response = await fetch(new URL("/api/users/me", baseURL), { headers });
      const body = await response.json();

      return {
        authenticated: body.user?.id === admin.id,
        headers,
        status: response.status,
      };
    }),
  );
  authenticationProbeResults = authenticationProbes.map(
    ({ authenticated, status }) => ({ authenticated, status }),
  );
  const authenticatedHeaders = authenticationProbes.find(
    ({ authenticated }) => authenticated,
  )?.headers;
  check(Boolean(authenticatedHeaders), "AUTHENTICATED_HTTP_FAILED");
  authenticatedDocumentStatus = await fetchStatus(documentPath, {
    headers: authenticatedHeaders,
  });
  check(authenticatedDocumentStatus === 200, "AUTHENTICATED_DOCUMENT_HTTP_FAILED");
  const signedResponse = await fetch(new URL(filePath, baseURL), {
    headers: authenticatedHeaders,
    redirect: "manual",
  });
  signedResponseStatus = signedResponse.status;
  check(signedResponse.status === 302, "SIGNED_REDIRECT_MISSING");
  const signedLocation = signedResponse.headers.get("location");
  check(Boolean(signedLocation), "SIGNED_LOCATION_MISSING");
  const signedURL = new URL(signedLocation);
  const configuredEndpoint = new URL(process.env.SUPABASE_STORAGE_ENDPOINT);
  check(signedURL.host === configuredEndpoint.host, "SIGNED_HOST_WRONG");
  check(signedURL.searchParams.has("X-Amz-Signature"), "SIGNED_QUERY_MISSING");
  const downloaded = await fetch(signedURL);
  check(downloaded.status === 200, "SIGNED_DOWNLOAD_FAILED");
  check(
    Buffer.from(await downloaded.arrayBuffer()).equals(fixture),
    "SIGNED_DOWNLOAD_CONTENT_WRONG",
  );

  stage = "DISALLOWED_UPLOAD";
  let disallowedRejected = false;
  try {
    await payload.create({
      collection: "order-uploads",
      data: {},
      file: {
        data: Buffer.from("not an image"),
        mimetype: "text/plain",
        name: `${testPrefix}-disallowed.txt`,
        size: 12,
      },
      overrideAccess: false,
      user: admin,
    });
  } catch {
    disallowedRejected = true;
  }
  check(disallowedRejected, "DISALLOWED_UPLOAD_ACCEPTED");
  check((await countUploadRecords(`${testPrefix}-disallowed`)) === 0, "DISALLOWED_RECORD_PERSISTED");
  check((await listObjects(`${testPrefix}-disallowed`)).length === 0, "DISALLOWED_OBJECT_PERSISTED");

  stage = "OVERSIZE_UPLOAD";
  const oversizedForm = new FormData();
  const oversized = new Uint8Array(15 * 1024 * 1024 + 1);
  oversizedForm.append(
    "file",
    new Blob([oversized], { type: "image/png" }),
    `${testPrefix}-oversized.png`,
  );
  oversizedForm.append("_payload", "{}");
  const oversizedStatus = await fetchStatus(collectionPath, {
    body: oversizedForm,
    headers: authenticatedHeaders,
    method: "POST",
  });
  check(oversizedStatus === 413, "OVERSIZE_UPLOAD_NOT_REJECTED");
  check((await countUploadRecords(`${testPrefix}-oversized`)) === 0, "OVERSIZE_RECORD_PERSISTED");
  check((await listObjects(`${testPrefix}-oversized`)).length === 0, "OVERSIZE_OBJECT_PERSISTED");

  stage = "DELETE";
  await payload.delete({
    collection: "order-uploads",
    id: document.id,
    overrideAccess: false,
    user: admin,
  });
  document = undefined;
  check((await countUploadRecords(testPrefix)) === 0, "DELETE_RECORD_REMAINS");
  check((await listObjects(testPrefix)).length === 0, "DELETE_OBJECT_REMAINS");

  stage = "UNCHANGED_DATA";
  const finalCounts = await database.query(
    "SELECT (SELECT count(*)::int FROM public.users) AS users, " +
      "(SELECT count(*)::int FROM public.customers) AS customers, " +
      "(SELECT count(*)::int FROM public.orders) AS orders",
  );
  check(JSON.stringify(finalCounts.rows) === JSON.stringify(existingCounts.rows), "EXISTING_COUNTS_CHANGED");
  const checkoutAfter = await database.query(
    "SELECT * FROM public.checkout_settings ORDER BY id",
  );
  const adminAfter = await database.query(
    "SELECT id, created_at, updated_at FROM public.users ORDER BY id",
  );
  check(JSON.stringify(checkoutAfter.rows) === JSON.stringify(checkoutBefore.rows), "CHECKOUT_SETTINGS_CHANGED");
  check(JSON.stringify(adminAfter.rows) === JSON.stringify(adminBefore.rows), "ADMIN_CHANGED");
  check((await countUploadRecords()) === 0, "FINAL_UPLOAD_RECORDS_NOT_ZERO");
  check((await listObjects()).length === 0, "FINAL_BUCKET_OBJECTS_NOT_ZERO");

  completed = true;
} catch (error) {
  const safeCode =
    error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : "UNEXPECTED_ERROR";
  console.log("LIFECYCLE_RESULT=FAIL");
  console.log(`LIFECYCLE_STAGE=${stage}`);
  console.log(`LIFECYCLE_FAILURE=${safeCode}`);
  if (/^[A-Za-z]+$/.test(error?.name ?? "")) {
    console.log(`ERROR_CLASS=${error.name}`);
  }
  if (/^[A-Z0-9_]+$/.test(error?.code ?? "")) {
    console.log(`ERROR_CODE=${error.code}`);
  }
  if (Array.isArray(authenticationProbeResults)) {
    console.log(
      `AUTH_PROBES=${authenticationProbeResults
        .map(({ authenticated, status }) => `${status}:${authenticated}`)
        .join(",")}`,
    );
  }
  if (Number.isInteger(authenticatedDocumentStatus)) {
    console.log(`AUTHENTICATED_DOCUMENT_STATUS=${authenticatedDocumentStatus}`);
  }
  if (Number.isInteger(signedResponseStatus)) {
    console.log(`SIGNED_RESPONSE_STATUS=${signedResponseStatus}`);
  }
  process.exitCode = 1;
} finally {
  if (payload && document) {
    try {
      await payload.delete({
        collection: "order-uploads",
        id: document.id,
        overrideAccess: true,
      });
      document = undefined;
    } catch {
      cleanupFallbackUsed = true;
    }
  }

  if (database) {
    try {
      const remaining = await countUploadRecords(testPrefix);
      if (remaining > 0) {
        cleanupFallbackUsed = true;
        await database.query(
          "DELETE FROM public.order_uploads WHERE filename LIKE $1",
          [`${testPrefix}%`],
        );
      }
    } catch {
      cleanupFallbackUsed = true;
    }
  }

  if (storage) {
    try {
      const remaining = await listObjects(testPrefix);
      if (remaining.length > 0) {
        cleanupFallbackUsed = true;
        for (const object of remaining) {
          check(object.Key?.startsWith(testPrefix), "CLEANUP_TARGET_UNSAFE");
          await storage.send(
            new DeleteObjectCommand({
              Bucket: process.env.SUPABASE_STORAGE_BUCKET,
              Key: object.Key,
            }),
          );
        }
      }
    } catch {
      cleanupFallbackUsed = true;
    }
  }

  if (database) {
    await settleWithin(database.end());
  }
  if (payload) {
    await settleWithin(payload.destroy());
  }
  storage?.destroy();

  if (cleanupFallbackUsed) {
    console.log("CLEANUP_FALLBACK_USED=true");
    process.exitCode = 1;
  } else if (completed) {
    console.log("LIFECYCLE_RESULT=PASS");
    console.log("ANONYMOUS_CRUD_AND_DOWNLOAD=DENIED");
    console.log("AUTHENTICATED_ADMIN_OPERATIONS=ALLOWED");
    console.log("SIGNED_DOWNLOAD=PASS");
    console.log("DATABASE_ROLES=DENIED");
    console.log("DISALLOWED_UPLOAD=REJECTED_NO_RESIDUE");
    console.log("OVERSIZE_UPLOAD=REJECTED_NO_RESIDUE");
    console.log("FINAL_UPLOAD_RECORD_COUNT=0");
    console.log("FINAL_BUCKET_OBJECT_COUNT=0");
    console.log("EXISTING_DATA_UNCHANGED=true");
    console.log("ROUTES_AND_SCENE_MARKUP=PASS");
  }

  process.exit(process.exitCode ?? 0);
}
