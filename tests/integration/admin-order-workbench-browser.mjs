import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import nextEnvironment from "@next/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { getPayload, jwtSign } from "payload";

import { issueCheckoutIntentCredential } from "../../src/server/checkout-intents/checkoutIntentCredentials.ts";

const { loadEnvConfig } = nextEnvironment;
const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
loadEnvConfig(projectRoot, true, { error() {}, info() {} });

const baseURL = process.argv[2] ?? "http://127.0.0.1:3000";
const debugURL = process.argv[3] ?? "http://127.0.0.1:9223";
const runId = `unit-2-21-${randomUUID()}`;
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
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

let payload;
let socket;
let baselineCounts;
let baselineObjects;
let customerId;
let intentId;
let orderId;
let uploadId;
let failed = false;
let stage = "PREFLIGHT";

const counts = async () => (
  await database.query(
    "SELECT " +
      "(SELECT count(*)::int FROM public.checkout_intents) AS checkout_intents, " +
      "(SELECT count(*)::int FROM public.order_uploads) AS order_uploads, " +
      "(SELECT count(*)::int FROM public.customers) AS customers, " +
      "(SELECT count(*)::int FROM public.orders) AS orders, " +
      "(SELECT count(*)::int FROM public.email_outbox) AS email_outbox, " +
      "(SELECT count(*)::int FROM public.stripe_events) AS stripe_events"
  )
).rows[0];

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

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

try {
  stage = "CONNECT";
  await database.connect();
  const { default: config } = await import("../../src/payload.config.ts");
  payload = await getPayload({ config });
  baselineCounts = await counts();
  baselineObjects = await objectKeys();
  console.log(`START_COUNTS=${JSON.stringify({
    ...baselineCounts,
    storageObjects: baselineObjects.length,
  })}`);

  stage = "CREATE_FIXTURE";
  const now = new Date();
  const displayCreatedAt = new Date("2026-01-15T14:30:00.000Z");
  const stripeSessionId = `cs_test_${runId}`;
  const intent = await payload.create({
    collection: "checkout-intents",
    data: {
      ...issueCheckoutIntentCredential(now).createData,
      amountCents: 1500,
      artistNote: '<img src=x onerror="window.__hostile=true"> & plain text',
      checkoutAttemptId: randomUUID(),
      checkoutStartedAt: now.toISOString(),
      shippingAmountCents: 100,
      status: "completed",
      stripeCheckoutSessionExpiresAt: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
      stripeCheckoutSessionId: stripeSessionId,
      totalAmountCents: 1600,
    },
    depth: 0,
    overrideAccess: true,
  });
  intentId = Number(intent.id);
  const customer = await payload.create({
    collection: "customers",
    data: {
      email: `${runId}@example.invalid`,
      fullName: "Customer <b>Literal</b>",
      stripeCustomerId: `cus_${runId}`,
    },
    depth: 0,
    overrideAccess: true,
  });
  customerId = Number(customer.id);
  const order = await payload.create({
    collection: "orders",
    data: {
      amountCents: 1600,
      artistNote: intent.artistNote,
      checkoutIntent: intent.id,
      contactEmail: customer.email,
      currency: "usd",
      customer: customer.id,
      orderStatus: "unfulfilled",
      paidAt: now.toISOString(),
      paymentStatus: "paid",
      refundedAmountCents: 0,
      refundState: "none",
      shippingAddress: {
        city: "New York",
        country: "US",
        line1: "1 <Main> Street",
        postalCode: "10001",
        recipientName: "A <script>Literal</script>",
        state: "NY",
      },
      stripeCheckoutSessionId: stripeSessionId,
      stripePaymentIntentId: `pi_test_${runId}`,
    },
    depth: 0,
    overrideAccess: true,
  });
  orderId = Number(order.id);
  await database.query("UPDATE public.orders SET created_at = $1 WHERE id = $2", [
    displayCreatedAt,
    orderId,
  ]);
  const upload = await payload.create({
    collection: "order-uploads",
    data: { checkoutIntent: intent.id, order: order.id, position: 1 },
    depth: 0,
    file: {
      data: image,
      mimetype: "image/png",
      name: `${runId}.png`,
      size: image.length,
    },
    overrideAccess: true,
  });
  uploadId = Number(upload.id);
  assert.deepEqual(await counts(), {
    ...baselineCounts,
    checkout_intents: baselineCounts.checkout_intents + 1,
    customers: baselineCounts.customers + 1,
    order_uploads: baselineCounts.order_uploads + 1,
    orders: baselineCounts.orders + 1,
  });
  assert.deepEqual(await objectKeys(), [...baselineObjects, upload.filename].sort());

  stage = "AUTH";
  const admins = await payload.find({
    collection: "users",
    limit: 2,
    overrideAccess: true,
    showHiddenFields: true,
  });
  assert.equal(admins.docs.length, 1);
  const admin = admins.docs[0];
  assert(admin.sessions?.[0]?.id);
  const { token } = await jwtSign({
    fieldsToSign: {
      collection: "users",
      id: admin.id,
      sid: admin.sessions[0].id,
    },
    secret: payload.secret,
    tokenExpiration: payload.collections.users.config.auth.tokenExpiration,
  });

  stage = "BROWSER_CONNECT";
  const targets = await fetch(`${debugURL}/json`).then((response) => response.json());
  const target = targets.find((item) => item.type === "page");
  assert(target, "Open an isolated Chromium page on the requested debugging port");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
  let nextId = 0;
  const pending = new Map();
  const browserErrors = [];
  const fulfillmentCalls = [];
  const attempts = new Map();
  let interceptionFailure;

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { reject, resolve });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      awaitPromise: true,
      expression,
      returnByValue: true,
    });
    assert(!result.exceptionDetails);
    return result.result.value;
  };
  const waitFor = async (expression, description, attemptsCount = 200) => {
    for (let attempt = 0; attempt < attemptsCount; attempt += 1) {
      if (interceptionFailure) throw interceptionFailure;
      if (await evaluate(expression)) return;
      await delay(50);
    }
    assert.fail(`Timed out waiting for ${description}`);
  };
  const respond = (requestId, status, body) => send("Fetch.fulfillRequest", {
    body: Buffer.from(JSON.stringify(body)).toString("base64"),
    requestId,
    responseCode: status,
    responseHeaders: [
      { name: "Cache-Control", value: "no-store" },
      { name: "Content-Type", value: "application/json" },
    ],
  });
  const handleFulfillment = async ({ request, requestId }) => {
    const body = JSON.parse(request.postData);
    fulfillmentCalls.push(body);
    const attempt = (attempts.get(body.requestedNextState) ?? 0) + 1;
    attempts.set(body.requestedNextState, attempt);
    if (body.requestedNextState === "ready_to_ship" && attempt === 1) {
      await respond(requestId, 500, { error: { code: "INTERNAL_ERROR" } });
      return;
    }
    if (body.requestedNextState === "shipped" && attempt === 1) {
      await respond(requestId, 409, { error: { code: "FULFILLMENT_CONFLICT" } });
      return;
    }
    if (body.requestedNextState === "delivered" && attempt === 1) {
      await respond(requestId, 401, { error: { code: "UNAUTHORIZED" } });
      return;
    }

    const timestamp = new Date().toISOString();
    await payload.update({
      collection: "orders",
      data: {
        orderStatus: body.requestedNextState,
        ...(body.tracking
          ? {
              trackingCarrier: body.tracking.carrier,
              trackingNumber: body.tracking.trackingNumber,
            }
          : {}),
        ...(body.requestedNextState === "shipped" ? { shippedAt: timestamp } : {}),
        ...(body.requestedNextState === "delivered" ? { deliveredAt: timestamp } : {}),
      },
      depth: 0,
      id: orderId,
      overrideAccess: true,
    });
    await respond(requestId, 200, {
      deliveredAt: body.requestedNextState === "delivered" ? timestamp : null,
      idempotent: false,
      shippedAt: body.requestedNextState === "shipped" ? timestamp : null,
      state: body.requestedNextState,
      tracking: body.tracking ?? null,
    });
  };

  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Runtime.exceptionThrown") browserErrors.push("runtime");
    if (
      message.method === "Runtime.consoleAPICalled" &&
      message.params.type === "error"
    ) browserErrors.push("console");
    if (message.method === "Fetch.requestPaused") {
      const url = new URL(message.params.request.url);
      if (url.pathname === `/api/admin/orders/${orderId}/fulfillment`) {
        handleFulfillment(message.params).catch((error) => {
          interceptionFailure = error;
        });
      } else {
        send("Fetch.continueRequest", { requestId: message.params.requestId }).catch(
          (error) => { interceptionFailure = error; },
        );
      }
    }
    if (message.id) {
      const handlers = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) handlers?.reject(message.error);
      else handlers?.resolve(message.result);
    }
  });

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Fetch.enable", {
    patterns: [{ requestStage: "Request", urlPattern: "*/api/admin/orders/*/fulfillment" }],
  });
  await send("Network.clearBrowserCookies");
  await send("Network.setCookie", {
    httpOnly: true,
    name: `${payload.config.cookiePrefix}-token`,
    sameSite: "Lax",
    url: baseURL,
    value: token,
  });
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: "window.__confirmCount=0; window.confirm=()=>{window.__confirmCount+=1; return true};",
  });

  stage = "INITIAL_RENDER";
  await send("Page.navigate", {
    url: `${baseURL}/admin/collections/orders/${orderId}`,
  });
  await waitFor(
    `document.querySelector("#order-workbench-title")?.textContent === "Order #${orderId}"`,
    "order workbench",
  );
  assert.equal(
    await evaluate(`document.querySelector("[aria-labelledby=note-heading] p").textContent`),
    intent.artistNote,
  );
  assert.equal(await evaluate(`window.__hostile === true`), false);
  assert.equal(
    await evaluate(`document.querySelector("[aria-labelledby=customer-heading]").textContent.includes("Customer <b>Literal</b>")`),
    true,
  );
  assert.equal(
    await evaluate(`document.querySelector("[aria-labelledby=timing-heading]").textContent.includes("Jan 15, 2026, 9:30 AM EST (New York time)")`),
    true,
  );
  assert.equal(
    (await database.query("SELECT order_status FROM public.orders WHERE id = $1", [orderId])).rows[0].order_status,
    "unfulfilled",
  );
  assert.deepEqual(await counts(), {
    ...baselineCounts,
    checkout_intents: baselineCounts.checkout_intents + 1,
    customers: baselineCounts.customers + 1,
    order_uploads: baselineCounts.order_uploads + 1,
    orders: baselineCounts.orders + 1,
  });

  stage = "PRIVATE_IMAGE";
  await waitFor(
    `document.querySelector("[aria-labelledby=images-heading] img")?.naturalWidth === 1`,
    "private image preview",
  );
  const streamContract = await evaluate(`(async () => {
    const previewURL = document.querySelector("[aria-label='Preview reference image 1']").href;
    const downloadURL = document.querySelector("[download]").href;
    const preview = await fetch(previewURL);
    const download = await fetch(downloadURL);
    return {
      preview: {
        bytes: [...new Uint8Array(await preview.arrayBuffer())],
        cache: preview.headers.get("cache-control"),
        disposition: preview.headers.get("content-disposition"),
        mime: preview.headers.get("content-type"),
        nosniff: preview.headers.get("x-content-type-options"),
        policy: preview.headers.get("cross-origin-resource-policy"),
        status: preview.status,
      },
      download: {
        bytes: [...new Uint8Array(await download.arrayBuffer())],
        disposition: download.headers.get("content-disposition"),
        status: download.status,
      },
    };
  })()`);
  assert.equal(streamContract.preview.status, 200);
  assert.equal(streamContract.download.status, 200);
  assert.deepEqual(Buffer.from(streamContract.preview.bytes), image);
  assert.deepEqual(Buffer.from(streamContract.download.bytes), image);
  assert.equal(streamContract.preview.mime, "image/png");
  assert.equal(streamContract.preview.disposition, 'inline; filename="reference-1.png"');
  assert.equal(streamContract.download.disposition, 'attachment; filename="reference-1.png"');
  assert.equal(streamContract.preview.cache, "private, no-store, max-age=0");
  assert.equal(streamContract.preview.nosniff, "nosniff");
  assert.equal(streamContract.preview.policy, "same-origin");
  const guessed = await evaluate(`fetch("/api/admin/orders/${orderId}/uploads/999999999/preview").then(async response => ({ status: response.status, text: await response.text() }))`);
  assert.equal(guessed.status, 404);
  assert.doesNotMatch(guessed.text, /filename|bucket|object|supabase/i);

  const actionLabel = () => evaluate(
    `document.querySelector("[aria-labelledby=fulfillment-heading] button")?.textContent`,
  );
  const clickAction = () => evaluate(
    `document.querySelector("[aria-labelledby=fulfillment-heading] button").click()`,
  );
  const waitForAction = (label) => waitFor(
    `document.querySelector("[aria-labelledby=fulfillment-heading] button")?.textContent === ${JSON.stringify(label)}`,
    label,
  );

  stage = "SINGLE_FLIGHT";
  assert.equal(await actionLabel(), "Start Work");
  await evaluate(`(() => { const button = document.querySelector("[aria-labelledby=fulfillment-heading] button"); button.click(); button.click(); })()`);
  await waitForAction("Mark Ready to Ship");
  assert.equal(fulfillmentCalls.filter(({ requestedNextState }) => requestedNextState === "in_progress").length, 1);

  stage = "RETRY";
  await clickAction();
  await waitFor(`document.querySelector("[role=alert]")?.textContent.includes("Nothing was changed")`, "safe retry error");
  assert.equal(await evaluate(`document.activeElement === document.querySelector("[role=alert]")`), true);
  assert.equal(await actionLabel(), "Mark Ready to Ship");
  await clickAction();
  await waitForAction("Mark Shipped");

  stage = "TRACKING_AND_CONFLICT";
  await evaluate(`(() => {
    const select = document.querySelector("[aria-label='Tracking carrier']");
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
    setter.call(select, "ups");
    select.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  const beforePairValidation = fulfillmentCalls.length;
  await clickAction();
  await waitFor(`document.querySelector("[role=alert]")?.textContent.includes("together")`, "tracking pair validation");
  assert.equal(fulfillmentCalls.length, beforePairValidation);
  await evaluate(`(() => {
    const input = document.querySelector("[aria-label='Tracking number']");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, "1Z999AA10123456784");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await clickAction();
  await waitFor(`document.querySelector("[role=alert]")?.textContent.includes("changed in another session")`, "stale conflict");
  assert.equal(await actionLabel(), "Mark Shipped");
  await clickAction();
  await waitForAction("Mark Delivered");
  assert.equal(await evaluate(`window.__confirmCount`), 2);
  const shippedCalls = fulfillmentCalls.filter(({ requestedNextState }) => requestedNextState === "shipped");
  assert.equal(shippedCalls.length, 2);
  assert.deepEqual(shippedCalls[1].tracking, {
    carrier: "ups",
    trackingNumber: "1Z999AA10123456784",
  });

  stage = "SESSION_EXPIRY_AND_REFRESH";
  await clickAction();
  await waitFor(`document.querySelector("[role=alert]")?.textContent.includes("session expired")`, "session expiry");
  assert.equal(await evaluate(`document.activeElement === document.querySelector("[role=alert]")`), true);
  await clickAction();
  await waitFor(
    `document.querySelector("[aria-labelledby=fulfillment-heading]").textContent.includes("No further fulfillment action")`,
    "delivered refresh",
  );
  assert.equal(await actionLabel(), undefined);
  assert.equal(
    (await database.query("SELECT order_status FROM public.orders WHERE id = $1", [orderId])).rows[0].order_status,
    "delivered",
  );
  assert.equal((await counts()).email_outbox, baselineCounts.email_outbox);

  stage = "WARNING_STATES";
  await payload.update({
    collection: "orders",
    data: {
      paymentStatus: "refunded",
      refundState: "full",
      refundedAmountCents: 1600,
    },
    id: orderId,
    overrideAccess: true,
  });
  await send("Page.reload", { ignoreCache: true });
  await waitFor(`document.body.textContent.includes("fully refunded")`, "full refund warning");
  await payload.update({
    collection: "orders",
    data: {
      paymentStatus: "disputed",
      refundState: "none",
      refundedAmountCents: 0,
      stripeDisputeId: `dp_${runId.replaceAll("-", "_")}`,
      stripeDisputeStatus: "under_review",
    },
    id: orderId,
    overrideAccess: true,
  });
  await send("Page.reload", { ignoreCache: true });
  await waitFor(`document.body.textContent.includes("payment dispute is under review")`, "dispute warning");

  stage = "RESPONSIVE";
  for (const metrics of [
    { height: 900, width: 1280 },
    { height: 844, width: 390 },
  ]) {
    await send("Emulation.setDeviceMetricsOverride", {
      deviceScaleFactor: 1,
      mobile: metrics.width < 500,
      ...metrics,
    });
    await delay(100);
    assert.equal(
      await evaluate(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`),
      true,
    );
  }
  assert.equal(browserErrors.length, 0);
  assert.equal(interceptionFailure, undefined);
  console.log("ADMIN_ORDER_WORKBENCH_BROWSER_RESULT=PASS");
  console.log("PRIVATE_STREAM_AND_RESPONSIVE_LAYOUT=PASS");
  console.log("MOCKED_FULFILLMENT_UI_STATES=PASS");
} catch {
  failed = true;
  console.error(`ADMIN_ORDER_WORKBENCH_FAILURE_STAGE=${stage}`);
  console.error("ADMIN_ORDER_WORKBENCH_FAILURE=REDACTED");
  if (orderId && database) {
    const diagnostic = await database
      .query("SELECT order_status FROM public.orders WHERE id = $1", [orderId])
      .catch(() => ({ rows: [] }));
    console.error(`ADMIN_ORDER_WORKBENCH_ORDER_STATE=${diagnostic.rows[0]?.order_status ?? "missing"}`);
  }
} finally {
  stage = "CLEANUP";
  try {
    if (payload && uploadId) {
      await payload.delete({ collection: "order-uploads", id: uploadId, overrideAccess: true });
    }
    if (payload && orderId) {
      await payload.delete({ collection: "orders", id: orderId, overrideAccess: true });
    }
    if (payload && customerId) {
      await payload.delete({ collection: "customers", id: customerId, overrideAccess: true });
    }
    if (payload && intentId) {
      await payload.delete({ collection: "checkout-intents", id: intentId, overrideAccess: true });
    }
    if (baselineCounts && baselineObjects) {
      const finalCounts = await counts();
      const finalObjects = await objectKeys();
      console.log(`FINAL_COUNTS=${JSON.stringify({
        ...finalCounts,
        storageObjects: finalObjects.length,
      })}`);
      assert.deepEqual(finalCounts, baselineCounts);
      assert.deepEqual(finalObjects, baselineObjects);
      console.log("DATABASE_AND_STORAGE_BASELINE_RESTORED=PASS");
    }
  } catch {
    failed = true;
    console.error("ADMIN_ORDER_WORKBENCH_CLEANUP=FAIL");
  }
  socket?.close();
  await database.end().catch(() => { failed = true; });
  storage.destroy();
  await Promise.race([
    payload?.destroy().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  process.exit(failed ? 1 : 0);
}
