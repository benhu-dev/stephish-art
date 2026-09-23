// Run against the app with a Chromium page on debugging port 9222.
import assert from "node:assert/strict";

const targets = await fetch("http://127.0.0.1:9222/json").then((response) => response.json());
const target = targets.find((item) => item.type === "page");
assert(target, "Open a Chromium page with --remote-debugging-port=9222 first");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
let nextId = 0;
const pending = new Map();
const errors = [];

socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails);
  if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
    errors.push(message.params.entry);
  }
  if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
    errors.push(message.params.args);
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
  assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(expression, description) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await evaluate(expression)) return;
    await delay(50);
  }
  assert.fail(`Timed out waiting for ${description}`);
}

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.navigate", { url: "http://127.0.0.1:3000/?theme=day" });
  await waitFor(
    `document.readyState === "complete" && !!document.querySelector("[data-final-cta]")`,
    "the mounted checkout component",
  );
  await delay(250);
  errors.length = 0;

  await evaluate(`(() => {
    const png = Uint8Array.from(
      atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="),
      (value) => value.charCodeAt(0),
    );
    window.__hydrationRequests = [];
    window.__resolveHydratedPreview = null;
    const state = {
      amountCents: 1000,
      expiresAt: "2026-09-24T12:00:00.000Z",
      limits: {
        allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
        maxFileBytes: 15 * 1024 * 1024,
        maxFiles: 3,
        maxTotalBytes: 30 * 1024 * 1024,
        minimumAmountCents: 500,
      },
      status: "draft",
      uploads: [{ id: 2123001, position: 1, mimeType: "image/png", sizeBytes: png.byteLength }],
    };
    window.fetch = (url, options = {}) => {
      const request = {
        cache: options.cache,
        credentials: options.credentials,
        method: options.method,
        url: String(url),
      };
      window.__hydrationRequests.push(request);
      if (request.url === "/api/storefront/checkout-intents") {
        return Promise.resolve(new Response(JSON.stringify(state), {
          headers: { "content-type": "application/json" },
          status: 200,
        }));
      }
      if (request.url.endsWith("/2123001/preview")) {
        return new Promise((resolve) => {
          window.__resolveHydratedPreview = () => resolve(new Response(png, {
            headers: {
              "content-length": String(png.byteLength),
              "content-type": "image/png",
            },
          }));
        });
      }
      return Promise.resolve(new Response(null, { status: 500 }));
    };
  })()`);

  await evaluate(`window.scrollTo(0, document.documentElement.scrollHeight - innerHeight)`);
  await delay(450);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await evaluate(`document.querySelector("[data-final-cta] button").click()`);
    if (await evaluate(`!!document.querySelector("#checkout-modal-title")`)) break;
    await delay(100);
  }
  assert.equal(await evaluate(`!!document.querySelector("#checkout-modal-title")`), true);
  assert.equal(await evaluate(`document.querySelectorAll(".photo-preview-list li").length`), 0);

  await evaluate(`[...document.querySelectorAll(".amount-preset")]
    .find((node) => node.textContent.trim() === "$10").click()`);
  await evaluate(`document.querySelector(".continue-button").click()`);
  await waitFor(
    `document.querySelector("#checkout-modal-title")?.textContent === "Add your photos"`,
    "confirmed uploads to hydrate asynchronously",
  );

  const previewRequests = await evaluate(`window.__hydrationRequests.filter(
    (request) => request.url.endsWith("/2123001/preview"),
  )`);
  assert.deepEqual(previewRequests, [{
    cache: "no-store",
    credentials: "same-origin",
    method: "GET",
    url: "/api/storefront/checkout-intents/current/uploads/2123001/preview",
  }]);
  assert.equal(
    await evaluate(`document.querySelectorAll(".uploaded-photo-placeholder").length`),
    1,
  );
  assert.equal(await evaluate(`document.querySelectorAll(".photo-preview-list img").length`), 0);

  await evaluate(`window.__resolveHydratedPreview()`);
  await waitFor(
    `[...document.querySelectorAll(".photo-preview-list img")]
      .some((image) => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0)`,
    "a decoded restored preview image",
  );
  await evaluate(`(() => {
    const textarea = document.querySelector("textarea");
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(textarea, "rerender");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await waitFor(`document.querySelector("textarea").value === "rerender"`, "an unrelated rerender");
  await delay(100);
  assert.equal(await evaluate(`window.__hydrationRequests.filter(
    (request) => request.url.endsWith("/2123001/preview"),
  ).length`), 1);
  await evaluate(`document.querySelector(".continue-button").click()`);
  await waitFor(
    `document.querySelector("#checkout-modal-title")?.textContent === "Ready for the press?"`,
    "the review step",
  );
  assert.equal(await evaluate(`(() => {
    const image = document.querySelector(".review-photos img");
    return image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
  })()`), true);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log("PASS late confirmed upload hydration requests and renders one private preview");
} catch (error) {
  console.error(JSON.stringify({
    browserErrors: errors,
    page: await evaluate(`({
      body: document.body.innerText.slice(-600),
      buttonDisabled: document.querySelector("[data-final-cta] button")?.disabled,
      url: location.href,
    })`),
  }));
  throw error;
} finally {
  socket.close();
}
