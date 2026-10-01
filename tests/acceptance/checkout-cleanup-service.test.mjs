import assert from "node:assert/strict";
import test from "node:test";

import { runCheckoutCleanup } from "../../src/server/checkout-cleanup/checkoutCleanupService.ts";

const now = new Date("2026-09-27T10:00:00.000Z");
const due = "2026-09-27T09:00:00.000Z";
const future = "2026-09-27T11:00:00.000Z";

const candidate = (overrides = {}) => ({
  deleteAfter: due,
  id: 41,
  status: "draft",
  stripeCheckoutSessionId: null,
  ...overrides,
});

const lockedState = (overrides = {}) => ({
  ...candidate(),
  hasOrder: false,
  uploads: [{ filename: "private-object", id: 71, orderId: null }],
  ...overrides,
});

const lockFor = (state, sequence, options = {}) => ({
  commit: async () => sequence.push("commit"),
  deleteIntent: async () => {
    sequence.push("intent");
    return options.intentDeleted ?? true;
  },
  deleteUploads: async () => {
    sequence.push("uploads");
    return options.uploadRowsDeleted ?? state.uploads.length;
  },
  initial: structuredClone(state),
  revalidate: async () => {
    sequence.push("revalidate");
    return structuredClone(options.revalidated ?? state);
  },
  rollback: async () => sequence.push("rollback"),
});

const dependenciesFor = ({
  candidates = [candidate()],
  cleanupRateLimits,
  deleteObject,
  expireSession,
  lockState = lockedState(),
  retrieveSession,
} = {}) => {
  const sequence = [];
  const mutations = [];
  return {
    dependencies: {
      cleanupRateLimits:
        cleanupRateLimits ??
        (async ({ limit }) => {
          assert.equal(limit, 500);
          return 2;
        }),
      deleteObject:
        deleteObject ??
        (async () => {
          sequence.push("storage");
          mutations.push("storage");
        }),
      gateway: {
        expireSession:
          expireSession ??
          (async () => {
            mutations.push("expire");
            return {
              paymentStatus: "unpaid",
              status: "expired",
            };
          }),
        retrieveSession:
          retrieveSession ??
          (async () => ({ paymentStatus: "unpaid", status: "expired" })),
      },
      listCandidates: async ({ limit }) => {
        assert.equal(limit, 25);
        return structuredClone(candidates);
      },
      lockCandidate: async () => {
        sequence.push("lock");
        const lock = lockFor(lockState, sequence);
        const commit = lock.commit;
        const rollback = lock.rollback;
        lock.commit = async () => {
          mutations.push("database");
          await commit();
        };
        lock.rollback = async () => rollback();
        return lock;
      },
    },
    mutations,
    sequence,
  };
};

test("dry run is bounded and performs zero Stripe, Storage, or database mutations", async () => {
  const fixture = dependenciesFor();
  const summary = await runCheckoutCleanup({
    dependencies: fixture.dependencies,
    execute: false,
    now,
  });
  assert.equal(summary.scanned, 1);
  assert.equal(summary.eligible, 1);
  assert.equal(summary.intentsDeleted, 0);
  assert.equal(summary.rateLimitRows, 2);
  assert.deepEqual(fixture.mutations, []);
  assert.deepEqual(fixture.sequence, ["lock", "rollback"]);
});

test("future candidates are skipped and a due draft deletes Storage, uploads, then Intent", async () => {
  const futureFixture = dependenciesFor({
    candidates: [candidate({ deleteAfter: future })],
  });
  const futureSummary = await runCheckoutCleanup({
    dependencies: futureFixture.dependencies,
    execute: true,
    now,
  });
  assert.equal(futureSummary.skippedActive, 1);
  assert.deepEqual(futureFixture.sequence, []);

  const dueFixture = dependenciesFor();
  const dueSummary = await runCheckoutCleanup({
    dependencies: dueFixture.dependencies,
    execute: true,
    now,
  });
  assert.deepEqual(dueFixture.sequence, [
    "lock",
    "storage",
    "revalidate",
    "uploads",
    "intent",
    "commit",
  ]);
  assert.equal(dueSummary.storageObjectsDeleted, 1);
  assert.equal(dueSummary.uploadRowsDeleted, 1);
  assert.equal(dueSummary.intentsDeleted, 1);
});

test("completed Intents, Orders, order-owned uploads, and transient reservations are protected", async () => {
  for (const state of [
    lockedState({ status: "completed" }),
    lockedState({ hasOrder: true }),
    lockedState({ uploads: [{ filename: "paid-image", id: 71, orderId: 9 }] }),
    lockedState({ status: "checkout_pending" }),
  ]) {
    const fixture = dependenciesFor({ lockState: state });
    const summary = await runCheckoutCleanup({
      dependencies: fixture.dependencies,
      execute: true,
      now,
    });
    assert.equal(summary.intentsDeleted, 0);
    assert.equal(summary.storageObjectsDeleted, 0);
    assert.deepEqual(fixture.mutations, []);
    assert.deepEqual(fixture.sequence, ["lock", "rollback"]);
  }
});

test("open unpaid Stripe Sessions expire before cleanup; paid, complete, uncertain, and failures skip", async () => {
  const stripeCandidate = candidate({
    status: "checkout_created",
    stripeCheckoutSessionId: "cs_test_synthetic",
  });
  const stripeState = lockedState({
    status: "checkout_created",
    stripeCheckoutSessionId: "cs_test_synthetic",
  });
  const sequence = [];
  const open = dependenciesFor({
    candidates: [stripeCandidate],
    expireSession: async () => {
      sequence.push("expire");
      return { paymentStatus: "unpaid", status: "expired" };
    },
    lockState: stripeState,
    retrieveSession: async () => {
      sequence.push("retrieve");
      return { paymentStatus: "unpaid", status: "open" };
    },
  });
  open.dependencies.lockCandidate = async () => {
    sequence.push("lock");
    return lockFor(stripeState, sequence);
  };
  open.dependencies.deleteObject = async () => sequence.push("storage");
  const openSummary = await runCheckoutCleanup({
    dependencies: open.dependencies,
    execute: true,
    now,
  });
  assert.equal(openSummary.stripeSessionsExpired, 1);
  assert.deepEqual(sequence.slice(0, 4), ["retrieve", "expire", "lock", "storage"]);

  for (const outcome of [
    { paymentStatus: "paid", status: "complete" },
    { paymentStatus: "unpaid", status: "complete" },
    { paymentStatus: "no_payment_required", status: "expired" },
  ]) {
    const fixture = dependenciesFor({
      candidates: [stripeCandidate],
      lockState: stripeState,
      retrieveSession: async () => outcome,
    });
    const summary = await runCheckoutCleanup({
      dependencies: fixture.dependencies,
      execute: true,
      now,
    });
    assert.equal(summary.intentsDeleted, 0);
    assert.equal(summary.skippedProtected, 1);
    assert.deepEqual(fixture.sequence, []);
  }

  const failed = dependenciesFor({
    candidates: [stripeCandidate],
    lockState: stripeState,
    retrieveSession: async () => {
      throw new Error("private Stripe failure");
    },
  });
  const failedSummary = await runCheckoutCleanup({
    dependencies: failed.dependencies,
    execute: true,
    now,
  });
  assert.equal(failedSummary.retryableFailures, 1);
  assert.deepEqual(failed.sequence, []);
});

test("Storage failure retains rows, while an already-missing object converges successfully", async () => {
  const failed = dependenciesFor({
    deleteObject: async () => {
      throw new Error("private Storage failure");
    },
  });
  const failedSummary = await runCheckoutCleanup({
    dependencies: failed.dependencies,
    execute: true,
    now,
  });
  assert.equal(failedSummary.retryableFailures, 1);
  assert.equal(failedSummary.uploadRowsDeleted, 0);
  assert.equal(failedSummary.intentsDeleted, 0);
  assert.deepEqual(failed.sequence, ["lock", "rollback"]);

  const missing = dependenciesFor({ deleteObject: async () => {} });
  const missingSummary = await runCheckoutCleanup({
    dependencies: missing.dependencies,
    execute: true,
    now,
  });
  assert.equal(missingSummary.intentsDeleted, 1);
  assert.equal(missingSummary.retryableFailures, 0);
});

test("duplicate concurrent runs serialize and converge without duplicate deletion", async () => {
  let exists = true;
  let tail = Promise.resolve();
  const sequence = [];
  const lockCandidate = async () => {
    let release;
    const previous = tail;
    tail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    if (!exists) {
      release();
      return null;
    }
    const lock = lockFor(lockedState({ uploads: [] }), sequence);
    lock.commit = async () => {
      exists = false;
      sequence.push("commit");
      release();
    };
    lock.rollback = async () => {
      sequence.push("rollback");
      release();
    };
    return lock;
  };
  const dependencies = {
    cleanupRateLimits: async () => 0,
    deleteObject: async () => assert.fail("unexpected Storage deletion"),
    gateway: {
      expireSession: async () => assert.fail("unexpected Stripe expiration"),
      retrieveSession: async () => assert.fail("unexpected Stripe retrieval"),
    },
    listCandidates: async () => [candidate()],
    lockCandidate,
  };

  const summaries = await Promise.all([
    runCheckoutCleanup({ dependencies, execute: true, now }),
    runCheckoutCleanup({ dependencies, execute: true, now }),
  ]);
  assert.equal(summaries.reduce((sum, item) => sum + item.intentsDeleted, 0), 1);
  assert.equal(sequence.filter((entry) => entry === "intent").length, 1);
});

test("expired rate-limit cleanup is bounded and dry-run remains mutation-free", async () => {
  const calls = [];
  const dry = dependenciesFor({
    candidates: [],
    cleanupRateLimits: async (options) => {
      calls.push(options);
      return 7;
    },
  });
  const drySummary = await runCheckoutCleanup({
    dependencies: dry.dependencies,
    execute: false,
    now,
  });
  assert.deepEqual(calls, [{ execute: false, limit: 500 }]);
  assert.equal(drySummary.rateLimitRows, 7);
  assert.deepEqual(dry.mutations, []);

  const execute = dependenciesFor({
    candidates: [],
    cleanupRateLimits: async (options) => {
      calls.push(options);
      return 5;
    },
  });
  const executeSummary = await runCheckoutCleanup({
    dependencies: execute.dependencies,
    execute: true,
    now,
  });
  assert.deepEqual(calls.at(-1), { execute: true, limit: 500 });
  assert.equal(executeSummary.rateLimitRows, 5);
});
