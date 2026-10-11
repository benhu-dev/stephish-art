import assert from "node:assert/strict";
import test from "node:test";

import {
  PORTRAIT_UPLOAD_POLICY,
  assertPortraitSubjectEditCompatible,
  assertPortraitUploadCapacity,
  parsePortraitUploadMetadata,
  validatePortraitPhotoSet,
} from "../../src/server/cart/portraitUploadPolicy.ts";
import { StorefrontApiError } from "../../src/server/storefront/storefrontApiError.ts";

const subjectA = "7bf8dd08-5ddd-48a8-85d7-e9e9d9378e24";
const subjectB = "1f3a58ad-6286-4477-8714-8232152025d2";

test("portrait upload policy exposes the approved storage limits", () => {
  assert.deepEqual(PORTRAIT_UPLOAD_POLICY, {
    maximumBytesPerCart: 100 * 1024 * 1024,
    maximumBytesPerPortrait: 30 * 1024 * 1024,
    maximumFilesPerCart: 15,
    maximumFilesPerPortrait: 3,
    maximumPixels: 50_000_000,
    perFileUploadLimitBytes: 15 * 1024 * 1024,
  });
});

test("upload metadata accepts one group photo mapping and rejects extra authority", () => {
  assert.deepEqual(
    parsePortraitUploadMetadata({
      position: 1,
      subjectIds: [subjectA, subjectB],
    }),
    { position: 1, subjectIds: [subjectA, subjectB] },
  );
  assert.throws(
    () =>
      parsePortraitUploadMetadata({
        amountCents: 1,
        position: 1,
        subjectIds: [subjectA],
      }),
    (error) =>
      error instanceof StorefrontApiError && error.code === "INVALID_REQUEST",
  );
});

test("photo sets allow incomplete drafts but calculate subject coverage", () => {
  assert.deepEqual(
    validatePortraitPhotoSet({
      photos: [
        {
          filesize: 1_000,
          id: 10,
          position: 1,
          subjectIds: [subjectA],
        },
      ],
      subjectIds: [subjectA, subjectB],
    }),
    { coveredSubjectIds: [subjectA], complete: false, totalBytes: 1_000 },
  );
  assert.deepEqual(
    validatePortraitPhotoSet({
      photos: [
        {
          filesize: 1_000,
          id: 10,
          position: 1,
          subjectIds: [subjectA, subjectB],
        },
      ],
      subjectIds: [subjectA, subjectB],
    }),
    {
      coveredSubjectIds: [subjectA, subjectB],
      complete: true,
      totalBytes: 1_000,
    },
  );
});

test("photo sets reject unknown subjects, gaps, excess photos, and byte overflow", () => {
  const invalidCases = [
    {
      photos: [
        { filesize: 1, id: 1, position: 2, subjectIds: [subjectA] },
      ],
      subjectIds: [subjectA],
    },
    {
      photos: [
        { filesize: 1, id: 1, position: 1, subjectIds: [subjectB] },
      ],
      subjectIds: [subjectA],
    },
    {
      photos: [
        { filesize: 1, id: 1, position: 1, subjectIds: [subjectA] },
        { filesize: 1, id: 2, position: 2, subjectIds: [subjectA] },
      ],
      subjectIds: [subjectA],
    },
    {
      photos: [
        {
          filesize: PORTRAIT_UPLOAD_POLICY.maximumBytesPerPortrait + 1,
          id: 1,
          position: 1,
          subjectIds: [subjectA],
        },
      ],
      subjectIds: [subjectA],
    },
  ];

  for (const input of invalidCases) {
    assert.throws(
      () => validatePortraitPhotoSet(input),
      (error) => error instanceof StorefrontApiError,
    );
  }
});

test("capacity accounts for stored normalized bytes across portrait and cart", () => {
  assert.doesNotThrow(() =>
    assertPortraitUploadCapacity({
      cartFiles: 14,
      cartStoredBytes: PORTRAIT_UPLOAD_POLICY.maximumBytesPerCart - 100,
      incomingStoredBytes: 100,
      portraitFiles: 2,
      portraitStoredBytes:
        PORTRAIT_UPLOAD_POLICY.maximumBytesPerPortrait - 100,
      subjectCount: 3,
    }),
  );

  for (const overrides of [
    { cartFiles: 15 },
    { portraitFiles: 2, subjectCount: 2 },
    {
      incomingStoredBytes: 101,
      portraitStoredBytes:
        PORTRAIT_UPLOAD_POLICY.maximumBytesPerPortrait - 100,
    },
    {
      cartStoredBytes: PORTRAIT_UPLOAD_POLICY.maximumBytesPerCart - 100,
      incomingStoredBytes: 101,
    },
  ]) {
    assert.throws(
      () =>
        assertPortraitUploadCapacity({
          cartFiles: 14,
          cartStoredBytes: 1,
          incomingStoredBytes: 1,
          portraitFiles: 1,
          portraitStoredBytes: 1,
          subjectCount: 3,
          ...overrides,
        }),
      (error) => error instanceof StorefrontApiError,
    );
  }
});

test("subject edits cannot orphan an existing photo mapping", () => {
  assert.throws(
    () =>
      assertPortraitSubjectEditCompatible({
        photos: [
          {
            filesize: 1_000,
            id: 10,
            position: 1,
            subjectIds: [subjectB],
          },
        ],
        subjectIds: [subjectA],
      }),
    (error) =>
      error instanceof StorefrontApiError &&
      error.status === 409 &&
      error.code === "PORTRAIT_UPLOAD_MAPPING_CONFLICT",
  );
});
