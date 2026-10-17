import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import {
  readPortraitRecovery as readClient,
  requestPortraitPayment,
} from "../../src/features/checkout/portraitPaymentClient.ts";
import { readPortraitRecovery as readServer } from "../../src/server/cart/portraitRecoveryService.ts";
import { startPortraitDraft } from "../../src/server/cart/portraitDraftService.ts";
import { abandonStripeCheckoutSession } from "../../src/server/storefront/checkoutAbandonService.ts";
import {
  portraitDraftHandler,
  portraitRecoveryHandler,
} from "../../src/server/cart/portraitCartEndpoints.ts";
import { createAdminPortraitTemplateHandler } from "../../src/server/orders/adminPortraitTemplateEndpoint.ts";
import { readOrderWorkbench } from "../../src/server/orders/orderWorkbenchService.ts";
import { OrderWorkbenchDetails } from "../../src/components/admin/orders/OrderWorkbenchDetails.tsx";
import { CartStep } from "../../src/features/checkout/components/PortraitSteps.tsx";
import { buildSafePortraitCartResponse } from "../../src/server/cart/portraitCartService.ts";
import {
  credential,
  makeCart,
  makeSnapshot,
  makePaymentHarness,
  expiry,
} from "./portrait-payment-fixture.mjs";
import { hashCheckoutIntentToken } from "../../src/server/checkout-intents/checkoutIntentCredentials.ts";

const serverRequest = (cart, snapshot = null, status = "draft") => ({
  payload: {
    findByID: async () => ({
      id: 81,
      accessTokenHash: hashCheckoutIntentToken(credential.rawToken),
      expiresAt: expiry,
      status,
      amountCents: cart.portraits.reduce((s, p) => s + p.amountCents, 0),
      portraitPaymentSnapshot: snapshot,
      shippingAmountCents: snapshot?.shipping.amountCents,
      totalAmountCents: snapshot?.totalCents,
    }),
    count: async () => ({ totalDocs: cart.portraits.length }),
  },
});

test("read-only recovery distinguishes legacy/draft/pending/paid without provider calls or private content", async () => {
  const cart = makeCart();
  const draft = await readServer({ credential, request: serverRequest(cart) });
  assert.deepEqual(draft, {
    status: "draft",
    checkoutKind: "portrait",
    shippingRegion: null,
    totalAmountCents: null,
  });
  const legacy = await readServer({
    credential,
    request: serverRequest({ portraits: [] }),
  });
  assert.equal(legacy.checkoutKind, "legacy");
  for (const status of [
    "checkout_pending",
    "checkout_created",
    "completed",
    "expired",
  ]) {
    const r = await readServer({
      credential,
      request: serverRequest(cart, makeSnapshot("international", cart), status),
    });
    assert.equal(r.status, status);
    assert.equal(r.shippingRegion, "international");
    assert.equal(r.totalAmountCents, 5500);
    assert.doesNotMatch(
      JSON.stringify(r),
      /Synthetic|subject|note|filename|token|template|preview/i,
    );
  }
});

test("client recovery rejects malformed/private/contradictory contracts and handles expiry", async () => {
  const good = {
    status: "checkout_pending",
    checkoutKind: "portrait",
    shippingRegion: "us",
    totalAmountCents: 5000,
  };
  assert.equal(
    (await readClient({ fetchImpl: async () => Response.json(good) })).kind,
    "ready",
  );
  for (const bad of [
    { ...good, private: "not allowed" },
    { ...good, status: "paid" },
    { ...good, shippingRegion: null },
    { ...good, checkoutKind: "legacy" },
    { ...good, totalAmountCents: 1.5 },
    { ...good, status: "draft" },
  ])
    assert.equal(
      (await readClient({ fetchImpl: async () => Response.json(bad) })).kind,
      "failed",
    );
  assert.equal(
    (
      await readClient({
        fetchImpl: async () => new Response(null, { status: 401 }),
      })
    ).kind,
    "fresh",
  );
});

test("portrait payment sends exact consent/region once and accepts only controlled hosted redirect", async () => {
  let calls = 0;
  const fetchImpl = async (url, init) => {
    calls++;
    assert.ok(url.endsWith("/cart/checkout-session"));
    assert.deepEqual(JSON.parse(init.body), {
      policyAccepted: true,
      shippingRegion: "international",
    });
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.cache, "no-store");
    return Response.json({
      checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_synthetic",
      expiresAt: expiry,
    });
  };
  assert.equal(
    (await requestPortraitPayment("international", { fetchImpl })).kind,
    "ready",
  );
  assert.equal(calls, 1);
  assert.equal(
    (
      await requestPortraitPayment("us", {
        fetchImpl: async () =>
          Response.json({
            checkoutUrl: "https://evil.example",
            expiresAt: expiry,
          }),
      })
    ).kind,
    "failed",
  );
});

test("fixed-price draft creation does not consult legacy minimum and cannot overwrite an existing Intent", async () => {
  let amount;
  const req = {
    payload: {
      create: async ({ data }) => {
        amount = data.amountCents;
        return { id: 81, ...data };
      },
    },
  };
  await startPortraitDraft(req);
  assert.equal(amount, 2000);
  await assert.rejects(
    startPortraitDraft(serverRequest(makeCart()), credential),
    (e) => e.code === "CHECKOUT_ALREADY_EXISTS",
  );
  const r = new Request(
    "http://localhost:3000/api/storefront/checkout-intents/portrait-draft",
    {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "content-type": "application/json",
      },
      body: "{}",
    },
  );
  r.payload = { logger: { error: () => {} } };
  const response = await portraitDraftHandler(r, async () => ({
    credential,
    intent: { expiresAt: expiry },
  }));
  assert.equal(response.status, 201);
  assert.match(response.headers.get("set-cookie"), /HttpOnly/);
  assert.deepEqual(await response.json(), { status: "draft" });
  const get = new Request(
    "http://localhost:3000/api/storefront/checkout-intents/current/cart/recovery?token=x",
  );
  get.payload = r.payload;
  assert.equal(
    (
      await portraitRecoveryHandler(get, async () => {
        throw new Error("Must not run");
      })
    ).status,
    400,
  );
});

test("homepage and development preview use only connected portrait checkout without a rollout flag", async () => {
  const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");
  const [page, home, preview, modal, env, legacy] = await Promise.all([
    read("src/app/(frontend)/page.tsx"),
    read("src/features/photo-booth/components/PhotoBoothHome.tsx"),
    read("src/app/(frontend)/checkout/preview/page.tsx"),
    read("src/features/checkout/components/PortraitCheckoutModal.tsx"),
    read(".env.example"),
    read("src/app/(frontend)/checkout/legacy/page.tsx"),
  ]);
  assert.equal(home.match(/<PortraitCheckoutModal/g)?.length, 1);
  assert.doesNotMatch([page, home, preview, modal, env].join("\n"), /PHOTO_BOOTH_PORTRAIT_CHECKOUT_ENABLED|portraitCheckoutEnabled|ArtisticCheckoutModal|paymentEnabled/);
  assert.doesNotMatch(modal, /href="\/checkout\/legacy"/);
  assert.match(modal, /await requestCheckoutSession/);
  assert.match(modal, /abandonCurrentCheckout/);
  assert.match(modal, /View order status/);
  assert.match(legacy, /redirect\("\/"\)/);
  assert.match(preview, /process\.env\.NODE_ENV !== "development"/);
  for (const path of ["src/features/checkout/components/ArtisticCheckoutModal.tsx", "src/features/checkout/components/CheckoutAmountStep.tsx", "src/server/cart/portraitCheckoutRollout.ts"])
    await assert.rejects(read(path), { code: "ENOENT" });
});

test("cart payment needs policy and complete references; totals contain shipping exactly once", () => {
  const cart = makeCart();
  cart.portraits.forEach((p) =>
    Object.assign(p.template.previewMedia, { width: 600, height: 800 }),
  );
  const safe = buildSafePortraitCartResponse({
    intentAmountCents: 5000,
    portraits: cart.portraits,
    uploads: cart.uploads.map((u) => ({ ...u })),
  });
  const render = (accepted, c = safe) =>
    renderToStaticMarkup(
      React.createElement(CartStep, {
        cart: c,
        accepted,
        region: "international",
        edit: () => {},
        requestRemove: () => {},
        setRegion: () => {},
        setAccepted: () => {},
        pay: () => {},
      }),
    );
  assert.match(
    render(false),
    /<button[^>]*disabled=""[^>]*>Secure checkout/,
  );
  assert.doesNotMatch(
    render(true),
    /<button[^>]*disabled=""[^>]*>Secure checkout/,
  );
  assert.match(render(true), /\$55\.00/);
  const incomplete = structuredClone(safe);
  incomplete.portraits[0].photoState.complete = false;
  assert.match(
    render(true, incomplete),
    /<button[^>]*disabled=""[^>]*>Secure checkout/,
  );
  assert.doesNotMatch(render(true), /Payment opens after checkout integration|Development preview/);
});

test("confirmed draft abandonment locks/rechecks status, preserves photos and never contacts Stripe", async () => {
  for (const fail of [false, true]) {
    const h = makePaymentHarness();
    const baseline = h.state();
    const options = {
      request: h.request(),
      credential,
      dependencies: {
        authorizeIntent: async () => h.state().intent,
        testProbe: fail
          ? {
              afterFinalizationPersistence: () => {
                throw new Error("Synthetic rollback");
              },
            }
          : {},
      },
    };
    if (fail) {
      await assert.rejects(abandonStripeCheckoutSession(options));
      assert.deepEqual(h.state(), baseline);
    } else {
      await abandonStripeCheckoutSession(options);
      assert.equal(h.state().intent.status, "expired");
      assert.deepEqual(h.state().uploads, baseline.uploads);
    }
  }
  const h = makePaymentHarness({
    snapshot: makeSnapshot(),
    status: "checkout_pending",
  });
  await assert.rejects(
    abandonStripeCheckoutSession({
      request: h.request(),
      credential,
      dependencies: { authorizeIntent: async () => ({ status: "draft" }) },
    }),
    (e) => e.code === "CHECKOUT_PROCESSING",
  );
  assert.equal(h.state().intent.status, "checkout_pending");
});

test("artist workbench renders all fifteen references grouped with immutable subjects/notes", async () => {
  const cart = makeCart(5, 3),
    s = makeSnapshot("us", cart);
  const order = {
    id: 900,
    customer: 1,
    checkoutIntent: 81,
    amountCents: 16000,
    portraitPaymentFacts: {
      shipping: s.shipping,
      subtotalCents: 15000,
      totalCents: 16000,
      portraitCount: 5,
    },
    contactEmail: "synthetic@example.test",
    orderStatus: "unfulfilled",
    refundState: "none",
    refundedAmountCents: 0,
    createdAt: "2026-10-12T12:00:00Z",
    shippingAddress: {
      recipientName: "Synthetic",
      line1: "Synthetic",
      city: "Synthetic",
      country: "US",
    },
  };
  const req = {
    user: { collection: "users", id: 1 },
    payload: {
      findByID: async (q) =>
        q.collection === "orders"
          ? order
          : q.collection === "customers"
            ? { fullName: "Synthetic" }
            : {
                amountCents: 15000,
                shippingAmountCents: 1000,
                totalAmountCents: 16000,
              },
      find: async (q) => {
        assert.equal(q.overrideAccess, false);
        if (q.collection === "order-uploads") {
          assert.equal(q.limit, 16);
          return {
            docs: cart.uploads.map((u) => ({
              ...u,
              orderPortrait: u.checkoutPortrait + 1000,
            })),
          };
        }
        assert.equal(q.limit, 6);
        return {
          docs: s.portraits.map((p) => ({
            ...p,
            id: p.checkoutPortraitId + 1000,
          })),
        };
      },
    },
  };
  const data = await readOrderWorkbench({ orderId: 900, request: req });
  assert.equal(data.portraits.length, 5);
  assert.equal(data.uploads.length, 15);
  assert.equal(data.portraits[4].uploads.length, 3);
  assert.equal(data.shippingClass, "US tracked");
  const html = renderToStaticMarkup(
    React.createElement(OrderWorkbenchDetails, {
      data,
      error: null,
      pending: false,
      onSubmit: () => {},
    }),
  );
  assert.equal((html.match(/Download reference/g) ?? []).length, 15);
  assert.match(html, /Synthetic note 5/);
  assert.match(html, /Synthetic subject 3/);
  assert.doesNotMatch(html, /synthetic-0-0\.png|subjectIds|checkoutPortraitId/);
  await assert.rejects(
    readOrderWorkbench({ orderId: 900, request: { ...req, user: null } }),
  );
});

test("paid template bytes require artist auth and paid-portrait ownership, even if catalog is hidden", async () => {
  let opened = 0;
  const handler = createAdminPortraitTemplateHandler(async () => {
    opened++;
    return {
      contentType: "image/png",
      contentLength: 3,
      stream: new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array([1, 2, 3]));
          c.close();
        },
      }),
    };
  });
  const request = {
    user: { collection: "users", id: 1 },
    url: "http://localhost/api/admin/orders/9/portraits/1/template-preview",
    routeParams: { orderId: "9", portraitId: "1" },
    payload: {
      find: async (q) => {
        assert.equal(q.overrideAccess, false);
        assert.equal(q.where.and[1].order.equals, 9);
        return { docs: [{ templatePreviewMedia: 401 }] };
      },
      findByID: async (q) => {
        assert.equal(q.overrideAccess, false);
        return {
          filename: "synthetic.png",
          prefix: "template-media",
          filesize: 3,
          mimeType: "image/png",
        };
      },
    },
  };
  const response = await handler(request);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal((await response.arrayBuffer()).byteLength, 3);
  assert.equal(opened, 1);
  assert.equal((await handler({ ...request, user: null })).status, 401);
  assert.equal(
    (
      await handler({
        ...request,
        payload: { ...request.payload, find: async () => ({ docs: [] }) },
      })
    ).status,
    404,
  );
  assert.equal(opened, 1);
});
