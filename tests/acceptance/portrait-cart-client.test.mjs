import assert from "node:assert/strict";
import test from "node:test";
import { buildSafePortraitCartResponse } from "../../src/server/cart/portraitCartService.ts";
import {
  cartReady,
  changePortraitPhoto,
  parsePortraitCart,
  parseTemplateCatalog,
  readCart,
  readPreviewIntent,
  savePortrait,
  uploadPortraitPhoto,
  validateNewPhoto,
} from "../../src/features/checkout/portraitCartClient.ts";

const portraitId = "11111111-1111-4111-8111-111111111111";
const subjectId = "22222222-2222-4222-8222-222222222222";
const secondSubject = "33333333-3333-4333-8333-333333333333";
const template = {
  id: 1,
  available: true,
  name: "Park",
  description: null,
  previewMedia: { id: 1, alt: "Park frame", width: 600, height: 800 },
};
const makeCart = (group = false) =>
  buildSafePortraitCartResponse({
    intentAmountCents: group ? 2500 : 2000,
    portraits: [
      {
        id: 10,
        publicId: portraitId,
        position: 1,
        amountCents: group ? 2500 : 2000,
        artistNote: "A striped scarf",
        template,
        subjects: [
          { subjectId, name: "Alex", kind: "person", position: 1 },
          ...(group
            ? [
                {
                  subjectId: secondSubject,
                  name: "Mochi",
                  kind: "pet",
                  position: 2,
                },
              ]
            : []),
        ],
      },
    ],
    uploads: [
      {
        id: 31,
        checkoutPortrait: 10,
        filesize: 200,
        height: 100,
        width: 100,
        position: 1,
        mimeType: "image/png",
        subjectIds: group ? [subjectId, secondSubject] : [subjectId],
      },
    ],
  });

test("parses real server recovery contracts and group-photo coverage", () => {
  const cart = makeCart(true);
  assert.deepEqual(parsePortraitCart(cart), cart);
  assert.equal(cartReady(cart), true);
  assert.equal(cart.portraits[0].amountCents, 2500);
  const empty = buildSafePortraitCartResponse({
    intentAmountCents: 2000,
    portraits: [],
  });
  assert.ok(parsePortraitCart(empty));
  assert.equal(cartReady(empty), false);
});

test("rejects unsafe URLs, extra fields, inconsistent readiness, amounts and identities", () => {
  const mutations = [
    (c) => {
      c.portraits[0].photos[0].previewUrl = "https://evil.example/photo";
    },
    (c) => {
      c.portraits[0].template.preview.url += "?token=secret";
    },
    (c) => {
      c.portraits[0].photos[0].objectKey = "private";
    },
    (c) => {
      c.portraits[0].photoState.complete = false;
    },
    (c) => {
      c.portraits[0].photos[0].subjectIds = [secondSubject];
    },
    (c) => {
      c.portraits[0].amountCents = 1;
    },
    (c) => {
      c.subtotalCents = 1;
    },
    (c) => {
      c.portraits.push(c.portraits[0]);
    },
    (c) => {
      c.portraits[0].photoState.totalBytes = 1;
    },
  ];
  for (const mutate of mutations) {
    const c = makeCart();
    mutate(c);
    assert.equal(parsePortraitCart(c), null);
  }
});

test("catalog permits empty results but rejects duplicate IDs and external previews", () => {
  assert.deepEqual(parseTemplateCatalog({ templates: [] }), []);
  const t = makeCart().portraits[0].template;
  delete t.available;
  assert.ok(parseTemplateCatalog({ templates: [t] }));
  assert.equal(parseTemplateCatalog({ templates: [t, t] }), null);
  t.preview.url = "//evil.example/art";
  assert.equal(parseTemplateCatalog({ templates: [t] }), null);
});

test("mutations send exact same-origin no-store contracts and stable subject IDs", async () => {
  const calls = [];
  const options = {
    fetchImpl: async (path, init) => {
      calls.push({ path, init });
      return Response.json(makeCart());
    },
  };
  const input = {
    templateId: 1,
    subjects: [{ id: subjectId, kind: "person", name: "Alex" }],
    artistNote: "A scarf",
  };
  assert.equal((await savePortrait(input, portraitId, options)).kind, "ready");
  assert.deepEqual(JSON.parse(calls[0].init.body), input);
  assert.equal(calls[0].init.method, "PUT");
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.equal(calls[0].init.cache, "no-store");
  await changePortraitPhoto(
    portraitId,
    31,
    { position: 1, subjectIds: [subjectId] },
    options,
  );
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    position: 1,
    subjectIds: [subjectId],
  });
  const file = new File(["test"], "private.png", { type: "image/png" });
  await uploadPortraitPhoto(
    portraitId,
    file,
    { position: 1, subjectIds: [subjectId] },
    options,
  );
  assert.deepEqual([...calls[2].init.body.keys()].sort(), ["_payload", "file"]);
  assert.equal(
    calls[2].init.headers,
    undefined,
    "browser must set multipart boundary",
  );
  assert.equal(
    calls.some((c) => c.path.includes("checkout-session")),
    false,
  );
});

test("uncertain writes never automatically retry and expired reads are distinct", async () => {
  let calls = 0;
  const options = {
    fetchImpl: async () => {
      calls++;
      throw new Error("NETWORK");
    },
  };
  assert.equal(
    (
      await savePortrait(
        {
          templateId: 1,
          subjects: [{ kind: "person", name: "Alex" }],
          artistNote: "",
        },
        undefined,
        options,
      )
    ).kind,
    "uncertain",
  );
  assert.equal(calls, 1);
  assert.equal(
    (
      await readCart({
        fetchImpl: async () => new Response(null, { status: 410 }),
      })
    ).kind,
    "fresh",
  );
  assert.equal((await readCart(options)).kind, "failed");
  const abort = new AbortController();
  abort.abort();
  assert.equal(
    (await readCart({ ...options, signal: abort.signal })).kind,
    "aborted",
  );
});

test("reads status without Stripe recovery or a legacy three-photo parsing limit", async () => {
  let endpoint;
  const r = await readPreviewIntent({
    fetchImpl: async (path) => {
      endpoint = path;
      return Response.json({
        status: "draft",
        amountCents: 10000,
        uploads: Array(15).fill({}),
      });
    },
  });
  assert.equal(endpoint, "/api/storefront/checkout-intents/current");
  assert.deepEqual(r, {
    kind: "ready",
    value: { status: "draft", hasUploads: true },
  });
});

test("client selection hints enforce file/count/budget but server still owns acceptance", () => {
  const cart = makeCart(true);
  const p = cart.portraits[0];
  assert.equal(
    validateNewPhoto(new File(["x"], "x.png", { type: "image/png" }), p, cart, [
      subjectId,
    ]),
    null,
  );
  assert.match(
    validateNewPhoto(new File(["x"], "x.gif", { type: "image/gif" }), p, cart, [
      subjectId,
    ]),
    /JPEG/,
  );
  assert.match(
    validateNewPhoto(
      new File(["x"], "x.png", { type: "image/png" }),
      p,
      cart,
      [],
    ),
    /Choose who/,
  );
  assert.match(
    validateNewPhoto(
      new File([new Uint8Array(15 * 1024 * 1024 + 1)], "x.png", {
        type: "image/png",
      }),
      p,
      cart,
      [subjectId],
    ),
    /15 MiB/,
  );
  const one = makeCart();
  assert.match(
    validateNewPhoto(
      new File(["x"], "x.png", { type: "image/png" }),
      one.portraits[0],
      one,
      [subjectId],
    ),
    /one photo/,
  );
});
