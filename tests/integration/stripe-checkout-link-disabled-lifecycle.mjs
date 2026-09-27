import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import nextEnvironment from "@next/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { getPayload } from "payload";
import Stripe from "stripe";

import { issueCheckoutIntentCredential } from "../../src/server/checkout-intents/checkoutIntentCredentials.ts";
import { serializeCheckoutIntentCookie } from "../../src/server/storefront/checkoutIntentCookie.ts";

const { loadEnvConfig } = nextEnvironment;
loadEnvConfig(fileURLToPath(new URL("../../", import.meta.url)), true, {
  error() {},
  info() {},
});

const baseURL = process.argv[2] ?? "http://127.0.0.1:3000";
const origin = new URL(baseURL).origin;
const runId = `unit-2-14-2-${randomUUID()}`;
const png = Buffer.from(
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
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  maxNetworkRetries: 0,
});

let payload;
let intentId;
let uploadId;
let stripeSessionId;
let baselineCounts;
let baselineObjects;
let passed = false;
let cleanupFailed = false;
let stage = "INITIALIZE";

const counts = async () =>
  (
    await database.query(
      "SELECT " +
        "(SELECT count(*)::int FROM public.checkout_intents) AS checkout_intents, " +
        "(SELECT count(*)::int FROM public.order_uploads) AS order_uploads, " +
        "(SELECT count(*)::int FROM public.customers) AS customers, " +
        "(SELECT count(*)::int FROM public.orders) AS orders",
    )
  ).rows[0];

const objectKeys = async () =>
  (
    (
      await storage.send(
        new ListObjectsV2Command({
          Bucket: process.env.SUPABASE_STORAGE_BUCKET,
          MaxKeys: 1000,
        }),
      )
    ).Contents ?? []
  )
    .map(({ Key }) => Key)
    .sort();

const postCheckout = (cookie) =>
  fetch(
    new URL(
      "/api/storefront/checkout-intents/current/checkout-session",
      baseURL,
    ),
    {
      body: "{}",
      headers: { "content-type": "application/json", cookie, origin },
      method: "POST",
    },
  );

try {
  stage = "CONNECT";
  assert.equal(process.env.STRIPE_SECRET_KEY.startsWith("sk_test_"), true);
  await database.connect();
  const { default: config } = await import("../../src/payload.config.ts");
  payload = await getPayload({ config });
  baselineCounts = await counts();
  baselineObjects = await objectKeys();
  console.log(
    `START_COUNTS=${JSON.stringify({
      ...baselineCounts,
      storageObjects: baselineObjects.length,
    })}`,
  );

  stage = "CREATE_SYNTHETIC_FIXTURE";
  const settings = await payload.findGlobal({
    overrideAccess: true,
    slug: "checkout-settings",
  });
  const amountCents = Math.max(500, Number(settings.minimumAmountCents)) + 123;
  const shippingAmountCents = Number(settings.shippingFeeCents);
  const issued = issueCheckoutIntentCredential();
  const expiresAt = new Date(Date.now() + 23 * 60 * 60 * 1000);
  const intent = await payload.create({
    collection: "checkout-intents",
    data: {
      ...issued.createData,
      amountCents,
      expiresAt: expiresAt.toISOString(),
      status: "draft",
    },
    depth: 0,
    overrideAccess: true,
  });
  intentId = Number(intent.id);
  const upload = await payload.create({
    collection: "order-uploads",
    data: { checkoutIntent: intentId, position: 1 },
    depth: 0,
    file: {
      data: png,
      mimetype: "image/png",
      name: `${runId}.png`,
      size: png.length,
    },
    overrideAccess: true,
  });
  uploadId = Number(upload.id);
  const cookie = serializeCheckoutIntentCookie(
    { intentId, rawToken: issued.rawToken },
    expiresAt,
    true,
  ).split(";", 1)[0];

  stage = "CREATE_SESSION";
  const createResponse = await postCheckout(cookie);
  assert.equal(createResponse.status, 201);
  assert.equal(createResponse.headers.get("cache-control"), "no-store");
  const createBody = await createResponse.json();
  assert.deepEqual(Object.keys(createBody).sort(), ["checkoutUrl", "expiresAt"]);
  assert.match(createBody.checkoutUrl, /^https:\/\/checkout\.stripe\.com\//);
  const row = (
    await database.query(
      "SELECT status, amount_cents::int, shipping_amount_cents::int, " +
        "total_amount_cents::int, stripe_checkout_session_id " +
        "FROM public.checkout_intents WHERE id = $1",
      [intentId],
    )
  ).rows[0];
  assert.equal(row.status, "checkout_created");
  assert.equal(row.amount_cents, amountCents);
  assert.equal(row.shipping_amount_cents, shippingAmountCents);
  assert.equal(row.total_amount_cents, amountCents + shippingAmountCents);
  stripeSessionId = row.stripe_checkout_session_id;

  stage = "RETRIEVE_AND_VERIFY_SESSION";
  const session = await stripe.checkout.sessions.retrieve(stripeSessionId);
  assert.equal(session.livemode, false);
  assert.equal(session.status, "open");
  assert.equal(session.mode, "payment");
  assert.equal(session.currency, "usd");
  assert.equal(session.customer_creation, "always");
  assert.equal(session.customer, null);
  assert.deepEqual(session.payment_method_types, ["card"]);
  assert.deepEqual(session.wallet_options, { link: { display: "never" } });
  assert.deepEqual(session.shipping_address_collection, {
    allowed_countries: ["US"],
  });
  assert.equal(session.amount_subtotal, amountCents);
  assert.equal(session.amount_total, amountCents + shippingAmountCents);
  assert.equal(session.automatic_tax.enabled, false);
  assert.equal(session.allow_promotion_codes, null);
  assert.equal(session.invoice_creation.enabled, false);
  assert.deepEqual(Object.keys(session.metadata).sort(), [
    "checkoutAttemptId",
    "checkoutIntentId",
  ]);

  stage = "VERIFY_REUSE";
  const reuseResponse = await postCheckout(cookie);
  assert.equal(reuseResponse.status, 200);
  assert.deepEqual(await reuseResponse.json(), createBody);
  const reusedRow = (
    await database.query(
      "SELECT stripe_checkout_session_id FROM public.checkout_intents WHERE id = $1",
      [intentId],
    )
  ).rows[0];
  assert.equal(reusedRow.stripe_checkout_session_id, stripeSessionId);

  stage = "EXPIRE_SESSION";
  await stripe.checkout.sessions.expire(stripeSessionId);
  assert.equal(
    (await stripe.checkout.sessions.retrieve(stripeSessionId)).status,
    "expired",
  );
  passed = true;
} catch {
  console.error(`STRIPE_LINK_DISABLED_FAILURE_STAGE=${stage}`);
  process.exitCode = 1;
} finally {
  stage = "CLEANUP_SYNTHETIC_ONLY";
  try {
    if (stripeSessionId) {
      const session = await stripe.checkout.sessions.retrieve(stripeSessionId);
      if (session.status === "open") {
        await stripe.checkout.sessions.expire(stripeSessionId);
      }
    }
    if (payload && uploadId) {
      await payload.delete({
        collection: "order-uploads",
        id: uploadId,
        overrideAccess: true,
      });
    }
    if (payload && intentId) {
      await payload.delete({
        collection: "checkout-intents",
        id: intentId,
        overrideAccess: true,
      });
    }
    const finalCounts = await counts();
    const finalObjects = await objectKeys();
    assert.deepEqual(finalCounts, baselineCounts);
    assert.deepEqual(finalObjects, baselineObjects);
    console.log(
      `FINAL_COUNTS=${JSON.stringify({
        ...finalCounts,
        storageObjects: finalObjects.length,
      })}`,
    );
  } catch {
    cleanupFailed = true;
    console.error("STRIPE_LINK_DISABLED_SYNTHETIC_CLEANUP=FAIL");
  }
  await database.end().catch(() => {
    cleanupFailed = true;
  });
  storage.destroy();
  await Promise.race([
    payload?.destroy().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (passed && !cleanupFailed && !process.exitCode) {
    console.log("STRIPE_LINK_DISABLED_LIFECYCLE=PASS");
    console.log("CARD_ONLY_AND_LINK_DISABLED=PASS");
    console.log("CHECKOUT_SESSION_REUSE=PASS");
    console.log("SYNTHETIC_FIXTURE_CLEANUP=PASS");
  } else {
    process.exitCode = 1;
  }
  process.exit(process.exitCode ?? 0);
}
