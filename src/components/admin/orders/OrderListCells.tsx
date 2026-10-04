import type { DefaultServerCellComponentProps } from "payload";

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
