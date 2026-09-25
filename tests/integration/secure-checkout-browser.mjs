import assert from "node:assert/strict";

const baseURL = process.argv[2] ?? "http://127.0.0.1:3000";
const checkoutURL = "https://checkout.stripe.com/c/pay/cs_test_unit_2_14";
const expiresAt = "2026-09-26T20:00:00.000Z";
const browserLogs = [];
const checkoutRequests = [];
const externalNavigations = [];
const pendingCheckoutRequests = [];

const targets = await fetch("http://127.0.0.1:9222/json").then((response) => response.json());
const target = targets.find((item) => item.type === "page");
assert(target, "Open an isolated Chromium page on debugging port 9222 first");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));

let nextId = 0;
const pendingCommands = new Map();
const responseHeaders = [
  { name: "Cache-Control", value: "no-store" },
  { name: "Content-Type", value: "application/json" },
];
const encodeJson = (value) => Buffer.from(JSON.stringify(value)).toString("base64");

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pendingCommands.set(id, { reject, resolve });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

function fulfill(requestId, responseCode, body) {
  return send("Fetch.fulfillRequest", {
    body: encodeJson(body),
    requestId,
    responseCode,
    responseHeaders,
  });
}

socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  if (message.method === "Runtime.consoleAPICalled") {
    browserLogs.push(JSON.stringify(message.params.args ?? []));
  }
  if (message.method === "Fetch.requestPaused") {
    const { request, requestId } = message.params;
    const url = new URL(request.url);
    if (url.hostname === "checkout.stripe.com") {
      externalNavigations.push(request.url);
      void send("Fetch.failRequest", { errorReason: "Aborted", requestId });
    } else if (url.pathname === "/api/storefront/checkout-intents" && request.method === "POST") {
      void fulfill(requestId, 201, {
        amountCents: 1914,
        artistNote: "Keep the skyline bright.",
        expiresAt,
        limits: {
          allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
          maxFileBytes: 15 * 1024 * 1024,
          maxFiles: 3,
          maxTotalBytes: 30 * 1024 * 1024,
          minimumAmountCents: 500,
        },
        status: "draft",
        uploads: [{ id: 214, mimeType: "image/png", position: 1, sizeBytes: 68 }],
      });
    } else if (url.pathname.endsWith("/artist-note")) {
      void fulfill(requestId, 200, { artistNote: "Keep the skyline bright." });
    } else if (/\/uploads\/214\/preview$/.test(url.pathname)) {
      void fulfill(requestId, 404, { error: { code: "UPLOAD_NOT_FOUND" } });
    } else if (url.pathname.endsWith("/checkout-session")) {
      checkoutRequests.push(request);
      pendingCheckoutRequests.push(requestId);
    } else {
      void send("Fetch.continueRequest", { requestId });
    }
  }
  if (message.id) {
    const handlers = pendingCommands.get(message.id);
    pendingCommands.delete(message.id);
    if (!handlers) return;
    if (message.error) handlers.reject(message.error);
    else handlers.resolve(message.result);
  }
});

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", {
    awaitPromise: true,
    expression,
    returnByValue: true,
  });
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

async function openModal() {
  await evaluate("window.scrollTo(0, document.documentElement.scrollHeight - innerHeight)");
  await delay(500);
  await waitFor('!document.querySelector("[data-final-cta] button").disabled', "enabled final CTA");
  await evaluate('document.querySelector("[data-final-cta] button").click()');
  await waitFor('!!document.querySelector("#checkout-modal-title")', "checkout modal");
}

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Fetch.enable", { patterns: [
    { requestStage: "Request", urlPattern: "*/api/storefront/checkout-intents" },
    { requestStage: "Request", urlPattern: "*/api/storefront/checkout-intents/current/artist-note" },
    { requestStage: "Request", urlPattern: "*/api/storefront/checkout-intents/current/uploads/*/preview" },
    { requestStage: "Request", urlPattern: "*/api/storefront/checkout-intents/current/checkout-session" },
    { requestStage: "Request", urlPattern: "https://checkout.stripe.com/*" },
  ] });

  await send("Page.navigate", { url: `${baseURL}/?theme=day` });
  await waitFor(
    'document.readyState === "complete" && !!document.querySelector("[data-final-cta] button")',
    "storefront",
  );
  await openModal();
  await evaluate(`(() => {
    const input = document.querySelector(".amount-custom input");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, "19.14");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await waitFor('!document.querySelector(".continue-button").disabled', "valid amount");
  await evaluate('document.querySelector(".continue-button").click()');
  await waitFor(
    'document.querySelector("#checkout-modal-title")?.textContent === "Add your photos"',
    "photo step",
  );
  await evaluate('document.querySelector(".continue-button").click()');
  await waitFor(
    'document.querySelector("#checkout-modal-title")?.textContent === "Ready for the press?"',
    "Review step",
  );

  await evaluate(`(() => {
    const button = document.querySelector(".secure-checkout-button");
    button.click();
    button.click();
  })()`);
  await waitFor(
    'document.querySelector(".secure-checkout-button")?.disabled && document.querySelector(".secure-checkout-button")?.textContent.includes("Opening secure checkout")',
    "single pending secure checkout",
  );
  assert.equal(checkoutRequests.length, 1);
  assert.equal(checkoutRequests[0].method, "POST");
  assert.equal(checkoutRequests[0].postData, "{}");
  const headers = Object.fromEntries(Object.entries(checkoutRequests[0].headers)
    .map(([name, value]) => [name.toLowerCase(), value]));
  assert.equal(headers.accept, "application/json");
  assert.equal(headers["cache-control"], "no-store");
  assert.equal(headers["content-type"], "application/json");

  await fulfill(pendingCheckoutRequests.shift(), 503, { error: { code: "SYNTHETIC_FAILURE" } });
  await waitFor(
    'document.querySelector("#checkout-session-error")?.textContent.includes("try again") && !document.querySelector(".secure-checkout-button").disabled',
    "retryable safe error",
  );
  assert.equal(await evaluate(`(() => {
    const review = document.querySelector(".review-step").textContent;
    return review.includes("$19.14") && review.includes("1 photo") && review.includes("Keep the skyline bright.");
  })()`), true);
  await evaluate('document.querySelector(".back-button").click()');
  assert.equal(await evaluate('document.querySelector(".private-note textarea").value'), "Keep the skyline bright.");
  await evaluate('document.querySelector(".continue-button").click()');
  await waitFor(
    'document.querySelector("#checkout-modal-title")?.textContent === "Ready for the press?"',
    "Review after edit path",
  );

  await evaluate('document.querySelector(".secure-checkout-button").click()');
  for (let attempt = 0; attempt < 100 && checkoutRequests.length < 2; attempt += 1) await delay(25);
  assert.equal(checkoutRequests.length, 2);
  await evaluate('document.querySelector(".modal-close").click()');
  await waitFor('!document.querySelector("[role=dialog]")', "closed modal");
  await fulfill(pendingCheckoutRequests.shift(), 201, { checkoutUrl: checkoutURL, expiresAt }).catch(() => {});
  await delay(150);
  assert.equal(externalNavigations.length, 0);

  await openModal();
  assert.equal(await evaluate('document.querySelector("#checkout-modal-title").textContent'), "Ready for the press?");
  assert.equal(await evaluate(`(() => {
    const values = [...Object.values(localStorage), ...Object.values(sessionStorage)];
    const visible = document.querySelector("[role=dialog]").textContent + location.href;
    return [...values, visible].some((value) => /checkout\.stripe\.com|cs_test/i.test(String(value)));
  })()`), false);
  await evaluate('document.querySelector(".secure-checkout-button").click()');
  for (let attempt = 0; attempt < 100 && checkoutRequests.length < 3; attempt += 1) await delay(25);
  assert.equal(checkoutRequests.length, 3);
  await fulfill(pendingCheckoutRequests.shift(), 200, { checkoutUrl: checkoutURL, expiresAt });
  for (let attempt = 0; attempt < 100 && externalNavigations.length < 1; attempt += 1) await delay(25);
  assert.equal(externalNavigations.length, 1);
  assert.equal(browserLogs.some((entry) => /checkout\.stripe\.com|cs_test/i.test(entry)), false);

  console.log("SECURE_CHECKOUT_BROWSER_PENDING_SINGLE_FLIGHT=PASS");
  console.log("SECURE_CHECKOUT_BROWSER_FAILURE_RETRY_DRAFT=PASS");
  console.log("SECURE_CHECKOUT_BROWSER_CLOSE_ABORT=PASS");
  console.log("SECURE_CHECKOUT_BROWSER_REDIRECT_CAPTURE=PASS");
} finally {
  await send("Fetch.disable").catch(() => {});
  socket.close();
}
