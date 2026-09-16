export class StorefrontApiError extends Error {
  clearCookie: boolean;
  code: string;
  status: number;

  constructor(
    status: number,
    code: string,
    options: { clearCookie?: boolean } = {},
  ) {
    super(code);
    this.name = "StorefrontApiError";
    this.status = status;
    this.code = code;
    this.clearCookie = options.clearCookie ?? false;
  }
}

export const unauthorizedIntentError = (clearCookie = false) =>
  new StorefrontApiError(401, "UNAUTHORIZED", { clearCookie });
