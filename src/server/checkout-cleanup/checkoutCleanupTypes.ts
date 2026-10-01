import type { StripeCheckoutGateway } from "../stripe/stripeCheckoutGateway";

export type CleanupCandidate = {
  deleteAfter: string;
  id: number;
  status: string;
  stripeCheckoutSessionId: string | null;
};

export type CleanupUpload = {
  filename: string;
  id: number;
  orderId: number | null;
};

export type LockedCleanupCandidate = CleanupCandidate & {
  hasOrder: boolean;
  uploads: CleanupUpload[];
};

export type CleanupCandidateLock = {
  commit: () => Promise<void>;
  deleteIntent: () => Promise<boolean>;
  deleteUploads: () => Promise<number>;
  initial: LockedCleanupCandidate;
  revalidate: () => Promise<LockedCleanupCandidate | null>;
  rollback: () => Promise<void>;
};

export type CleanupSummary = {
  eligible: number;
  intentsDeleted: number;
  rateLimitRows: number;
  retryableFailures: number;
  scanned: number;
  skippedActive: number;
  skippedProtected: number;
  storageObjectsDeleted: number;
  stripeSessionsExpired: number;
  uploadRowsDeleted: number;
};

export type CheckoutCleanupDependencies = {
  cleanupRateLimits: (options: {
    execute: boolean;
    limit: number;
  }) => Promise<number>;
  deleteObject: (filename: string) => Promise<void>;
  gateway: Pick<
    StripeCheckoutGateway,
    "expireSession" | "retrieveSession"
  >;
  listCandidates: (options: {
    limit: number;
    now: Date;
  }) => Promise<CleanupCandidate[]>;
  lockCandidate: (
    id: number,
  ) => Promise<CleanupCandidateLock | null>;
};
