import type { OrderEmailOutboxKind } from "./emailOutbox";
import type {
  OrderEmailData,
  OrderEmailMessage,
} from "./emailDeliveryTypes";

type TemplateConfiguration = {
  artistOrderEmail: string;
  from: string;
  replyTo: string;
};

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "'": "&#39;",
        '"': "&quot;",
        "<": "&lt;",
        ">": "&gt;",
      })[character] ?? character,
  );

const safeText = (value: string) =>
  value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");

const money = (cents: number) => {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new Error("ORDER_EMAIL_DATA_INVALID");
  }
  return `$${(cents / 100).toFixed(2)}`;
};

const addressLines = (order: OrderEmailData) => {
  const { shippingAddress: address } = order;
  const cityLine = [
    address.city,
    address.state ? `, ${address.state}` : "",
    address.postalCode ? ` ${address.postalCode}` : "",
  ].join("");
  return [
    address.recipientName,
    address.line1,
    address.line2,
    cityLine,
    address.country,
  ].filter((line): line is string => Boolean(line));
};

const photoLabel = (count: number) =>
  `${count} reference photo${count === 1 ? "" : "s"}`;

const rowsFor = (order: OrderEmailData) => [
  ["Subtotal", money(order.subtotalCents)],
  ["Shipping", money(order.shippingCents)],
  ["Total", money(order.totalCents)],
  ["References", photoLabel(order.referencePhotoCount)],
] as const;

const htmlShell = (heading: string, introduction: string, details: string) =>
  `<!doctype html><html><body style="margin:0;background:#f7efe2;color:#382c28;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:auto;background:#fffaf2;border:1px solid #d9b89c"><tr><td style="padding:32px"><p style="margin:0 0 8px;color:#a65345;font-size:13px;letter-spacing:1px;text-transform:uppercase">Stephish Art</p><h1 style="margin:0 0 20px;font-family:Georgia,serif;font-size:28px">${escapeHtml(heading)}</h1><p style="line-height:1.6">${escapeHtml(introduction)}</p>${details}<p style="margin:28px 0 0;line-height:1.6">Warmly,<br>Stephish Art</p></td></tr></table></td></tr></table></body></html>`;

const detailHtml = (order: OrderEmailData, includeEmail: boolean) => {
  const rows = [
    ...(includeEmail ? [["Customer email", safeText(order.customerEmail)] as const] : []),
    ...rowsFor(order),
  ];
  const table = rows
    .map(
      ([label, value]) =>
        `<tr><th align="left" style="padding:6px 14px 6px 0">${escapeHtml(label)}</th><td style="padding:6px 0">${escapeHtml(value)}</td></tr>`,
    )
    .join("");
  const address = addressLines(order).map(escapeHtml).join("<br>");
  const note = order.artistNote
    ? `<h2 style="font-family:Georgia,serif;font-size:18px">Artist note</h2><p style="white-space:pre-wrap;line-height:1.6">${escapeHtml(safeText(order.artistNote))}</p>`
    : "";
  return `<table role="presentation" cellpadding="0" cellspacing="0">${table}</table><h2 style="font-family:Georgia,serif;font-size:18px">Shipping destination</h2><p style="line-height:1.6">${address}</p>${note}`;
};

const textDetails = (order: OrderEmailData, includeEmail: boolean) => {
  const rows = [
    ...(includeEmail ? [["Customer email", safeText(order.customerEmail)] as const] : []),
    ...rowsFor(order),
  ].map(([label, value]) => `${label}: ${value}`);
  const note = order.artistNote
    ? `\n\nArtist note:\n${safeText(order.artistNote)}`
    : "";
  return `${rows.join("\n")}\n\nShipping destination:\n${addressLines(order).map(safeText).join("\n")}${note}`;
};

export const emailIdempotencyKey = (
  jobId: number,
  kind: OrderEmailOutboxKind,
) => `stephish-email-outbox/v1/${kind}/${jobId}`;

export const buildOrderEmailMessage = (
  kind: OrderEmailOutboxKind,
  order: OrderEmailData,
  configuration: TemplateConfiguration,
): OrderEmailMessage => {
  if (
    order.currency !== "usd" ||
    !Number.isSafeInteger(order.referencePhotoCount) ||
    order.referencePhotoCount < 1 ||
    order.subtotalCents + order.shippingCents !== order.totalCents
  ) {
    throw new Error("ORDER_EMAIL_DATA_INVALID");
  }
  const name = safeText(order.customerName);
  if (kind === "customer_order_confirmation") {
    const introduction = `Hi ${name}, your postcard order is confirmed. The artwork will be prepared with care, and another update can be sent after shipment.`;
    return {
      from: configuration.from,
      html: htmlShell("Your postcard order is confirmed", introduction, detailHtml(order, false)),
      replyTo: configuration.replyTo,
      subject: "Your postcard order is confirmed",
      text: `${introduction}\n\n${textDetails(order, false)}\n\nWarmly,\nStephish Art`,
      to: order.customerEmail,
    };
  }

  const introduction = `A new paid postcard order for ${name} is ready to review. Full private order details and uploads are available in the authenticated Payload admin.`;
  return {
    from: configuration.from,
    html: htmlShell("New paid postcard order", introduction, detailHtml(order, true)),
    replyTo: configuration.replyTo,
    subject: "New paid postcard order",
    text: `${introduction}\n\n${textDetails(order, true)}\n\nWarmly,\nStephish Art`,
    to: configuration.artistOrderEmail,
  };
};
