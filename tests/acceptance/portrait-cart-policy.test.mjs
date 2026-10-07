import assert from "node:assert/strict";
import test from "node:test";

import {
  PORTRAIT_CART_POLICY,
  calculateCartSubtotalCents,
  calculatePortraitAmountCents,
  parsePortraitCreateRequest,
  parsePortraitReplaceRequest,
  parsePortraitReorderRequest,
  resolvePortraitSubjects,
  validatePhotoSubjectMappings,
} from "../../src/server/cart/portraitCartPolicy.ts";
import { buildOrderPortraitSnapshot } from "../../src/server/cart/orderPortraitSnapshot.ts";

const subject = (name, kind = "person") => ({ kind, name });

test("portrait prices and cart totals are server-owned integer cents", () => {
  assert.deepEqual(PORTRAIT_CART_POLICY, {
    additionalSubjectAmountCents: 500,
    baseAmountCents: 2000,
    maximumPortraits: 5,
    maximumSubjectNameCharacters: 80,
    maximumSubjectsPerPortrait: 3,
    minimumPortraits: 1,
    minimumSubjectsPerPortrait: 1,
  });
  assert.equal(calculatePortraitAmountCents(1), 2000);
  assert.equal(calculatePortraitAmountCents(2), 2500);
  assert.equal(calculatePortraitAmountCents(3), 3000);
  assert.equal(calculateCartSubtotalCents([2000, 2500, 3000]), 7500);

  for (const count of [0, 4, 1.5, "2", Number.NaN]) {
    assert.throws(() => calculatePortraitAmountCents(count));
  }
  assert.throws(() => calculateCartSubtotalCents([]));
  assert.throws(() => calculateCartSubtotalCents([2000, 2001]));
  assert.throws(() =>
    calculateCartSubtotalCents([2000, 2000, 2000, 2000, 2000, 2000]),
  );
});

test("portrait request parsing accepts only the narrow customer contract", () => {
  assert.deepEqual(
    parsePortraitCreateRequest({
      artistNote: "  Draw the red collar.  ",
      subjects: [subject("  Mochi  ", "pet")],
      templateId: 4,
    }),
    {
      artistNote: "Draw the red collar.",
      subjects: [{ kind: "pet", name: "Mochi" }],
      templateId: 4,
    },
  );

  const existingId = "a9f42c44-5a8b-4c2d-9431-66bd108cf261";
  assert.deepEqual(
    parsePortraitReplaceRequest({
      artistNote: "",
      subjects: [
        { id: existingId, kind: "person", name: "Steph" },
        subject("Mochi", "pet"),
      ],
      templateId: 5,
    }),
    {
      artistNote: null,
      subjects: [
        { id: existingId, kind: "person", name: "Steph" },
        { kind: "pet", name: "Mochi" },
      ],
      templateId: 5,
    },
  );

  for (const value of [
    null,
    [],
    {},
    { artistNote: "", subjects: [subject("A")], templateId: 1, amountCents: 1 },
    { artistNote: "", subjects: [], templateId: 1 },
    { artistNote: "", subjects: [subject("A"), subject("B"), subject("C"), subject("D")], templateId: 1 },
    { artistNote: "", subjects: [{ kind: "cat", name: "A" }], templateId: 1 },
    { artistNote: "", subjects: [subject(" ")], templateId: 1 },
    { artistNote: "", subjects: [subject("A")], templateId: "1" },
  ]) {
    assert.throws(() => parsePortraitCreateRequest(value));
  }
});

test("subject identities remain stable and new identities are server-issued", () => {
  const firstId = "a9f42c44-5a8b-4c2d-9431-66bd108cf261";
  const issued = [
    "26613a1d-6cc0-4778-9508-a6cb60af9a32",
    "bd28f154-20b3-4c69-9487-23869997dd76",
  ];
  const subjects = resolvePortraitSubjects({
    existingSubjects: [
      { kind: "person", name: "Old name", position: 1, subjectId: firstId },
    ],
    issueId: () => issued.shift(),
    requestedSubjects: [
      { id: firstId, kind: "person", name: "New name" },
      { kind: "pet", name: "Mochi" },
    ],
  });

  assert.deepEqual(subjects, [
    { kind: "person", name: "New name", position: 1, subjectId: firstId },
    {
      kind: "pet",
      name: "Mochi",
      position: 2,
      subjectId: "26613a1d-6cc0-4778-9508-a6cb60af9a32",
    },
  ]);
  assert.throws(() =>
    resolvePortraitSubjects({
      existingSubjects: [],
      requestedSubjects: [
        { id: firstId, kind: "person", name: "Unknown identity" },
      ],
    }),
  );
});

test("photo mappings allow group photos but require complete known-subject coverage", () => {
  const first = "a9f42c44-5a8b-4c2d-9431-66bd108cf261";
  const second = "26613a1d-6cc0-4778-9508-a6cb60af9a32";
  const third = "bd28f154-20b3-4c69-9487-23869997dd76";

  assert.deepEqual(
    validatePhotoSubjectMappings({
      photoSubjectIds: [[first, second, third]],
      subjectIds: [first, second, third],
    }),
    [[first, second, third]],
  );
  assert.deepEqual(
    validatePhotoSubjectMappings({
      photoSubjectIds: [[first], [second], [third]],
      subjectIds: [first, second, third],
    }),
    [[first], [second], [third]],
  );

  for (const photoSubjectIds of [
    [],
    [[first], [second], [third], [first]],
    [[first], [second]],
    [[first, first], [second], [third]],
    [[first], [second], ["4d5f3366-20a3-4e96-856d-c063289c6693"]],
  ]) {
    assert.throws(() =>
      validatePhotoSubjectMappings({
        photoSubjectIds,
        subjectIds: [first, second, third],
      }),
    );
  }
});

test("reorder requests contain each unique portrait identity once", () => {
  const ids = [
    "a9f42c44-5a8b-4c2d-9431-66bd108cf261",
    "26613a1d-6cc0-4778-9508-a6cb60af9a32",
  ];
  assert.deepEqual(parsePortraitReorderRequest({ portraitIds: ids }), {
    portraitIds: ids,
  });
  for (const value of [
    { portraitIds: [] },
    { portraitIds: [ids[0], ids[0]] },
    { portraitIds: [...ids, ids[0], ids[1], ids[0], ids[1]] },
    { portraitIds: ["not-a-uuid"] },
    { portraitIds: ids, amountCents: 4000 },
  ]) {
    assert.throws(() => parsePortraitReorderRequest(value));
  }
});

test("paid portrait snapshots copy immutable template and subject facts", () => {
  const portrait = {
    amountCents: 2500,
    artistNote: "Keep the blue scarf",
    position: 1,
    publicId: "a9f42c44-5a8b-4c2d-9431-66bd108cf261",
    subjects: [
      {
        kind: "person",
        name: "Steph",
        position: 1,
        subjectId: "26613a1d-6cc0-4778-9508-a6cb60af9a32",
      },
      {
        kind: "pet",
        name: "Mochi",
        position: 2,
        subjectId: "bd28f154-20b3-4c69-9487-23869997dd76",
      },
    ],
    template: {
      description: "A blue city frame",
      id: 8,
      name: "City Blue",
      previewMedia: { alt: "Blue postcard frame", id: 12 },
    },
  };
  const snapshot = buildOrderPortraitSnapshot({ orderId: 22, portrait });
  portrait.template.name = "Changed later";
  portrait.subjects[0].name = "Changed later";

  assert.deepEqual(snapshot, {
    amountCents: 2500,
    artistNote: "Keep the blue scarf",
    order: 22,
    position: 1,
    sourceCheckoutPortraitId: portrait.publicId,
    subjects: [
      {
        kind: "person",
        name: "Steph",
        position: 1,
        subjectId: "26613a1d-6cc0-4778-9508-a6cb60af9a32",
      },
      {
        kind: "pet",
        name: "Mochi",
        position: 2,
        subjectId: "bd28f154-20b3-4c69-9487-23869997dd76",
      },
    ],
    templateDescription: "A blue city frame",
    templateId: 8,
    templateName: "City Blue",
    templatePreviewAlt: "Blue postcard frame",
    templatePreviewMedia: 12,
  });
});
