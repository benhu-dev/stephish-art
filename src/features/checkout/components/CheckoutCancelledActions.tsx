"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { abandonCurrentCheckout } from "../checkoutRecoveryClient";
import { requestCheckoutSession } from "../checkoutSessionClient";
import styles from "./checkout-result.module.css";

export function CheckoutCancelledActions() {
  const router = useRouter();
  const controller = useRef<AbortController | null>(null);
  const [confirmStartOver, setConfirmStartOver] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<"abandon" | "resume" | null>(null);

  useEffect(() => {
    window.history.replaceState(null, "", window.location.pathname);
    return () => {
      const activeController = controller.current;
      controller.current = null;
      activeController?.abort();
    };
  }, []);

  const returnToPayment = async () => {
    if (controller.current) return;
    const nextController = new AbortController();
    controller.current = nextController;
    setPending("resume");
    setMessage("");

    try {
      const result = await requestCheckoutSession({ signal: nextController.signal });
      if (controller.current !== nextController || result.kind === "aborted") return;
      if (result.kind === "failed") {
        setMessage("Secure checkout could not be resumed. Try again or start a new order.");
        return;
      }
      if (result.kind === "ready") window.location.assign(result.checkoutUrl);
      else if (result.kind === "processing") router.push("/checkout/success");
      else if (result.kind === "fresh") {
        setMessage("That checkout is no longer available. Start a new order below.");
      }
    } finally {
      if (controller.current === nextController) {
        controller.current = null;
        setPending(null);
      }
    }
  };

  const startNewOrder = async () => {
    if (controller.current) return;
    const nextController = new AbortController();
    controller.current = nextController;
    setPending("abandon");
    setMessage("");
    try {
      const result = await abandonCurrentCheckout({ signal: nextController.signal });
      if (controller.current !== nextController || result.kind === "aborted") return;
      if (result.kind === "abandoned" || result.kind === "fresh") {
        router.push("/");
      } else if (result.kind === "processing") {
        router.push("/checkout/success");
      } else if (result.kind === "failed") {
        setMessage(result.message);
      }
    } finally {
      if (controller.current === nextController) {
        controller.current = null;
        setPending(null);
      }
    }
  };

  return (
    <div className={styles.actions}>
      <Link className={styles.secondaryAction} href="/">Return Home</Link>
      <button
        className={styles.primaryAction}
        disabled={pending !== null}
        onClick={returnToPayment}
        type="button"
      >
        {pending === "resume" ? "Opening secure checkout…" : "Resume Secure Checkout"}
      </button>
      {!confirmStartOver ? <button
        className={styles.secondaryAction}
        disabled={pending !== null}
        onClick={() => setConfirmStartOver(true)}
        type="button"
      >Start a New Order</button> : <div className={styles.confirmation}>
        <p>Starting over will close this payment session. Your current uploads and note will no longer be available.</p>
        <button
          className={styles.primaryAction}
          disabled={pending !== null}
          onClick={() => { void startNewOrder(); }}
          type="button"
        >{pending === "abandon" ? "Starting over…" : "Confirm Start Over"}</button>
        <button
          className={styles.secondaryAction}
          disabled={pending !== null}
          onClick={() => setConfirmStartOver(false)}
          type="button"
        >Keep Checkout</button>
      </div>}
      <p aria-live="polite" className={styles.actionMessage} role="status">
        {message}
      </p>
    </div>
  );
}
