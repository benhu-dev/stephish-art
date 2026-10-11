import assert from "node:assert/strict";
import test from "node:test";

import { uploadPortraitReference } from "../../src/server/cart/portraitUploadService.ts";
import { hashCheckoutIntentToken } from "../../src/server/checkout-intents/checkoutIntentCredentials.ts";
import { StorefrontApiError } from "../../src/server/storefront/storefrontApiError.ts";

const portraitId = "a9f42c44-5a8b-4c2d-9431-66bd108cf261";
const subjectId = "26613a1d-6cc0-4778-9508-a6cb60af9a32";
const credential = { intentId: 17, rawToken: "A".repeat(43) };
const intent = {
  amountCents: 2_000,
  checkoutAttemptId: null,
  checkoutStartedAt: null,
  deleteAfter: "2026-10-12T00:00:00.000Z",
  expiresAt: "2099-10-11T00:00:00.000Z",
  id: 17,
  shippingAmountCents: null,
  status: "draft",
  stripeCheckoutSessionExpiresAt: null,
  stripeCheckoutSessionId: null,
  totalAmountCents: null,
};

const harness = ({ insertRows = [{ id: 88 }], mappedSubject = subjectId } = {}) => {
  const events = [];
  let query = 0;
  const transaction = {
    database: {
      execute: async () => {
        query += 1;
        if (query === 1) return { rows: [{ id: 91 }] };
        if (query === 2) {
          return { rows: [{ position: 1, subject_id: subjectId }] };
        }
        if (query === 3) return { rows: [] };
        if (query === 4) return { rows: insertRows };
        throw new Error("UNEXPECTED_QUERY");
      },
    },
    id: "tx",
    request: {},
    session: {},
  };
  const providerDependencies = {
    compensateObject: async () => events.push("compensate"),
    deleteObject: async () => events.push("delete-object"),
    normalizeImage: async () => {
      events.push("normalize");
      return {
        data: Buffer.from("normalized"),
        extension: "jpg",
        height: 1200,
        mimeType: "image/jpeg",
        size: 10,
        width: 800,
      };
    },
    openObject: async () => {
      throw new Error("UNEXPECTED_OPEN");
    },
    readObject: async () => {
      throw new Error("UNEXPECTED_READ");
    },
    restoreObject: async () => events.push("restore"),
    writeObject: async ({ contentType, data, filename }) => {
      events.push("write");
      assert.equal(contentType, "image/jpeg");
      assert.equal(data.toString(), "normalized");
      assert.match(filename, /^[0-9a-f-]{36}\.jpg$/);
    },
  };
  const transactionDependencies = {
    begin: async () => {
      events.push("begin");
      return transaction;
    },
    commit: async () => events.push("commit"),
    lock: async () => {
      events.push("lock");
      return structuredClone(intent);
    },
    rollback: async () => events.push("rollback"),
  };
  const request = {
    payload: {
      findByID: async () => {
        events.push("find:checkout-intents");
        return {
          ...structuredClone(intent),
          accessTokenHash: hashCheckoutIntentToken(credential.rawToken),
          artistNote: null,
        };
      },
      find: async (options) => {
        events.push(`find:${options.collection}`);
        return {
          docs:
            options.collection === "checkout-portraits"
              ? [{ id: 91, publicId: portraitId }]
              : [],
        };
      },
      logger: { error: () => events.push("log") },
    },
  };
  return {
    events,
    input: {
      credential,
      file: { data: Buffer.from("source"), mimetype: "image/jpeg", size: 6 },
      metadata: { position: 1, subjectIds: [mappedSubject] },
      portraitPublicId: portraitId,
      providerDependencies,
      request,
      transactionDependencies,
    },
    queryCount: () => query,
  };
};

test("portrait upload authorizes before image work, writes Storage outside the transaction, then persists", async () => {
  const fixture = harness();
  await uploadPortraitReference(fixture.input);
  assert.deepEqual(fixture.events, [
    "find:checkout-intents",
    "find:checkout-portraits",
    "normalize",
    "write",
    "begin",
    "lock",
    "commit",
  ]);
  assert.equal(fixture.queryCount(), 4);
});

test("a persistence failure rolls back and compensates the newly written object", async () => {
  const fixture = harness({ insertRows: [] });
  await assert.rejects(
    uploadPortraitReference(fixture.input),
    (error) =>
      error instanceof StorefrontApiError &&
      error.code === "UPLOAD_PERSISTENCE_FAILED",
  );
  assert.deepEqual(fixture.events.slice(-2), ["rollback", "compensate"]);
});

test("an unknown subject mapping is rejected after revalidation and leaves no object", async () => {
  const fixture = harness({
    mappedSubject: "bd28f154-20b3-4c69-9487-23869997dd76",
  });
  await assert.rejects(
    uploadPortraitReference(fixture.input),
    (error) =>
      error instanceof StorefrontApiError &&
      error.code === "UNKNOWN_PHOTO_SUBJECT",
  );
  assert.deepEqual(fixture.events.slice(-2), ["rollback", "compensate"]);
  assert.equal(fixture.queryCount(), 3);
});
