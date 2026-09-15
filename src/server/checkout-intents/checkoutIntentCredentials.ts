import { createHash, randomBytes } from "node:crypto";

import { calculateCheckoutIntentDeadlines } from "./checkoutIntentPolicy";

export const generateCheckoutIntentToken = (): string =>
  randomBytes(32).toString("base64url");

export const hashCheckoutIntentToken = (rawToken: string): string => {
  if (!rawToken) {
    throw new Error("Checkout Intent token is required.");
  }

  return createHash("sha256").update(rawToken, "utf8").digest("hex");
};

export const issueCheckoutIntentCredential = (createdAt = new Date()) => {
  const rawToken = generateCheckoutIntentToken();
  const { deleteAfter, expiresAt } =
    calculateCheckoutIntentDeadlines(createdAt);

  return {
    rawToken,
    createData: {
      accessTokenHash: hashCheckoutIntentToken(rawToken),
      deleteAfter: deleteAfter.toISOString(),
      expiresAt: expiresAt.toISOString(),
    },
  };
};
