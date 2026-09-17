type StripeEnvironmentInput = {
  appBaseURL: string | undefined;
  secretKey: string | undefined;
};

const isLoopback = (hostname: string) =>
  hostname === "localhost" ||
  hostname === "127.0.0.1" ||
  hostname === "[::1]";

export const validateStripeCheckoutEnvironment = ({
  appBaseURL,
  secretKey,
}: StripeEnvironmentInput) => {
  if (!secretKey?.startsWith("sk_test_")) {
    throw new Error("STRIPE_TEST_SECRET_KEY_REQUIRED");
  }

  let parsedURL: URL;
  try {
    parsedURL = new URL(appBaseURL ?? "");
  } catch {
    throw new Error("APP_BASE_URL_INVALID");
  }

  const trustedProtocol =
    parsedURL.protocol === "https:" ||
    (parsedURL.protocol === "http:" && isLoopback(parsedURL.hostname));
  if (
    !trustedProtocol ||
    parsedURL.username ||
    parsedURL.password ||
    parsedURL.pathname !== "/" ||
    parsedURL.search ||
    parsedURL.hash
  ) {
    throw new Error("APP_BASE_URL_INVALID");
  }

  return { baseURL: parsedURL.origin, secretKey };
};

export const readStripeCheckoutEnvironment = () =>
  validateStripeCheckoutEnvironment({
    appBaseURL: process.env.APP_BASE_URL,
    secretKey: process.env.STRIPE_SECRET_KEY,
  });
