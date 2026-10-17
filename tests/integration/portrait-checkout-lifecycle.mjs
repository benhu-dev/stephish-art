import nextEnvironment from "@next/env";
import pg from "pg";
import Stripe from "stripe";
import sharp from "sharp";
import { randomUUID, randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { createLocalReq, getPayload } from "payload";
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { startPortraitDraft } from "../../src/server/cart/portraitDraftService.ts";
import {
  addPortraitToCart,
  readPortraitCart,
} from "../../src/server/cart/portraitCartService.ts";
import {
  uploadPortraitReference,
  readPortraitReferencePreview,
  deletePortraitReference,
} from "../../src/server/cart/portraitUploadService.ts";
import { reserveCheckoutAttempt } from "../../src/server/storefront/checkoutSessionReservation.ts";
import { resolveStripeCheckoutSession } from "../../src/server/storefront/checkoutSessionService.ts";
import { abandonStripeCheckoutSession } from "../../src/server/storefront/checkoutAbandonService.ts";
import {
  buildStripeCheckoutSessionParams,
  validateStripeCheckoutSession,
} from "../../src/server/stripe/stripeCheckoutGateway.ts";
import { processStripeWebhookEvent } from "../../src/server/stripe/stripeWebhookService.ts";
import { handleStripeWebhookRequest } from "../../src/server/stripe/stripeWebhookEndpoint.ts";
import { readPortraitRecovery } from "../../src/server/cart/portraitRecoveryService.ts";
import { readOrderWorkbench } from "../../src/server/orders/orderWorkbenchService.ts";
import { createAdminPortraitTemplateHandler } from "../../src/server/orders/adminPortraitTemplateEndpoint.ts";
import { createAdminOrderUploadHandler } from "../../src/server/orders/adminOrderUploadEndpoint.ts";

// Explicit live fixture authorization required. No real cards/email/deployment.
// Actual Sandbox Sessions deliberately have unrelated test metadata, so external
// configured webhooks cannot process these fixtures or create late event residue.
// Paid webhook retrieval is injected; full Hosted Checkout payment is NOT tested.
const baseURL = process.argv[2] ?? "http://127.0.0.1:3000";
const run = `unit-3-6-2-${randomUUID()}`;
let stage = "PREFLIGHT",
  payload,
  database,
  storage,
  stripe,
  baseline,
  baselineObjects;
let completed = false,
  cleanupFailed = false;
const intents = new Set(),
  templates = new Set(),
  media = new Set(),
  sessions = new Set(),
  keys = new Set();
const events = new Set(),
  customerEmails = new Set(),
  artistIds = new Set();
const tables = [
  "users",
  "customers",
  "orders",
  "order_portraits",
  "checkout_intents",
  "checkout_portraits",
  "order_uploads",
  "email_outbox",
  "stripe_events",
  "template_media",
  "postcard_templates",
];
const check = (ok, code) => {
  if (!ok) throw new Error(code);
};
const rejected = async (fn, code) => {
  try {
    await fn();
  } catch (e) {
    check(!code || e.code === code, "UNEXPECTED_REJECTION");
    return;
  }
  throw new Error("EXPECTED_REJECTION");
};
const counts = async () => {
  const result = {};
  for (const t of tables)
    result[t] = Number(
      (await database.query(`SELECT count(*)::int AS n FROM public.${t}`))
        .rows[0].n,
    );
  return result;
};
const objects = async () => {
  const result = [];
  let cursor;
  do {
    const page = await storage.send(
      new ListObjectsV2Command({
        Bucket: process.env.SUPABASE_STORAGE_BUCKET,
        ContinuationToken: cursor,
      }),
    );
    for (const o of page.Contents ?? [])
      result.push({ key: o.Key, etag: o.ETag });
    cursor = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (cursor);
  return result.sort((a, b) => a.key.localeCompare(b.key));
};
const req = (user) => createLocalReq(user ? { user } : {}, payload);
const readIntent = async (id) =>
  (
    await database.query("SELECT * FROM public.checkout_intents WHERE id=$1", [
      id,
    ])
  ).rows[0];
const trackUploads = async (id) => {
  const rows = (
    await database.query(
      "SELECT filename FROM public.order_uploads WHERE checkout_intent_id=$1",
      [id],
    )
  ).rows;
  for (const row of rows) {
    check(
      !baselineObjects.some((o) => o.key === row.filename),
      "STORAGE_KEY_COLLISION",
    );
    keys.add(row.filename);
  }
};
const input = (region) => ({ policyAccepted: true, shippingRegion: region });
const fixture = async (count = 1, subjects = 1, upload = true) => {
  const created = await startPortraitDraft(await req());
  intents.add(created.intent.id);
  await payload.update({
    collection: "checkout-intents",
    id: created.intent.id,
    overrideAccess: true,
    data: { artistNote: run },
  });
  let cart;
  for (let i = 0; i < count; i++)
    cart = await addPortraitToCart({
      credential: created.credential,
      request: await req(),
      input: {
        templateId: [...templates][i % templates.size],
        artistNote: `${run} independent note ${i + 1}`,
        subjects: Array.from({ length: subjects }, (_, j) => ({
          name: `Synthetic subject ${j + 1}`,
          kind: j === 1 ? "pet" : "person",
        })),
      },
    });
  if (upload)
    for (const p of cart.portraits) {
      for (let j = 0; j < p.subjects.length; j++)
        await uploadPortraitReference({
          credential: created.credential,
          request: await req(),
          portraitPublicId: p.id,
          metadata: { position: j + 1, subjectIds: [p.subjects[j].id] },
          file: {
            data: image,
            mimetype: "image/png",
            size: image.length,
            name: "synthetic.png",
          },
        });
    }
  await trackUploads(created.intent.id);
  cart = await readPortraitCart({
    credential: created.credential,
    request: await req(),
  });
  return { credential: created.credential, id: created.intent.id, cart };
};
const image = await sharp({
  create: { width: 20, height: 24, channels: 3, background: "#967989" },
})
  .png()
  .toBuffer();

const signedDelivery = async (
  f,
  { country = "TW", eventId, probe = {} } = {},
) => {
  const row = await readIntent(f.id),
    snapshot = row.portrait_payment_snapshot;
  const email = `${run}-${f.id}@example.invalid`;
  customerEmails.add(email);
  const session = {
    object: "checkout.session",
    id: row.stripe_checkout_session_id,
    livemode: false,
    mode: "payment",
    status: "complete",
    payment_method_types: ["card"],
    currency: "usd",
    amount_subtotal: snapshot.subtotalCents,
    amount_total: snapshot.totalCents,
    total_details: {
      amount_shipping: snapshot.shipping.amountCents,
      amount_discount: 0,
      amount_tax: 0,
    },
    metadata: {
      checkoutIntentId: String(f.id),
      checkoutAttemptId: row.checkout_attempt_id,
      portraitCheckoutVersion: "1",
    },
    client_reference_id: String(f.id),
    expires_at: Math.floor(
      new Date(row.stripe_checkout_session_expires_at).getTime() / 1000,
    ),
    payment_status: "paid",
    payment_intent: `pi_fixture_${run}_${f.id}`,
    customer: `cus_fixture_${run}_${f.id}`,
    customer_details: { email, name: "Synthetic portrait customer" },
    collected_information: {
      shipping_details: {
        name: "Synthetic portrait customer",
        address: {
          country,
          city: "Synthetic City",
          line1: "1 Synthetic Way",
          postal_code: country === "US" ? "10001" : "100",
          state: country === "US" ? "NY" : null,
        },
      },
    },
  };
  const id = eventId ?? `evt_fixture_${run}_${randomUUID()}`;
  events.add(id);
  const event = {
    id,
    object: "event",
    livemode: false,
    type: "checkout.session.completed",
    created: Math.floor(Date.now() / 1000),
    data: { object: session },
  };
  const signingSecret = `whsec_fixture_${run}`;
  const signing = new Stripe("sk_test_synthetic_fixture");
  const body = JSON.stringify(event),
    signature = signing.webhooks.generateTestHeaderString({
      payload: body,
      secret: signingSecret,
    });
  const request = await req();
  const gateway = {
    retrieveSession: async () => structuredClone(session),
    verifyEvent: (b, s) => signing.webhooks.constructEvent(b, s, signingSecret),
  };
  return handleStripeWebhookRequest(
    new Request(`${baseURL}/api/webhooks/stripe`, {
      method: "POST",
      body,
      headers: { "stripe-signature": signature },
    }),
    {
      verifyEvent: gateway.verifyEvent,
      processEvent: (e) =>
        processStripeWebhookEvent({
          event: e,
          gateway,
          getRequest: async () => request,
          // Freeze synthetic jobs as non-deliverable in the SAME transaction before
          // commit, so even an independent cron never sees pending fixture mail.
          probe: {
            ...probe,
            afterLedger: async () => {
              const order = await payload.find({
                collection: "orders",
                depth: 0,
                limit: 1,
                req: request,
                overrideAccess: true,
                where: { checkoutIntent: { equals: f.id } },
              });
              if (order.docs[0]) {
                const jobs = await payload.find({
                  collection: "email-outbox",
                  depth: 0,
                  limit: 3,
                  req: request,
                  overrideAccess: true,
                  where: { order: { equals: order.docs[0].id } },
                });
                check(
                  jobs.docs.length === 2 &&
                    jobs.docs.every(
                      (j) => j.status === "pending" && j.attempts === 0,
                    ),
                  "OUTBOX_CREATION_INVALID",
                );
                for (const j of jobs.docs)
                  await payload.update({
                    collection: "email-outbox",
                    id: j.id,
                    req: request,
                    overrideAccess: true,
                    data: {
                      status: "failed",
                      nextAttemptAt: null,
                      lastErrorCode: "synthetic_delivery_disabled",
                    },
                  });
              }
              await probe.afterLedger?.();
            },
          },
        }),
    },
  );
};

// Real gateway for Sandbox parameter/resume/expiration checks. Correlation is
// intentionally replaced ONLY in this fixture to isolate external webhooks.
const sandboxGateway = {
  createSession: async (params) => {
    const p = buildStripeCheckoutSessionParams(params);
    p.metadata = { integrationFixture: run };
    p.client_reference_id = run;
    const session = await stripe.checkout.sessions.create(p, {
      idempotencyKey: `portrait-fixture:${params.attemptId}`,
    });
    sessions.add(session.id);
    return validateStripeCheckoutSession(session);
  },
  retrieveSession: async (id) =>
    validateStripeCheckoutSession(await stripe.checkout.sessions.retrieve(id)),
  expireSession: async (id) =>
    validateStripeCheckoutSession(await stripe.checkout.sessions.expire(id)),
};
const syntheticGateway = {
  createSession: async (p) => ({
    id: `cs_test_fixture_${run}_${p.intentId}`,
    expiresAt: new Date(p.expiresAtEpochSeconds * 1000).toISOString(),
    expiresAtEpochSeconds: p.expiresAtEpochSeconds,
    paymentStatus: "unpaid",
    status: "open",
    url: "https://checkout.stripe.com/c/pay/cs_test_synthetic",
  }),
  retrieveSession: async () => {
    throw new Error("UNEXPECTED_SYNTHETIC_RETRIEVAL");
  },
};

try {
  nextEnvironment.loadEnvConfig(process.cwd());
  check(
    process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_"),
    "SANDBOX_KEY_REQUIRED",
  );
  check(
    process.env.SUPABASE_STORAGE_BUCKET === "order-uploads",
    "PRIVATE_BUCKET_REQUIRED",
  );
  database = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await database.connect();
  storage = new S3Client({
    endpoint: process.env.SUPABASE_STORAGE_ENDPOINT,
    region: process.env.SUPABASE_STORAGE_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.SUPABASE_STORAGE_ACCESS_KEY_ID,
      secretAccessKey: process.env.SUPABASE_STORAGE_SECRET_ACCESS_KEY,
    },
  });
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { maxNetworkRetries: 0 });
  baseline = await counts();
  baselineObjects = await objects();
  console.log(`BASELINE_COUNTS=${JSON.stringify(baseline)}`);
  console.log(`FIXTURE_RUN_MARKER=${run}`);
  console.log(`BASELINE_STORAGE_OBJECTS=${baselineObjects.length}`);
  const { default: config } = await import("../../src/payload.config.ts");
  payload = await getPayload({ config });
  payload.logger.level = "silent";

  stage = "CREATE_SYNTHETIC_CATALOG";
  const preview = await payload.create({
    collection: "template-media",
    overrideAccess: true,
    depth: 0,
    data: { alt: "Synthetic lifecycle artwork" },
    file: {
      data: image,
      mimetype: "image/png",
      size: image.length,
      name: `${run}.png`,
    },
  });
  media.add(preview.id);
  keys.add(`template-media/${preview.filename}`);
  for (let i = 0; i < 2; i++) {
    const t = await payload.create({
      collection: "postcard-templates",
      overrideAccess: true,
      depth: 0,
      data: {
        name: `${run} design ${i + 1}`,
        available: true,
        previewMedia: preview.id,
        sortOrder: 9999,
      },
    });
    templates.add(t.id);
  }

  stage = "DRAFT_STORAGE_AND_COVERAGE";
  const incomplete = await fixture(1, 2, false);
  await rejected(async () =>
    reserveCheckoutAttempt(
      await req(),
      incomplete.credential,
      new Date(),
      input("us"),
    ),
  );
  check(
    (await readIntent(incomplete.id)).status === "draft",
    "INCOMPLETE_DRAFT_RESERVED",
  );

  stage = "SANDBOX_US_AND_INTERNATIONAL";
  for (const [region, count, subjects] of process.argv.includes(
    "--skip-sandbox",
  )
    ? []
    : [
        ["us", 1, 1],
        ["international", 5, 3],
      ]) {
    const f = await fixture(count, subjects);
    const before = await readPortraitRecovery({
      credential: f.credential,
      request: await req(),
    });
    check(before.status === "draft", "DRAFT_RECOVERY_INVALID");
    const previewResult = await readPortraitReferencePreview({
      credential: f.credential,
      portraitPublicId: f.cart.portraits[0].id,
      uploadId: f.cart.portraits[0].photos[0].id,
      request: await req(),
    });
    check(
      (await new Response(previewResult.stream).arrayBuffer()).byteLength > 0,
      "PRIVATE_PREVIEW_INVALID",
    );
    const options = {
      credential: f.credential,
      portraitCheckout: input(region),
      gateway: sandboxGateway,
    };
    const result = await resolveStripeCheckoutSession({
      ...options,
      request: await req(),
    });
    const session = await stripe.checkout.sessions.retrieve(result.session.id, {
      expand: ["shipping_cost.shipping_rate"],
    });
    const items = await stripe.checkout.sessions.listLineItems(session.id, {
      limit: 10,
    });
    check(
      session.livemode === false &&
        session.payment_method_types.length === 1 &&
        session.payment_method_types[0] === "card",
      "SANDBOX_CARD_INVALID",
    );
    check(
      items.data.length === count &&
        items.data.reduce((s, i) => s + i.amount_subtotal, 0) ===
          f.cart.subtotalCents,
      "LINE_ITEMS_INVALID",
    );
    const countries = session.shipping_address_collection.allowed_countries;
    check(
      region === "us"
        ? countries.length === 1 && countries[0] === "US"
        : countries.includes("TW") && !countries.includes("US"),
      "COUNTRY_RESTRICTION_INVALID",
    );
    const rateId = session.shipping_options[0].shipping_rate;
    const rate =
      typeof rateId === "string"
        ? await stripe.shippingRates.retrieve(rateId)
        : rateId;
    check(
      rate.fixed_amount.amount === (region === "us" ? 1000 : 500),
      "FLAT_SHIPPING_INVALID",
    );
    const again = await resolveStripeCheckoutSession({
      ...options,
      request: await req(),
    });
    check(again.session.id === session.id, "SESSION_REUSE_INVALID");
    await rejected(
      async () =>
        resolveStripeCheckoutSession({
          ...options,
          portraitCheckout: input(region === "us" ? "international" : "us"),
          request: await req(),
        }),
      "SHIPPING_REGION_LOCKED",
    );
    await rejected(
      async () =>
        addPortraitToCart({
          credential: f.credential,
          request: await req(),
          input: {
            templateId: [...templates][0],
            subjects: [{ name: "Synthetic", kind: "person" }],
            artistNote: null,
          },
        }),
      "INTENT_NOT_DRAFT",
    );
    await rejected(() =>
      payload.update({
        collection: "template-media",
        id: preview.id,
        overrideAccess: true,
        data: { alt: "Disallowed replacement" },
      }),
    );
    await abandonStripeCheckoutSession({
      credential: f.credential,
      request: await req(),
      dependencies: { gateway: sandboxGateway },
    });
    check(
      (await stripe.checkout.sessions.retrieve(session.id)).status ===
        "expired",
      "SESSION_EXPIRE_INVALID",
    );
    check((await readIntent(f.id)).status === "expired", "ABANDON_INVALID");
  }
  console.log(
    `SANDBOX_SESSION_CREATE_RESUME_COUNTRIES_SHIPPING_EXPIRE=${process.argv.includes("--skip-sandbox") ? "NOT_RUN_THIS_INVOCATION" : "PASS"}`,
  );

  stage = "REAL_DATABASE_CONCURRENT_RESERVATION";
  const paid = await fixture(5, 3);
  const reservations = await Promise.all(
    [1, 2].map(async () =>
      reserveCheckoutAttempt(
        await req(),
        paid.credential,
        new Date(),
        input("international"),
      ),
    ),
  );
  check(
    reservations[0].attemptId === reservations[1].attemptId &&
      reservations.filter((r) => r.createdAttempt).length === 1,
    "CONCURRENT_RESERVATION_INVALID",
  );
  // Finalize the already-reserved attempt without sending a live payment.
  await resolveStripeCheckoutSession({
    credential: paid.credential,
    portraitCheckout: input("international"),
    request: await req(),
    gateway: syntheticGateway,
  });
  const frozen = (await readIntent(paid.id)).portrait_payment_snapshot;
  await payload.update({
    collection: "postcard-templates",
    id: [...templates][0],
    overrideAccess: true,
    data: { name: `${run} edited`, available: false },
  });
  const recover = await readPortraitRecovery({
    credential: paid.credential,
    request: await req(),
  });
  check(
    recover.status === "checkout_created" && recover.totalAmountCents === 15500,
    "PAYMENT_RECOVERY_INVALID",
  );
  stage = "SIGNED_COUNTRY_REJECTION";
  check(
    (await signedDelivery(paid, { country: "US" })).status === 200,
    "REJECTED_EVENT_HTTP_INVALID",
  );
  check(
    Number(
      (
        await database.query(
          "SELECT count(*)::int n FROM public.orders WHERE checkout_intent_id=$1",
          [paid.id],
        )
      ).rows[0].n,
    ) === 0,
    "WRONG_COUNTRY_ORDER_CREATED",
  );
  stage = "SIGNED_PAID_REPLAY_AND_ARTIST";
  const replay = `evt_fixture_${run}_replay`;
  const results = await Promise.all(
    [1, 2].map(() => signedDelivery(paid, { eventId: replay })),
  );
  check(
    results.every((r) => r.status === 200),
    "PAID_DELIVERY_INVALID",
  );
  const order = (
    await database.query(
      "SELECT * FROM public.orders WHERE checkout_intent_id=$1",
      [paid.id],
    )
  ).rows[0];
  check(
    Boolean(order) && Number(order.amount_cents) === 15500,
    "PAID_ORDER_INVALID",
  );
  check(
    (await signedDelivery(paid)).status === 200,
    "SECOND_EVENT_REPLAY_INVALID",
  );
  const jobs = (
    await database.query(
      "SELECT status,attempts FROM public.email_outbox WHERE order_id=$1",
      [order.id],
    )
  ).rows;
  check(
    jobs.length === 2 &&
      jobs.every((j) => j.status === "failed" && Number(j.attempts) === 0),
    "EMAIL_SUPPRESSION_INVALID",
  );
  const portraitRows = (
    await database.query(
      "SELECT template_name FROM public.order_portraits WHERE order_id=$1 ORDER BY position",
      [order.id],
    )
  ).rows;
  check(
    portraitRows.length === 5 &&
      portraitRows.every(
        (p, i) => p.template_name === frozen.portraits[i].templateName,
      ),
    "IMMUTABLE_CATALOG_INVALID",
  );
  const password = randomBytes(24).toString("base64url"),
    email = `${run}-artist@example.invalid`;
  const artist = await payload.create({
    collection: "users",
    overrideAccess: true,
    data: { email, password },
    depth: 0,
  });
  artistIds.add(artist.id);
  const login = await payload.login({
    collection: "users",
    data: { email, password },
  });
  check(Boolean(login.token), "ARTIST_LOGIN_INVALID");
  const artistUser = { ...artist, collection: "users" };
  const workbench = await readOrderWorkbench({
    orderId: order.id,
    request: await req(artistUser),
  });
  check(
    workbench.portraits.length === 5 &&
      workbench.uploads.length === 15 &&
      workbench.portraits.every((p) => p.uploads.length === 3),
    "ARTIST_GROUPING_INVALID",
  );
  const photo = workbench.portraits[4].uploads[2],
    p = workbench.portraits[4];
  const adminReq = await req(artistUser);
  adminReq.routeParams = {
    orderId: String(order.id),
    portraitId: String(p.id),
    uploadId: String(photo.id),
  };
  adminReq.url = `${baseURL}/api/admin/orders/${order.id}/portraits/${p.id}/template-preview`;
  const tResponse = await createAdminPortraitTemplateHandler()(adminReq);
  check(
    tResponse.status === 200 &&
      (await tResponse.arrayBuffer()).byteLength === image.length,
    "ARTIST_TEMPLATE_BYTES_INVALID",
  );
  const photoResponse = await createAdminOrderUploadHandler({
    mode: "download",
  })(adminReq);
  check(
    photoResponse.status === 200 &&
      (await photoResponse.arrayBuffer()).byteLength > 0,
    "ARTIST_PHOTO_BYTES_INVALID",
  );
  const anonymous = await req();
  anonymous.routeParams = adminReq.routeParams;
  anonymous.url = adminReq.url;
  check(
    (await createAdminPortraitTemplateHandler()(anonymous)).status === 401,
    "ANONYMOUS_TEMPLATE_ALLOWED",
  );
  const wrong = await req(artistUser);
  wrong.routeParams = {
    orderId: String(order.id + 999999),
    portraitId: String(p.id),
  };
  wrong.url = adminReq.url;
  check(
    (await createAdminPortraitTemplateHandler()(wrong)).status === 404,
    "CROSS_ORDER_TEMPLATE_ALLOWED",
  );
  // Verify the actual Payload HTTP auth boundary, not just a supplied Local API user.
  stage = "HTTP_ARTIST_PRIVATE_PREVIEWS";
  for (const path of [
    `/api/admin/orders/${order.id}/portraits/${p.id}/template-preview`,
    `/api/admin/orders/${order.id}/uploads/${photo.id}/preview`,
  ]) {
    const response = await fetch(`${baseURL}${path}`, {
      headers: { Authorization: `JWT ${login.token}` },
    });
    check(
      response.status === 200 &&
        response.headers.get("cache-control")?.includes("no-store"),
      "HTTP_ARTIST_PREVIEW_INVALID",
    );
    check(
      (await response.arrayBuffer()).byteLength > 0,
      "HTTP_ARTIST_BYTES_EMPTY",
    );
    check(
      (await fetch(`${baseURL}${path}`)).status === 401,
      "HTTP_ANONYMOUS_ALLOWED",
    );
  }
  await rejected(
    async () =>
      abandonStripeCheckoutSession({
        credential: paid.credential,
        request: await req(),
      }),
    "CHECKOUT_STATE_CONFLICT",
  );
  await rejected(
    async () =>
      deletePortraitReference({
        credential: paid.credential,
        portraitPublicId: paid.cart.portraits[0].id,
        uploadId: paid.cart.portraits[0].photos[0].id,
        request: await req(),
      }),
    "INTENT_NOT_DRAFT",
  );
  console.log("SIGNED_SYNTHETIC_PAID_GRAPH_REPLAY_PRIVATE_ARTIST_HTTP=PASS");

  stage = "REAL_DATABASE_ROLLBACK";
  // Re-enable only our temporary template before creating another fixture.
  await payload.update({
    collection: "postcard-templates",
    id: [...templates][0],
    overrideAccess: true,
    data: { available: true },
  });
  const rollback = await fixture(2, 2);
  await resolveStripeCheckoutSession({
    credential: rollback.credential,
    portraitCheckout: input("us"),
    request: await req(),
    gateway: syntheticGateway,
  });
  for (const hook of [
    "afterPortraits",
    "afterUploads",
    "afterFirstOutboxJob",
    "afterLedger",
  ]) {
    const before = await counts();
    const response = await signedDelivery(rollback, {
      country: "US",
      probe: {
        [hook]: () => {
          throw new Error("SYNTHETIC_ROLLBACK");
        },
      },
    });
    check(response.status === 500, "ROLLBACK_NOT_RETRYABLE");
    check(isDeepStrictEqual(await counts(), before), "ROLLBACK_RESIDUE");
    check(
      (await readIntent(rollback.id)).status === "checkout_created",
      "ROLLBACK_INTENT_CHANGED",
    );
  }
  console.log("REAL_DATABASE_ROLLBACK_MATRIX=PASS");
  completed = true;
} catch (error) {
  console.log(`LIFECYCLE_FAIL_STAGE=${stage}`);
  // No provider messages, stack, bodies, URLs, identifiers, tokens or object keys.
  console.log(
    `LIFECYCLE_FAIL_CODE=${/^[A-Z_]+$/.test(error?.code ?? "") ? error.code : /^[A-Z_]+$/.test(error?.message ?? "") ? error.message : "CHECK_FAILED"}`,
  );
  process.exitCode = 1;
} finally {
  stage = "CLEANUP";
  try {
    if (stripe)
      for (const id of sessions) {
        const s = await stripe.checkout.sessions.retrieve(id);
        if (s.status === "open") await stripe.checkout.sessions.expire(id);
        check(s.status !== "complete", "UNEXPECTED_PAID_SANDBOX_SESSION");
      }
    if (database && baseline) for (const id of intents) await trackUploads(id);
    if (storage && baselineObjects) {
      // Include an upload orphan only if its filename has our unique catalog prefix.
      for (const o of await objects())
        if (o.key.startsWith(`template-media/${run}`)) keys.add(o.key);
      for (const key of keys) {
        check(
          !baselineObjects.some((o) => o.key === key),
          "UNSAFE_OBJECT_CLEANUP",
        );
        await storage.send(
          new DeleteObjectCommand({
            Bucket: process.env.SUPABASE_STORAGE_BUCKET,
            Key: key,
          }),
        );
      }
    }
    if (database && intents.size) {
      await database.query("BEGIN");
      const ids = [...intents];
      // Every target is derived from this run's issued Intent IDs, never a broad delete.
      await database.query(
        "DELETE FROM public.email_outbox WHERE order_id IN (SELECT id FROM public.orders WHERE checkout_intent_id=ANY($1::int[]))",
        [ids],
      );
      await database.query(
        "DELETE FROM public.order_uploads WHERE checkout_intent_id=ANY($1::int[])",
        [ids],
      );
      await database.query(
        "DELETE FROM public.order_portraits WHERE order_id IN (SELECT id FROM public.orders WHERE checkout_intent_id=ANY($1::int[]))",
        [ids],
      );
      await database.query(
        "DELETE FROM public.orders WHERE checkout_intent_id=ANY($1::int[])",
        [ids],
      );
      await database.query(
        "DELETE FROM public.stripe_events WHERE checkout_intent_id=ANY($1::int[]) OR stripe_event_id=ANY($2::text[])",
        [ids, [...events]],
      );
      await database.query(
        "DELETE FROM public.checkout_portraits WHERE intent_id=ANY($1::int[])",
        [ids],
      );
      await database.query(
        "DELETE FROM public.checkout_intents WHERE id=ANY($1::int[])",
        [ids],
      );
      if (customerEmails.size)
        await database.query(
          "DELETE FROM public.customers WHERE email=ANY($1::text[])",
          [[...customerEmails]],
        );
      if (artistIds.size)
        await database.query(
          "DELETE FROM public.users WHERE id=ANY($1::int[])",
          [[...artistIds]],
        );
      if (templates.size)
        await database.query(
          "DELETE FROM public.postcard_templates WHERE id=ANY($1::int[])",
          [[...templates]],
        );
      if (media.size)
        await database.query(
          "DELETE FROM public.template_media WHERE id=ANY($1::int[])",
          [[...media]],
        );
      await database.query("COMMIT");
    }
    if (baseline) {
      const final = await counts();
      console.log(`FINAL_COUNTS=${JSON.stringify(final)}`);
      check(isDeepStrictEqual(final, baseline), "COUNTS_NOT_RESTORED");
    }
    if (baselineObjects) {
      const final = await objects();
      console.log(`FINAL_STORAGE_OBJECTS=${final.length}`);
      check(isDeepStrictEqual(final, baselineObjects), "STORAGE_NOT_RESTORED");
    }
  } catch {
    await database?.query("ROLLBACK").catch(() => {});
    cleanupFailed = true;
    console.log("FIXTURE_CLEANUP=FAIL");
    process.exitCode = 1;
  }
  await database?.end().catch(() => {});
  storage?.destroy();
  await Promise.race([
    payload?.destroy().catch(() => {}),
    new Promise((r) => setTimeout(r, 3000)),
  ]);
  if (completed && !cleanupFailed && !process.exitCode)
    console.log("PORTRAIT_CHECKOUT_LIFECYCLE=PASS");
  console.log("REAL_EMAIL_DELIVERY=NOT_RUN");
  console.log("ACTUAL_HOSTED_CHECKOUT_PAYMENT=NOT_RUN");
  process.exit(process.exitCode ?? 0);
}
