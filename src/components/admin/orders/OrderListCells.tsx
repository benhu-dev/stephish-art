import type { DefaultServerCellComponentProps } from "payload";
import { formatAdminURL } from "payload/shared";

import { formatNewYorkBusinessDateTime } from "../../../lib/newYorkTime";

export const OrderTotalCell = ({ cellData }: DefaultServerCellComponentProps) => {
  const amount = Number(cellData);
  return Number.isSafeInteger(amount) && amount >= 0
    ? new Intl.NumberFormat("en-US", {
        currency: "USD",
        style: "currency",
      }).format(amount / 100)
    : "—";
};

export const OrderCreatedAtCell = ({
  cellData,
  rowData,
}: DefaultServerCellComponentProps) => {
  const instant = new Date(String(rowData?.createdAt ?? cellData));
  try {
    return formatNewYorkBusinessDateTime(instant);
  } catch {
    return "—";
  }
};

export const OrderRecipientNameCell = ({
  rowData,
}: DefaultServerCellComponentProps) => {
  const recipientName = rowData?.shippingAddress?.recipientName;
  return typeof recipientName === "string" && recipientName.length > 0
    ? recipientName
    : "—";
};

export const OrderViewCell = ({
  collectionSlug,
  linkURL,
  payload,
  rowData,
}: DefaultServerCellComponentProps) => {
  const id = rowData?.id;
  if ((typeof id !== "number" && typeof id !== "string") || String(id).length === 0) {
    return "—";
  }

  const href = linkURL ?? formatAdminURL({
    adminRoute: payload.config.routes.admin,
    path: `/collections/${collectionSlug}/${encodeURIComponent(String(id))}`,
  });

  return <a href={href}>View Order</a>;
};
