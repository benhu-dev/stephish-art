import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { CheckoutIntents } from "../../src/collections/CheckoutIntents.ts";
import { Orders } from "../../src/collections/Orders.ts";
import {
  MAX_ARTIST_NOTE_CHARACTERS,
  normalizeArtistNote,
  parseArtistNoteRequest,
} from "../../src/server/storefront/artistNote.ts";
import { buildSafeCheckoutIntentResponse } from "../../src/server/storefront/checkoutIntentApiContract.ts";
import { storefrontCheckoutIntentEndpoints } from "../../src/server/storefront/checkoutIntentEndpoints.ts";
import { saveCheckoutArtistNote } from "../../src/features/checkout/checkoutIntentClient.ts";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");
const fieldsByName = (collection) => Object.fromEntries(
  collection.fields.map((field) => [field.name, field]),
);

test("artist note normalization preserves private text with the exact 1,000-character contract", () => {
  assert.equal(MAX_ARTIST_NOTE_CHARACTERS, 1_000);
  assert.equal(normalizeArtistNote("  hello\r\nworld  "), "hello\nworld");
  assert.equal(normalizeArtistNote("  \r\n  "), null);
  assert.equal(normalizeArtistNote(" café 🎨\r\n第二行 "), "café 🎨\n第二行");
  assert.equal(normalizeArtistNote("x".repeat(1_000)), "x".repeat(1_000));
  assert.throws(() => normalizeArtistNote("x".repeat(1_001)));
});

test("artist note JSON accepts exactly one string field and rejects invalid shapes", () => {
  assert.deepEqual(parseArtistNoteRequest({ artistNote: "  line 1\r\nline 2  " }), {
    artistNote: "line 1\nline 2",
  });
  assert.deepEqual(parseArtistNoteRequest({ artistNote: " \n " }), {
    artistNote: null,
  });
  for (const value of [
    {},
    { artistNote: null },
    { artistNote: 42 },
    { artistNote: "ok", extra: true },
    { artistNote: "x".repeat(1_001) },
    [],
    null,
  ]) assert.throws(() => parseArtistNoteRequest(value));
});

test("Checkout Intent and Order fields are bounded private text and the Order snapshot is immutable", async () => {
  const intentNote = fieldsByName(CheckoutIntents).artistNote;
  const orderNote = fieldsByName(Orders).artistNote;
  assert.equal(intentNote.type, "textarea");
  assert.equal(intentNote.maxLength, 1_000);
  assert.equal(orderNote.type, "textarea");
  assert.equal(orderNote.maxLength, 1_000);
  assert.equal(await orderNote.access.update(), false);
  assert.match(orderNote.admin.description, /snapshot/i);
});

test("safe authenticated Intent state includes only the normalized note value", () => {
  const response = buildSafeCheckoutIntentResponse({
    intent: {
      accessTokenHash: "a".repeat(64),
      amountCents: 725,
      artistNote: null,
      expiresAt: "2026-09-25T00:00:00.000Z",
      status: "draft",
    },
    minimumAmountCents: 500,
    uploads: [],
  });
  assert.equal(response.artistNote, "");
  assert.equal(JSON.stringify(response).includes("accessTokenHash"), false);
});

test("artist note endpoint and browser client use the exact private no-store contract", async () => {
  assert.equal(
    storefrontCheckoutIntentEndpoints.some(({ method, path }) =>
      method === "put" && path === "/storefront/checkout-intents/current/artist-note"),
    true,
  );
  const calls = [];
  const result = await saveCheckoutArtistNote("  <b>ordinary text</b>  ", {
    fetchImpl: async (...args) => {
      calls.push(args);
      return Response.json({ artistNote: "<b>ordinary text</b>" });
    },
  });
  assert.deepEqual(result, { ok: true, value: { artistNote: "<b>ordinary text</b>" } });
  assert.deepEqual(calls, [[
    "/api/storefront/checkout-intents/current/artist-note",
    {
      body: JSON.stringify({ artistNote: "  <b>ordinary text</b>  " }),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "PUT",
    },
  ]]);
});

test("modal persists, restores, clears, and reviews the server-confirmed note as React text", async () => {
  const [client, modal, photo, review, stripe] = await Promise.all([
    read("src/features/checkout/checkoutIntentClient.ts"),
    read("src/features/checkout/components/ArtisticCheckoutModal.tsx"),
    read("src/features/checkout/components/CheckoutPhotoStep.tsx"),
    read("src/features/checkout/components/CheckoutReviewStep.tsx"),
    read("src/server/stripe/stripeCheckoutGateway.ts"),
  ]);
  assert.match(modal, /saveCheckoutArtistNote/);
  assert.match(modal, /confirmedNote/);
  assert.match(modal, /result\.value\.artistNote/);
  assert.match(photo, /maxLength=\{MAX_ARTIST_NOTE_CHARACTERS\}/);
  assert.match(review, /artistNote/);
  assert.doesNotMatch(review, /dangerouslySetInnerHTML|markdown/i);
  assert.doesNotMatch(`${client}\n${modal}`, /localStorage|sessionStorage|document\.cookie/);
  assert.doesNotMatch(stripe, /artistNote|artist_note/);
});

test("focused migration adds and removes only the two nullable note columns", async () => {
  const [migration, index] = await Promise.all([
    read("src/migrations/20260924_075033_persist_artist_note.ts"),
    read("src/migrations/index.ts"),
  ]);
  assert.match(migration, /ALTER TABLE "orders" ADD COLUMN "artist_note" varchar/);
  assert.match(migration, /ALTER TABLE "checkout_intents" ADD COLUMN "artist_note" varchar/);
  assert.match(migration, /ALTER TABLE "orders" DROP COLUMN "artist_note"/);
  assert.match(migration, /ALTER TABLE "checkout_intents" DROP COLUMN "artist_note"/);
  assert.doesNotMatch(migration, /CREATE TABLE|DROP TABLE|customer|stripe|upload/i);
  assert.match(index, /20260924_075033_persist_artist_note/);
});
