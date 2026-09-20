"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import styles from "./checkout-result.module.css";

const checkoutEndpoint =
  "/api/storefront/checkout-intents/current/checkout-session";

export function CheckoutCancelledActions() {
  const controller = useRef<AbortController | null>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    window.history.replaceState(null, "", window.location.pathname);
    return () => controller.current?.abort();
  }, []);

  const returnToPayment = async () => {
    if (controller.current) return;
    const nextController = new AbortController();
    controller.current = nextController;
    setPending(true);
    setMessage("");

    try {
      const response = await fetch(checkoutEndpoint, {
        body: JSON.stringify({}),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal: nextController.signal,
      });
      const result = (await response.json()) as { checkoutUrl?: unknown };
      if (!response.ok || typeof result.checkoutUrl !== "string") {
        throw new Error("CHECKOUT_UNAVAILABLE");
      }
      window.location.assign(result.checkoutUrl);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setMessage("Payment cannot be restarted from this browser. Please return home.");
      }
    } finally {
      if (controller.current === nextController) controller.current = null;
      setPending(false);
    }
  };

  return (
    <div className={styles.actions}>
      <Link className={styles.secondaryAction} href="/">Return home</Link>
      <button
        className={styles.primaryAction}
        disabled={pending}
        onClick={returnToPayment}
        type="button"
      >
        {pending ? "Opening payment…" : "Return to payment"}
      </button>
      <p aria-live="polite" className={styles.actionMessage} role="status">
        {message}
      </p>
    </div>
  );
}
