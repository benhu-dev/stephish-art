import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import nextEnvironment from "@next/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { getPayload } from "payload";

import {
  CHECKOUT_INTENT_COOKIE_NAME,
  parseCheckoutIntentCookie,
} from "../../src/server/storefront/checkoutIntentCookie.ts";

const { loadEnvConfig } = nextEnvironment;
loadEnvConfig(fileURLToPath(new URL("../../", import.meta.url)), true, { error() {}, info() {} });

const baseURL = process.argv[2] ?? "http://127.0.0.1:3000";
const origin = new URL(baseURL).origin;
const runId = `unit-2-12-3-${randomUUID()}`;
const fixtureAmountCents = 1817;
const startedAt = new Date();
const database = new pg.Client({ connectionString: process.env.DATABASE_URL });
const storage = new S3Client({
  credentials: {
    accessKeyId: process.env.SUPABASE_STORAGE_ACCESS_KEY_ID,
    secretAccessKey: process.env.SUPABASE_STORAGE_SECRET_ACCESS_KEY,
  },
  endpoint: process.env.SUPABASE_STORAGE_ENDPOINT,
  forcePathStyle: true,
  region: process.env.SUPABASE_STORAGE_REGION,
});

const targets = await fetch("http://127.0.0.1:9222/json").then((response) => response.json());
const target = targets.find((item) => item.type === "page");
assert(target, "Open an isolated Chromium page on debugging port 9222 first");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));

let nextId = 0;
const pending = new Map();
const browserErrors = [];
const previewRequests = [];
let baselineObjects;
let baselineRows;
let connected = false;
let failed = false;
let payload;
let stage = "PREFLIGHT";
let syntheticIntentId;

socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  if (message.method === "Runtime.exceptionThrown") browserErrors.push("runtime");
  if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
    browserErrors.push("log");
  }
  if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
    browserErrors.push("console");
  }
  if (message.method === "Network.requestWillBeSent") {
    const { request, requestId } = message.params;
    const url = new URL(request.url);
    if (/^\/api\/storefront\/checkout-intents\/current\/uploads\/\d+\/preview$/.test(url.pathname)) {
      previewRequests.push({ method: request.method, requestId, url: request.url });
    }
  }
  if (message.method === "Network.responseReceived") {
    const request = previewRequests.find(({ requestId }) => requestId === message.params.requestId);
    if (request) request.response = message.params.response;
  }
  if (message.id) {
    const handlers = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) handlers.reject(message.error);
    else handlers.resolve(message.result);
  }
});

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    awaitPromise: true,
    expression,
    returnByValue: true,
  });
  assert(!result.exceptionDetails);
  return result.result.value;
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(expression, description, attempts = 160) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await evaluate(expression)) return;
    await delay(50);
  }
  assert.fail(`Timed out waiting for ${description}`);
}

async function loadStorefront(reload = false) {
  if (reload) await send("Page.reload", { ignoreCache: true });
  else await send("Page.navigate", { url: `${baseURL}/?theme=day` });
  await delay(250);
  await waitFor(
    `document.readyState === "complete" && !!document.querySelector("[data-final-cta] button")`,
    "the storefront",
  );
}

async function openModal() {
  await evaluate(`window.scrollTo(0, document.documentElement.scrollHeight - innerHeight)`);
  await delay(500);
  await evaluate(`document.querySelector("[data-final-cta] button").click()`);
  await waitFor(`!!document.querySelector("#checkout-modal-title")`, "the checkout modal");
}

async function saveFixtureAmount() {
  await evaluate(`(() => {
    const input = document.querySelector(".amount-custom input");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, "18.17");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await waitFor(`!document.querySelector(".continue-button").disabled`, "a valid amount");
  await evaluate(`document.querySelector(".continue-button").click()`);
  await waitFor(
    `document.querySelector("#checkout-modal-title")?.textContent === "Add your photos"`,
    "the photo step",
  );
}

const rowCounts = async () => (await database.query(
  "SELECT (SELECT count(*)::int FROM public.checkout_intents) AS checkout_intents, " +
    "(SELECT count(*)::int FROM public.order_uploads) AS order_uploads, " +
    "(SELECT count(*)::int FROM public.customers) AS customers, " +
    "(SELECT count(*)::int FROM public.orders) AS orders, " +
    "(SELECT count(*)::int FROM public.stripe_events) AS stripe_events, " +
    "(SELECT count(*)::int FROM public.users) AS users",
)).rows[0];

const objectKeys = async () => {
  const keys = [];
  let continuationToken;
  do {
    const page = await storage.send(new ListObjectsV2Command({
      Bucket: process.env.SUPABASE_STORAGE_BUCKET,
      ContinuationToken: continuationToken,
    }));
    keys.push(...(page.Contents ?? []).map(({ Key }) => Key));
    continuationToken = page.NextContinuationToken;
  } while (continuationToken);
  return keys.sort();
};

async function readSyntheticIntentId() {
  const { cookies } = await send("Network.getCookies", {
    urls: [`${baseURL}/api/storefront/checkout-intents`],
  });
  const cookie = cookies.find(({ name }) => name === CHECKOUT_INTENT_COOKIE_NAME);
  if (!cookie) return undefined;
  const parsed = parseCheckoutIntentCookie(
    `${CHECKOUT_INTENT_COOKIE_NAME}=${encodeURIComponent(cookie.value)}`,
  );
  return parsed.kind === "valid" ? parsed.credential.intentId : undefined;
}

try {
  stage = "CONNECT_DATABASE";
  await database.connect();
  connected = true;
  stage = "LOAD_PAYLOAD";
  const { default: config } = await import("../../src/payload.config.ts");
  payload = await getPayload({ config });
  stage = "READ_STARTING_ROWS";
  baselineRows = await rowCounts();
  stage = "READ_STARTING_STORAGE";
  baselineObjects = await objectKeys();
  console.log(`START_COUNTS=${JSON.stringify({ ...baselineRows, storageObjects: baselineObjects.length })}`);

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Network.enable");
  await send("Network.clearBrowserCookies");

  stage = "CREATE_INTENT_THROUGH_REAL_UI";
  await loadStorefront();
  await openModal();
  await saveFixtureAmount();
  syntheticIntentId = await readSyntheticIntentId();
  assert.equal(Number.isInteger(syntheticIntentId), true);

  stage = "UPLOAD_UNIQUE_IMAGE_THROUGH_REAL_UI";
  await evaluate(`(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 41;
    canvas.height = 31;
    const context = canvas.getContext("2d");
    context.fillStyle = "#3b657a";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#f7dca3";
    context.font = "5px sans-serif";
    context.fillText(${JSON.stringify(runId)}, 1, 16);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], ${JSON.stringify(`${runId}.png`)}, { type: "image/png" }));
    const input = document.querySelector("input[type=file]");
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await waitFor(
    `[...document.querySelectorAll(".photo-preview-list img")]
      .some((image) => image.complete && image.naturalWidth === 41 && image.naturalHeight === 31)`,
    "the local synthetic preview",
  );
  await evaluate(`document.querySelector(".continue-button").click()`);
  await waitFor(
    `document.querySelector("#checkout-modal-title")?.textContent === "Ready for the press?"`,
    "the uploaded photo review",
  );

  const fixtureRows = (await database.query(
    "SELECT id, filename FROM public.order_uploads WHERE checkout_intent_id = $1",
    [syntheticIntentId],
  )).rows;
  assert.equal(fixtureRows.length, 1);
  const afterUploadObjects = await objectKeys();
  assert.equal(afterUploadObjects.length, baselineObjects.length + 1);
  assert.equal(afterUploadObjects.includes(fixtureRows[0].filename), true);
  const afterUploadRows = await rowCounts();
  assert.equal(afterUploadRows.checkout_intents, baselineRows.checkout_intents + 1);
  assert.equal(afterUploadRows.order_uploads, baselineRows.order_uploads + 1);
  console.log("PASS_REAL_UI_UPLOAD_PERSISTED_PRIVATELY");

  stage = "FULL_REFRESH_AND_INTENT_RESUME";
  previewRequests.length = 0;
  browserErrors.length = 0;
  await loadStorefront(true);
  await openModal();
  await saveFixtureAmount();
  await waitFor(
    `[...document.querySelectorAll(".photo-preview-list img")]
      .some((image) => image.complete && image.naturalWidth === 41 && image.naturalHeight === 31)`,
    "the restored private image",
  );
  await delay(150);

  assert.equal(previewRequests.length, 1);
  const preview = previewRequests[0];
  assert.equal(preview.method, "GET");
  const previewURL = new URL(preview.url);
  assert.equal(previewURL.origin, origin);
  assert.match(
    previewURL.pathname,
    /^\/api\/storefront\/checkout-intents\/current\/uploads\/\d+\/preview$/,
  );
  assert.equal(previewURL.search, "");
  assert.equal(preview.response?.status, 200);
  assert.equal(preview.response?.mimeType, "image/png");
  const headers = Object.fromEntries(Object.entries(preview.response?.headers ?? {})
    .map(([name, value]) => [name.toLowerCase(), String(value)]));
  assert.equal(headers["content-type"], "image/png");
  assert.equal(headers["content-disposition"], "inline");
  assert.equal(headers["cache-control"], "private, no-store, max-age=0");
  assert.equal(headers.pragma, "no-cache");
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["cross-origin-resource-policy"], "same-origin");
  assert.equal(headers.location, undefined);
  assert.equal(headers["access-control-allow-origin"], undefined);
  assert.equal(await evaluate(`document.querySelectorAll(".uploaded-photo-placeholder").length`), 0);
  assert.equal(await evaluate(`(() => {
    const image = document.querySelector(".photo-preview-list img");
    return image.complete && image.naturalWidth === 41 && image.naturalHeight === 31;
  })()`), true);
  assert.equal(await evaluate(`(() => {
    const visible = (document.querySelector("[role=dialog]").textContent + location.href).toLowerCase();
    return ["supabase", "signed", "bucket", "filename", "access token", "token hash", "storage key", "credential"]
      .some((term) => visible.includes(term));
  })()`), false);
  assert.doesNotMatch(
    `${preview.url}${JSON.stringify(headers)}`,
    /supabase|signed|bucket|filename|access[_ -]?token|token[_ -]?hash|storage[_ -]?key|credential/i,
  );
  assert.equal(browserErrors.length, 0);
  console.log("PASS_REAL_REFRESH_SENT_ONE_PROTECTED_PREVIEW_REQUEST");
  console.log("PASS_PREVIEW_200_PRIVATE_HEADERS_AND_NONZERO_IMAGE");

  stage = "REVIEW_RESTORED_PREVIEW";
  await evaluate(`document.querySelector(".continue-button").click()`);
  await waitFor(
    `document.querySelector("#checkout-modal-title")?.textContent === "Ready for the press?"`,
    "review after restored preview",
  );
  assert.equal(await evaluate(`(() => {
    const image = document.querySelector(".review-photos img");
    return image?.complete && image.naturalWidth === 41 && image.naturalHeight === 31;
  })()`), true);
  console.log("PASS_REVIEW_REUSES_RESTORED_PRIVATE_PREVIEW");

  stage = "REMOVE_SYNTHETIC_THROUGH_REAL_UI";
  await evaluate(`document.querySelector(".back-button").click()`);
  await evaluate(`[...document.querySelectorAll(".photo-preview-list li button")]
    .find((button) => button.textContent === "Remove").click()`);
  await waitFor(`document.querySelectorAll(".photo-preview-list li").length === 0`, "photo removal");
  assert.deepEqual(await objectKeys(), baselineObjects);
  console.log("PASS_REAL_UI_REMOVE_REVOKED_PRIVATE_OBJECT");
} catch {
  failed = true;
  console.error(`BROWSER_REFRESH_FAILED_AT=${stage}`);
} finally {
  stage = "CLEANUP_SYNTHETIC_ONLY";
  try {
    syntheticIntentId ??= await readSyntheticIntentId();
    if (payload && syntheticIntentId) {
      const row = (await database.query(
        "SELECT amount_cents, created_at FROM public.checkout_intents WHERE id = $1",
        [syntheticIntentId],
      )).rows[0];
      const safeFixture = Number(row?.amount_cents) === fixtureAmountCents &&
        new Date(row.created_at).getTime() >= startedAt.getTime() - 5_000;
      assert.equal(safeFixture, true);
      const uploads = await payload.find({
        collection: "order-uploads",
        depth: 0,
        limit: 3,
        overrideAccess: true,
        pagination: false,
        where: { checkoutIntent: { equals: syntheticIntentId } },
      });
      for (const upload of uploads.docs) {
        await payload.delete({ collection: "order-uploads", id: upload.id, overrideAccess: true });
      }
      await payload.delete({
        collection: "checkout-intents",
        id: syntheticIntentId,
        overrideAccess: true,
      });
    }
    await send("Network.clearBrowserCookies");
  } catch {
    failed = true;
    console.error("SYNTHETIC_BROWSER_CLEANUP_FAILED");
  }

  try {
    if (baselineRows && baselineObjects) {
      const finalRows = await rowCounts();
      const finalObjects = await objectKeys();
      console.log(`FINAL_COUNTS=${JSON.stringify({ ...finalRows, storageObjects: finalObjects.length })}`);
      assert.deepEqual(finalRows, baselineRows);
      assert.deepEqual(finalObjects, baselineObjects);
      console.log("PASS_BROWSER_BASELINE_RESTORED_EXACTLY");
    }
  } catch {
    failed = true;
    console.error("BROWSER_BASELINE_RESTORATION_FAILED");
  }

  socket.close();
  if (connected) await database.end().catch(() => { failed = true; });
  storage.destroy();
  await Promise.race([
    payload?.destroy().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  process.exit(failed ? 1 : 0);
}
