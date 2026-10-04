"use client";

import { useRouter } from "next/navigation";
import { type MouseEvent, useEffect, useRef, useState } from "react";

import type { TrackingCarrier } from "../../../server/orders/orderFulfillmentContract";
import {
  fulfillmentActionFor,
  type OrderWorkbenchData,
} from "./orderWorkbenchContract";
import {
  OrderWorkbenchDetails,
  type TrackingDraft,
} from "./OrderWorkbenchDetails";
import styles from "./OrderWorkbench.module.css";

const safeError = (status: number, code?: string) => {
  if (status === 401) {
    return "Your administrator session expired. Sign in again, then retry.";
  }
  if (status === 409 && code === "FULFILLMENT_CONFLICT") {
    return "This order changed in another session. The displayed order was refreshed; review it before retrying.";
  }
  if (status === 409 && code === "FULLY_REFUNDED") {
    return "This order is fully refunded, so fulfillment is blocked.";
  }
  if (status === 409 && code === "DISPUTE_BLOCKED") {
    return "An open payment dispute blocks fulfillment.";
  }
  return "The order could not be updated. Nothing was changed; please retry.";
};

export const OrderWorkbenchClient = ({
  data,
  ordersListURL,
}: {
  data: OrderWorkbenchData;
  ordersListURL: string;
}) => {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tracking, setTracking] = useState<TrackingDraft>({
    carrier: data.fulfillment.tracking?.carrier ?? "",
    trackingNumber: data.fulfillment.tracking?.trackingNumber ?? "",
  });
  const inFlight = useRef(false);

  useEffect(() => {
    if (error) {
      document.querySelector<HTMLElement>("[role=alert]")?.focus();
    }
  }, [error]);

  const submit = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (inFlight.current) return;
    const action = fulfillmentActionFor(data.fulfillment.orderStatus);
    if (!action) return;

    const hasCarrier = tracking.carrier.length > 0;
    const hasNumber = tracking.trackingNumber.trim().length > 0;
    if (action.nextState === "shipped" && hasCarrier !== hasNumber) {
      setError("Choose a carrier and enter a tracking number together, or leave both blank.");
      return;
    }
    if (
      action.nextState === "shipped" &&
      !window.confirm(
        "Mark this order shipped? This can enqueue the customer shipment email.",
      )
    ) {
      return;
    }

    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const body = {
        expectedCurrentState: data.fulfillment.orderStatus,
        requestedNextState: action.nextState,
        ...(action.nextState === "shipped" && hasCarrier && hasNumber
          ? {
              tracking: {
                carrier: tracking.carrier as TrackingCarrier,
                trackingNumber: tracking.trackingNumber,
              },
            }
          : {}),
      };
      const response = await fetch(
        `/api/admin/orders/${data.orderId}/fulfillment`,
        {
          body: JSON.stringify(body),
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          method: "PATCH",
        },
      );
      let code: string | undefined;
      try {
        const result = await response.json();
        code = result?.error?.code;
      } catch {
        // Only the status and bounded server error code influence the UI.
      }
      if (!response.ok) {
        setError(safeError(response.status, code));
        if (response.status === 409) router.refresh();
        return;
      }
      router.refresh();
    } catch {
      setError("The order could not be updated. Check your connection and retry.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  return (
    <OrderWorkbenchDetails
      data={data}
      error={error}
      onSubmit={submit}
      onTrackingChange={setTracking}
      ordersListURL={ordersListURL}
      pending={pending}
      styles={styles}
      tracking={tracking}
    />
  );
};
