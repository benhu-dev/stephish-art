type CleanupEnvironment = {
  cronSecret: string | undefined;
};

export const validateCheckoutCleanupEnvironment = ({
  cronSecret,
}: CleanupEnvironment) => {
  if (
    !cronSecret ||
    cronSecret.length < 32 ||
    cronSecret.trim() !== cronSecret
  ) {
    throw new Error("CRON_SECRET_INVALID");
  }
  return { cronSecret };
};
