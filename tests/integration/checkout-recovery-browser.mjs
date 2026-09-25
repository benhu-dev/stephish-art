import assert from "node:assert/strict";

const baseURL = process.argv[2] ?? "http://127.0.0.1:3000";
const hostedURL = "https://checkout.stripe.com/c/pay/cs_test_recovery_capture";
const expiresAt = "2026-09-26T20:00:00.000Z";
const currentRequests = [];
const amountRequests = [];
const sessionRequests = [];
const abandonRequests = [];
const externalNavigations = [];
const heldSessionRequests = [];
const browserLogs = [];

const safeState = (status) => ({
  amountCents: 900,
  artistNote: "",
  expiresAt,
  limits: {
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    maxFileBytes: 15 * 1024 * 1024,
    maxFiles: 3,
    maxTotalBytes: 30 * 1024 * 1024,
    minimumAmountCents: 500,
  },
  ...(status === "draft" ? {} : { shippingAmountCents: 100, totalAmountCents: 1000 }),
  status,
  uploads: [],
});

const targets = await fetch("http://127.0.0.1:9222/json").then((response) => response.json());
const target = targets.find(({ type }) => type === "page");
assert(target, "Open an isolated Chromium page on debugging port 9222 first");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));

let nextId = 0;
const pendingCommands = new Map();
const jsonHeaders = [
  { name: "Cache-Control", value: "no-store" },
  { name: "Content-Type", value: "application/json" },
];
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pendingCommands.set(id, { reject, resolve });
  socket.send(JSON.stringify({ id, method, params }));
});
const fulfill = (requestId, responseCode, body) => send("Fetch.fulfillRequest", {
  ...(body === undefined ? {} : { body: Buffer.from(JSON.stringify(body)).toString("base64") }),
  requestId,
  responseCode,
  responseHeaders: jsonHeaders,
});

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
    } else if (url.pathname === "/api/storefront/checkout-intents/current" && request.method === "GET") {
      currentRequests.push(request);
      void fulfill(requestId, 200, safeState("checkout_created"));
    } else if (url.pathname.endsWith("/checkout-session")) {
      sessionRequests.push(request);
      heldSessionRequests.push(requestId);
    } else if (url.pathname.endsWith("/abandon")) {
      abandonRequests.push(request);
      if (abandonRequests.length === 1) {
        void fulfill(requestId, 503, { error: { code: "SYNTHETIC_FAILURE" } });
      } else {
        void fulfill(requestId, 204);
      }
    } else if (url.pathname === "/api/storefront/checkout-intents" && request.method === "POST") {
      amountRequests.push(request);
      void fulfill(requestId, 201, safeState("draft"));
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
const loadStorefront = async () => {
  await send("Page.navigate", { url: `${baseURL}/?theme=day` });
  await waitFor(
    'document.readyState === "complete" && !!document.querySelector("[data-final-cta] button")',
    "storefront",
  );
};
const openModal = async () => {
  await evaluate("window.scrollTo(0, document.documentElement.scrollHeight - innerHeight)");
  await delay(450);
  await waitFor('!document.querySelector("[data-final-cta] button").disabled', "final CTA");
  await evaluate('document.querySelector("[data-final-cta] button").click()');
  await waitFor(
    'document.querySelector("#checkout-modal-title")?.textContent === "Your checkout is ready"',
    "recovery view",
  );
};

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [
    { requestStage: "Request", urlPattern: "*/api/storefront/checkout-intents" },
    { requestStage: "Request", urlPattern: "*/api/storefront/checkout-intents/current" },
    { requestStage: "Request", urlPattern: "*/api/storefront/checkout-intents/current/checkout-session" },
    { requestStage: "Request", urlPattern: "*/api/storefront/checkout-intents/current/abandon" },
    { requestStage: "Request", urlPattern: "https://checkout.stripe.com/*" },
  ] });

  await loadStorefront();
  await openModal();
  assert.equal(currentRequests.length, 1);
  assert.equal(await evaluate('document.querySelector(".amount-custom") === null'), true);

  await evaluate(`(() => {
    const button = [...document.querySelectorAll("button")]
      .find((candidate) => candidate.textContent === "Resume Secure Checkout");
    button.click();
    button.click();
  })()`);
  for (let attempt = 0; attempt < 100 && sessionRequests.length < 1; attempt += 1) await delay(25);
  assert.equal(sessionRequests.length, 1);
  assert.equal(sessionRequests[0].postData, "{}");
  assert.equal(await evaluate('[...document.querySelectorAll("button")].some((button) => button.textContent.includes("Opening secure checkout") && button.disabled)'), true);
  await fulfill(heldSessionRequests.shift(), 503, { error: { code: "SYNTHETIC_FAILURE" } });
  await waitFor(
    'document.querySelector("[role=alert]")?.textContent.includes("try again")',
    "resume failure",
  );
  await evaluate('[...document.querySelectorAll("button")].find((button) => button.textContent === "Resume Secure Checkout").click()');
  for (let attempt = 0; attempt < 100 && sessionRequests.length < 2; attempt += 1) await delay(25);
  await fulfill(heldSessionRequests.shift(), 200, { checkoutUrl: hostedURL, expiresAt });
  for (let attempt = 0; attempt < 100 && externalNavigations.length < 1; attempt += 1) await delay(25);
  assert.equal(externalNavigations.length, 1);

  await loadStorefront();
  await openModal();
  await evaluate('[...document.querySelectorAll("button")].find((button) => button.textContent === "Start a New Order").click()');
  assert.equal(abandonRequests.length, 0);
  assert.equal(await evaluate('document.querySelector("[role=dialog]").textContent.includes("Starting over will close this payment session")'), true);
  await evaluate('[...document.querySelectorAll("button")].find((button) => button.textContent === "Confirm Start Over").click()');
  await waitFor(
    'document.querySelector("[role=alert]")?.textContent.includes("try again")',
    "abandon failure",
  );
  assert.equal(abandonRequests.length, 1);
  await evaluate('[...document.querySelectorAll("button")].find((button) => button.textContent === "Confirm Start Over").click()');
  await waitFor(
    'document.querySelector("#checkout-modal-title")?.textContent === "Choose your amount"',
    "fresh Amount step",
  );
  assert.equal(abandonRequests.length, 2);
  assert.equal(amountRequests.length, 0);
  assert.equal(await evaluate(`(() => {
    const dialog = document.querySelector("[role=dialog]");
    return !dialog.querySelector(".photo-preview-list") && !dialog.querySelector(".private-note") && !dialog.querySelector(".review-step");
  })()`), true);

  await evaluate('document.querySelector(".amount-preset").click()');
  await evaluate('document.querySelector(".continue-button").click()');
  await waitFor(
    'document.querySelector("#checkout-modal-title")?.textContent === "Add your photos"',
    "new Intent after amount submission",
  );
  assert.equal(amountRequests.length, 1);
  assert.equal(await evaluate(`(() => {
    const values = [...Object.values(localStorage), ...Object.values(sessionStorage)];
    return values.some((value) => /checkout\.stripe\.com|cs_test/i.test(String(value)));
  })()`), false);
  assert.equal(browserLogs.some((entry) => /checkout\.stripe\.com|cs_test/i.test(entry)), false);

  console.log("CHECKOUT_RECOVERY_BROWSER_HYDRATION=PASS");
  console.log("CHECKOUT_RECOVERY_BROWSER_RESUME_SINGLE_FLIGHT=PASS");
  console.log("CHECKOUT_RECOVERY_BROWSER_INLINE_CONFIRMATION_RETRY=PASS");
  console.log("CHECKOUT_RECOVERY_BROWSER_RESET_THEN_NEW_INTENT=PASS");
} finally {
  await send("Fetch.disable").catch(() => {});
  socket.close();
}
