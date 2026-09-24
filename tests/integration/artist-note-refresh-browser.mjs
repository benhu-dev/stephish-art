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
const runId = `unit-2-13-browser-${randomUUID()}`;
const rawNote = `  <b>${runId}</b>\r\n第二行 🎨  `;
const browserDraftNote = rawNote.replaceAll("\r\n", "\n");
const normalizedNote = `<b>${runId}</b>\n第二行 🎨`;
const fixtureAmountCents = 1_913;
const database = new pg.Client({ connectionString: process.env.DATABASE_URL });
let payload;
let baselineCounts;
let intentId;
let uploadId;
let failed = false;
let stage = "INITIALIZE";

const targets = await fetch("http://127.0.0.1:9222/json").then((response) => response.json());
const target = targets.find((item) => item.type === "page");
assert(target, "Open an isolated Chromium page on debugging port 9222 first");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));

let nextId = 0;
const pending = new Map();
const artistNoteRequests = [];
const browserLogs = [];
let uploadRequests = 0;
let checkoutSessionRequests = 0;
let failNextArtistNoteSave = true;

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { reject, resolve });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  if (message.method === "Runtime.exceptionThrown") browserLogs.push("runtime exception");
  if (message.method === "Runtime.consoleAPICalled") {
    browserLogs.push(JSON.stringify(message.params.args ?? []));
  }
  if (message.method === "Log.entryAdded") browserLogs.push(message.params.entry.text ?? "log");
  if (message.method === "Network.requestWillBeSent") {
    const requestURL = new URL(message.params.request.url);
    if (requestURL.pathname.endsWith("/artist-note")) {
      artistNoteRequests.push({ method: message.params.request.method, url: message.params.request.url });
    }
    if (requestURL.pathname.endsWith("/current/uploads") && message.params.request.method === "POST") {
      uploadRequests += 1;
    }
    if (requestURL.pathname.endsWith("/checkout-session")) checkoutSessionRequests += 1;
  }
  if (message.method === "Fetch.requestPaused") {
    const requestURL = new URL(message.params.request.url);
    if (requestURL.pathname.endsWith("/artist-note") && failNextArtistNoteSave) {
      failNextArtistNoteSave = false;
      void send("Fetch.fulfillRequest", {
        body: btoa(JSON.stringify({ error: { code: "SYNTHETIC_FAILURE" } })),
        responseCode: 503,
        responseHeaders: [
          { name: "Cache-Control", value: "no-store" },
          { name: "Content-Type", value: "application/json" },
        ],
        requestId: message.params.requestId,
      });
    } else {
      void send("Fetch.continueRequest", { requestId: message.params.requestId });
    }
  }
  if (message.id) {
    const handler = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) handler.reject(message.error);
    else handler.resolve(message.result);
  }
});

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { awaitPromise: true, expression, returnByValue: true });
  assert(!result.exceptionDetails);
  return result.result.value;
};
const waitFor = async (expression, description, attempts = 180) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await evaluate(expression)) return;
    await delay(50);
  }
  assert.fail(`Timed out waiting for ${description}`);
};
const counts = async () => (await database.query(
  "SELECT (SELECT count(*)::int FROM public.checkout_intents) AS checkout_intents, " +
  "(SELECT count(*)::int FROM public.orders) AS orders",
)).rows[0];

async function loadStorefront(reload = false) {
  if (reload) await send("Page.reload", { ignoreCache: true });
  else await send("Page.navigate", { url: `${baseURL}/?theme=day` });
  await waitFor(
    `document.readyState === "complete" && !!document.querySelector("[data-final-cta] button")`,
    "storefront load",
  );
}
async function openModal() {
  await evaluate(`window.scrollTo(0, document.documentElement.scrollHeight - innerHeight)`);
  await delay(600);
  await waitFor(`!document.querySelector("[data-final-cta] button").disabled`, "enabled final CTA");
  await evaluate(`document.querySelector("[data-final-cta] button").click()`);
  await waitFor(`!!document.querySelector("#checkout-modal-title")`, "modal open");
}
async function saveAmount() {
  await evaluate(`(() => {
    const input = document.querySelector(".amount-custom input");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, "${(fixtureAmountCents / 100).toFixed(2)}");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await waitFor(`!document.querySelector(".continue-button").disabled`, "valid amount");
  await evaluate(`document.querySelector(".continue-button").click()`);
  await waitFor(
    `document.querySelector("#checkout-modal-title")?.textContent === "Add your photos"`,
    "photo step",
  );
}
async function readIntentId() {
  const { cookies } = await send("Network.getCookies", {
    urls: [`${baseURL}/api/storefront/checkout-intents`],
  });
  const cookie = cookies.find(({ name }) => name === CHECKOUT_INTENT_COOKIE_NAME);
  assert(cookie);
  const parsed = parseCheckoutIntentCookie(`${CHECKOUT_INTENT_COOKIE_NAME}=${cookie.value}`);
  assert.equal(parsed.kind, "valid");
  return parsed.credential.intentId;
}
async function setTextarea(value) {
  await evaluate(`(() => {
    const textarea = document.querySelector(".private-note textarea");
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(textarea, ${JSON.stringify(value)});
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
}

try {
  stage = "CONNECT";
  await database.connect();
  const { default: config } = await import("../../src/payload.config.ts");
  payload = await getPayload({ config });
  baselineCounts = await counts();
  console.log(`START_COUNTS=${JSON.stringify(baselineCounts)}`);

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Network.enable");
  await send("Network.clearBrowserCookies");
  await send("Fetch.enable", {
    patterns: [{ requestStage: "Request", urlPattern: "*/api/storefront/checkout-intents/current/artist-note" }],
  });

  stage = "BROWSER_INITIAL_LOAD";
  await loadStorefront();
  stage = "BROWSER_INITIAL_OPEN";
  await openModal();
  stage = "BROWSER_INITIAL_AMOUNT";
  await saveAmount();
  stage = "BROWSER_READ_INTENT_COOKIE";
  intentId = await readIntentId();
  stage = "BROWSER_INSERT_SYNTHETIC_UPLOAD";
  uploadId = Number((await database.query(
    "INSERT INTO public.order_uploads " +
    "(checkout_intent_id, position, filename, mime_type, filesize, width, height) " +
    "VALUES ($1, 1, $2, 'image/png', 68, 1, 1) RETURNING id",
    [intentId, `${runId}.png`],
  )).rows[0].id);

  stage = "FAILED_SAVE_AND_RETRY";
  await loadStorefront(true);
  await openModal();
  await saveAmount();
  stage = "FAILED_SAVE_SET_NOTE";
  await setTextarea(rawNote);
  stage = "FAILED_SAVE_FIRST_CONTINUE";
  await evaluate(`document.querySelector(".continue-button").click()`);
  await waitFor(
    `document.querySelector(".field-error")?.textContent.includes("save your note")`,
    "retryable note error",
  );
  stage = "FAILED_SAVE_PRESERVES_TEXT";
  assert.equal(await evaluate(`document.querySelector(".private-note textarea").value`), browserDraftNote);
  assert.equal(await evaluate(`document.querySelector("#checkout-modal-title").textContent`), "Add your photos");
  stage = "FAILED_SAVE_RETRY_CONTINUE";
  await evaluate(`document.querySelector(".continue-button").click()`);
  await waitFor(
    `document.querySelector("#checkout-modal-title")?.textContent === "Ready for the press?"`,
    "review after retry",
  );
  stage = "FAILED_SAVE_VERIFY_NO_UPLOAD";
  assert.equal(uploadRequests, 0);
  stage = "FAILED_SAVE_VERIFY_REQUEST_COUNT";
  assert.equal(artistNoteRequests.length, 2);
  stage = "FAILED_SAVE_VERIFY_REVIEW_TEXT";
  assert.equal(await evaluate(`document.querySelector(".review-artist-note p").textContent`), normalizedNote);
  stage = "FAILED_SAVE_VERIFY_NO_HTML";
  assert.equal(await evaluate(`document.querySelector(".review-artist-note b") === null`), true);
  stage = "FAILED_SAVE_VERIFY_DATABASE";
  assert.equal((await database.query(
    "SELECT artist_note FROM public.checkout_intents WHERE id = $1",
    [intentId],
  )).rows[0].artist_note, normalizedNote);

  stage = "REFRESH_RESTORE";
  await loadStorefront(true);
  await openModal();
  await saveAmount();
  assert.equal(await evaluate(`document.querySelector(".private-note textarea").value`), normalizedNote);
  await evaluate(`document.querySelector(".continue-button").click()`);
  await waitFor(
    `document.querySelector("#checkout-modal-title")?.textContent === "Ready for the press?"`,
    "review after refresh restore",
  );
  assert.equal(await evaluate(`document.querySelector(".review-artist-note p").textContent`), normalizedNote);

  stage = "EDIT_AND_CLEAR";
  await evaluate(`document.querySelector(".back-button").click()`);
  await setTextarea("");
  await evaluate(`document.querySelector(".continue-button").click()`);
  await waitFor(
    `document.querySelector("#checkout-modal-title")?.textContent === "Ready for the press?"`,
    "review after clear",
  );
  assert.equal(await evaluate(`document.querySelector(".review-artist-note") === null`), true);
  assert.equal((await database.query(
    "SELECT artist_note FROM public.checkout_intents WHERE id = $1",
    [intentId],
  )).rows[0].artist_note, null);

  stage = "PRIVACY_AND_FINAL_CHECKOUT";
  for (const noteRequest of artistNoteRequests) {
    assert.equal(noteRequest.method, "PUT");
    assert.equal(noteRequest.url.includes(runId), false);
    assert.equal(new URL(noteRequest.url).search, "");
  }
  assert.equal(await evaluate(`(() => {
    const values = [...Object.values(localStorage), ...Object.values(sessionStorage)];
    return values.some((value) => String(value).includes(${JSON.stringify(runId)}));
  })()`), false);
  assert.equal(browserLogs.some((entry) => entry.includes(runId)), false);
  await evaluate(`document.querySelector(".secure-checkout-button").click()`);
  await delay(100);
  assert.equal(checkoutSessionRequests, 0);
  assert.equal(uploadRequests, 0);
  console.log("ARTIST_NOTE_BROWSER_SAVE_RETRY_REVIEW=PASS");
  console.log("ARTIST_NOTE_BROWSER_REFRESH_RESTORE=PASS");
  console.log("ARTIST_NOTE_BROWSER_EDIT_CLEAR_TEXT_RENDER=PASS");
  console.log("ARTIST_NOTE_BROWSER_NO_DUPLICATE_UPLOAD_OR_CHECKOUT=PASS");
} catch (error) {
  failed = true;
  console.error(`ARTIST_NOTE_BROWSER_FAILURE_STAGE=${stage}`);
  console.error(`ARTIST_NOTE_BROWSER_ERROR_NAME=${error instanceof Error ? error.name : "UNKNOWN"}`);
  if (error instanceof Error && error.stack) {
    console.error(`ARTIST_NOTE_BROWSER_ERROR_LOCATION=${error.stack.split("\n").slice(1, 3).join(" | ")}`);
  }
  try {
    const diagnostic = await evaluate(`({
      ctaDisabled: document.querySelector("[data-final-cta] button")?.disabled,
      hasDialog: !!document.querySelector("[role=dialog]"),
      title: document.title,
    })`);
    console.error(`ARTIST_NOTE_BROWSER_DIAGNOSTIC=${JSON.stringify(diagnostic)}`);
    console.error(`ARTIST_NOTE_BROWSER_LOG_COUNT=${browserLogs.length}`);
  } catch {}
} finally {
  stage = "CLEANUP_SYNTHETIC_ONLY";
  try {
    await send("Fetch.disable").catch(() => {});
    if (uploadId) await database.query("DELETE FROM public.order_uploads WHERE id = $1", [uploadId]);
    if (payload && intentId) {
      const fixture = (await database.query(
        "SELECT amount_cents::int FROM public.checkout_intents WHERE id = $1",
        [intentId],
      )).rows[0];
      assert.equal(fixture?.amount_cents, fixtureAmountCents);
      await payload.delete({ collection: "checkout-intents", id: intentId, overrideAccess: true });
    }
    await send("Network.clearBrowserCookies");
    const finalCounts = await counts();
    console.log(`FINAL_COUNTS=${JSON.stringify(finalCounts)}`);
    assert.deepEqual(finalCounts, baselineCounts);
    console.log("ARTIST_NOTE_BROWSER_SYNTHETIC_CLEANUP=PASS");
  } catch {
    failed = true;
    console.error("ARTIST_NOTE_BROWSER_SYNTHETIC_CLEANUP=FAIL");
  }
  socket.close();
  await database.end().catch(() => { failed = true; });
  await Promise.race([
    payload?.destroy().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  process.exit(failed ? 1 : 0);
}
