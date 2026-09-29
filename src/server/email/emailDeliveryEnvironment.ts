import type { EmailDeliveryConfiguration } from "./emailDeliveryTypes";

type EmailEnvironment = Partial<
  Record<
    | "ARTIST_ORDER_EMAIL"
    | "EMAIL_DELIVERY_ENABLED"
    | "EMAIL_FROM"
    | "EMAIL_REPLY_TO"
    | "RESEND_API_KEY",
    string | undefined
  >
>;

const invalid = (): never => {
  throw new Error("EMAIL_DELIVERY_CONFIGURATION_INVALID");
};

const isMailbox = (value: string) =>
  value.length <= 320 &&
  !/[\r\n]/.test(value) &&
  /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value);

const isFromAddress = (value: string) => {
  if (isMailbox(value)) return true;
  const match = value.match(/^([^\r\n<>]{1,100}) <([^<>]+)>$/);
  return Boolean(match && isMailbox(match[2]));
};

export const readEmailDeliveryEnvironment = (
  environment: EmailEnvironment = process.env as EmailEnvironment,
): EmailDeliveryConfiguration => {
  const enabled = environment.EMAIL_DELIVERY_ENABLED;
  if (enabled === "false") return { enabled: false };
  if (enabled !== "true") return invalid();

  const apiKey = environment.RESEND_API_KEY;
  const artistOrderEmail = environment.ARTIST_ORDER_EMAIL;
  const from = environment.EMAIL_FROM;
  const replyTo = environment.EMAIL_REPLY_TO;
  if (
    !apiKey ||
    apiKey.length > 512 ||
    !/^re_[A-Za-z0-9_-]+$/.test(apiKey) ||
    !artistOrderEmail ||
    !isMailbox(artistOrderEmail) ||
    !from ||
    !isFromAddress(from) ||
    !replyTo ||
    !isMailbox(replyTo)
  ) {
    return invalid();
  }

  return { apiKey, artistOrderEmail, enabled: true, from, replyTo };
};
