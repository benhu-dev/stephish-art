import type { UIFieldServerProps } from "payload";

import { readOrderWorkbench } from "../../../server/orders/orderWorkbenchService";
import { OrderWorkbenchClient } from "./OrderWorkbench";

export const OrderWorkbench = async ({ id, req }: UIFieldServerProps) => {
  const orderId = Number(id);
  if (!Number.isSafeInteger(orderId) || orderId <= 0) return null;

  let data;
  try {
    data = await readOrderWorkbench({ orderId, request: req });
  } catch {
    return (
      <p role="alert">
        This order workbench is unavailable. Refresh the page or sign in again.
      </p>
    );
  }
  return <OrderWorkbenchClient data={data} />;
};
