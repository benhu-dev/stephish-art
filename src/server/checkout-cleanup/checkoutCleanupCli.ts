export const parseCheckoutCleanupArguments = (arguments_: string[]) => {
  if (arguments_.length === 0) return { execute: false };
  if (arguments_.length === 1 && arguments_[0] === "--execute") {
    return { execute: true };
  }
  throw new Error("Use checkout:cleanup with no arguments or with --execute.");
};
