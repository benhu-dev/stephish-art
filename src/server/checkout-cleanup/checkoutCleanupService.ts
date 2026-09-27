import type { PayloadRequest } from "payload";

import { deleteOrderUploadObject } from "../storage/orderUploadObjectStorage";
import { createStripeCheckoutGateway } from "../stripe/stripeCheckoutGateway";
import {
  listCleanupCandidates,
  lockCleanupCandidate,
} from "./checkoutCleanupRepository";
import type {
  CheckoutCleanupDependencies,
  CleanupCandidate,
  CleanupSummary,
  LockedCleanupCandidate,
} from "./checkoutCleanupTypes";

export const CHECKOUT_CLEANUP_BATCH_LIMIT = 25;

const emptySummary = (): CleanupSummary => ({
  eligible: 0,
  intentsDeleted: 0,
  retryableFailures: 0,
  scanned: 0,
  skippedActive: 0,
  skippedProtected: 0,
  storageObjectsDeleted: 0,
  stripeSessionsExpired: 0,
  uploadRowsDeleted: 0,
});

type Eligibility = "active" | "eligible" | "protected" | "retry";

const classifyLockedCandidate = (
  candidate: CleanupCandidate,
  locked: LockedCleanupCandidate,
  now: Date,
): Eligibility => {
  const deleteAfter = new Date(locked.deleteAfter).getTime();
  if (!Number.isFinite(deleteAfter)) return "retry";
  if (deleteAfter > now.getTime()) return "active";
  if (
    locked.status === "completed" ||
    locked.hasOrder ||
    locked.uploads.some(({ orderId }) => orderId !== null)
  ) {
    return "protected";
  }
  if (locked.status === "checkout_pending") return "active";
  if (!['draft', 'expired', 'checkout_created'].includes(locked.status)) {
    return "protected";
  }
  if (
    locked.stripeCheckoutSessionId !== candidate.stripeCheckoutSessionId ||
    (locked.status === "checkout_created" &&
      !locked.stripeCheckoutSessionId)
  ) {
    return "retry";
  }
  return "eligible";
};

const sameLockedCandidate = (
  before: LockedCleanupCandidate,
  after: LockedCleanupCandidate,
) =>
  before.id === after.id &&
  before.status === after.status &&
  before.deleteAfter === after.deleteAfter &&
  before.stripeCheckoutSessionId === after.stripeCheckoutSessionId &&
  before.hasOrder === after.hasOrder &&
  JSON.stringify(before.uploads) === JSON.stringify(after.uploads);

const countSkip = (summary: CleanupSummary, eligibility: Eligibility) => {
  if (eligibility === "active") summary.skippedActive += 1;
  else if (eligibility === "protected") summary.skippedProtected += 1;
  else if (eligibility === "retry") summary.retryableFailures += 1;
};

const resolveDependencies = (
  request: PayloadRequest | undefined,
  provided: Partial<CheckoutCleanupDependencies>,
): CheckoutCleanupDependencies => {
  const requireRequest = () => {
    if (!request) throw new Error("CHECKOUT_CLEANUP_REQUEST_REQUIRED");
    return request;
  };
  return {
    deleteObject: provided.deleteObject ?? deleteOrderUploadObject,
    gateway: provided.gateway ?? createStripeCheckoutGateway(),
    listCandidates:
      provided.listCandidates ??
      ((options) => listCleanupCandidates(requireRequest(), options)),
    lockCandidate:
      provided.lockCandidate ??
      ((id) => lockCleanupCandidate(requireRequest(), id)),
  };
};

const prepareStripe = async ({
  candidate,
  dependencies,
  execute,
  summary,
}: {
  candidate: CleanupCandidate;
  dependencies: CheckoutCleanupDependencies;
  execute: boolean;
  summary: CleanupSummary;
}): Promise<Eligibility> => {
  if (!candidate.stripeCheckoutSessionId) {
    return candidate.status === "checkout_created" ? "retry" : "eligible";
  }
  try {
    const session = await dependencies.gateway.retrieveSession(
      candidate.stripeCheckoutSessionId,
    );
    if (session.paymentStatus !== "unpaid" || session.status === "complete") {
      return "protected";
    }
    if (session.status === "expired") return "eligible";
    if (!execute) return "eligible";

    const expired = await dependencies.gateway.expireSession(
      candidate.stripeCheckoutSessionId,
    );
    if (
      expired.status !== "expired" ||
      expired.paymentStatus !== "unpaid"
    ) {
      return expired.paymentStatus === "paid" ? "protected" : "retry";
    }
    summary.stripeSessionsExpired += 1;
    return "eligible";
  } catch {
    return "retry";
  }
};

export const runCheckoutCleanup = async ({
  dependencies: provided = {},
  execute = false,
  now = new Date(),
  request,
}: {
  dependencies?: Partial<CheckoutCleanupDependencies>;
  execute?: boolean;
  now?: Date;
  request?: PayloadRequest;
}): Promise<CleanupSummary> => {
  const dependencies = resolveDependencies(request, provided);
  const summary = emptySummary();
  const listed = await dependencies.listCandidates({
    limit: CHECKOUT_CLEANUP_BATCH_LIMIT,
    now,
  });
  const candidates = listed.slice(0, CHECKOUT_CLEANUP_BATCH_LIMIT);
  summary.scanned = candidates.length;

  for (const candidate of candidates) {
    const deleteAfter = new Date(candidate.deleteAfter).getTime();
    if (!Number.isFinite(deleteAfter)) {
      summary.retryableFailures += 1;
      continue;
    }
    if (deleteAfter > now.getTime() || candidate.status === "checkout_pending") {
      summary.skippedActive += 1;
      continue;
    }
    if (candidate.status === "completed") {
      summary.skippedProtected += 1;
      continue;
    }

    const stripeEligibility = await prepareStripe({
      candidate,
      dependencies,
      execute,
      summary,
    });
    if (stripeEligibility !== "eligible") {
      countSkip(summary, stripeEligibility);
      continue;
    }

    let lock;
    try {
      lock = await dependencies.lockCandidate(candidate.id);
      if (!lock) continue;
      const eligibility = classifyLockedCandidate(candidate, lock.initial, now);
      if (eligibility !== "eligible") {
        countSkip(summary, eligibility);
        await lock.rollback();
        continue;
      }
      summary.eligible += 1;
      if (!execute) {
        await lock.rollback();
        continue;
      }

      for (const upload of lock.initial.uploads) {
        await dependencies.deleteObject(upload.filename);
        summary.storageObjectsDeleted += 1;
      }
      const revalidated = await lock.revalidate();
      if (!revalidated || !sameLockedCandidate(lock.initial, revalidated)) {
        throw new Error("CLEANUP_REVALIDATION_FAILED");
      }
      const finalEligibility = classifyLockedCandidate(
        candidate,
        revalidated,
        now,
      );
      if (finalEligibility !== "eligible") {
        throw new Error("CLEANUP_REVALIDATION_FAILED");
      }
      const uploadRowsDeleted = await lock.deleteUploads();
      if (uploadRowsDeleted !== revalidated.uploads.length) {
        throw new Error("CLEANUP_UPLOAD_DELETE_MISMATCH");
      }
      if (!(await lock.deleteIntent())) {
        throw new Error("CLEANUP_INTENT_DELETE_FAILED");
      }
      await lock.commit();
      summary.uploadRowsDeleted += uploadRowsDeleted;
      summary.intentsDeleted += 1;
    } catch {
      await lock?.rollback().catch(() => {});
      summary.retryableFailures += 1;
    }
  }
  return summary;
};
