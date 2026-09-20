"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import {
  createCheckoutStatusPoller,
  type CheckoutStatusResponse,
  type CheckoutStatusViewState,
} from "../checkoutStatusPolling";
import styles from "./checkout-result.module.css";

const statusEndpoint = "/api/storefront/checkout-intents/current/status";

const isSafeInteger = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const parseStatus = (value: unknown): CheckoutStatusResponse => {
  if (typeof value !== "object" || value === null || !("state" in value)) {
    throw new Error("INVALID_STATUS_RESPONSE");
  }
  const record = value as Record<string, unknown>;
  if (["expired", "not_started", "processing"].includes(String(record.state))) {
    if (Object.keys(record).length !== 1) throw new Error("INVALID_STATUS_RESPONSE");
    return record as CheckoutStatusResponse;
  }
  if (
    record.state !== "confirmed" ||
    record.currency !== "usd" ||
    !isSafeInteger(record.subtotalAmountCents) ||
    !isSafeInteger(record.shippingAmountCents) ||
    !isSafeInteger(record.totalAmountCents) ||
    Object.keys(record).length !== 5
  ) {
    throw new Error("INVALID_STATUS_RESPONSE");
  }
  return record as CheckoutStatusResponse;
};

const readStatus = async (signal: AbortSignal) => {
  const response = await fetch(statusEndpoint, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error("STATUS_UNAVAILABLE");
  return parseStatus(await response.json());
};

const dollars = (amountCents: number) =>
  new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(amountCents / 100);

export function CheckoutSuccessStatus() {
  const [state, setState] = useState<CheckoutStatusViewState>({
    phase: "loading",
  });

  useEffect(() => {
    window.history.replaceState(null, "", window.location.pathname);
    const poller = createCheckoutStatusPoller({
      onState: setState,
      readStatus,
    });
    poller.start();
    return () => poller.stop();
  }, []);

  return (
    <section aria-atomic="true" aria-live="polite" className={styles.status}>
      {state.phase === "loading" ? (
        <>
          <h1 className={styles.title}>Confirming your payment…</h1>
          <p>Please keep this page open while we check your order.</p>
        </>
      ) : null}
      {state.phase === "processing" ? (
        <>
          <h1 className={styles.title}>Your payment is processing.</h1>
          <p>Your payment confirmation may take a moment. We’ll check again automatically.</p>
        </>
      ) : null}
      {state.phase === "confirmed" ? (
        <>
          <h1 className={styles.title}>Your postcard order is confirmed.</h1>
          <p>Thank you for supporting handmade art.</p>
          <dl className={styles.summary}>
            <div><dt>Postcard</dt><dd>{dollars(state.subtotalAmountCents)}</dd></div>
            <div><dt>Shipping</dt><dd>{dollars(state.shippingAmountCents)}</dd></div>
            <div className={styles.total}><dt>Total</dt><dd>{dollars(state.totalAmountCents)}</dd></div>
          </dl>
          <Link className={styles.secondaryAction} href="/">Return home</Link>
        </>
      ) : null}
      {state.phase === "expired" ? (
        <>
          <h1 className={styles.title}>This checkout has expired.</h1>
          <p>We’re sorry, but no confirmed Order was found for this checkout.</p>
          <Link className={styles.primaryAction} href="/">Return home</Link>
        </>
      ) : null}
      {state.phase === "not_started" ? (
        <>
          <h1 className={styles.title}>Payment has not started.</h1>
          <p>Return home when you’re ready to begin a new checkout.</p>
          <Link className={styles.primaryAction} href="/">Return home</Link>
        </>
      ) : null}
      {state.phase === "unavailable" ? (
        <>
          <h1 className={styles.title}>Checkout unavailable.</h1>
          <p>This checkout cannot be accessed from this browser.</p>
          <Link className={styles.primaryAction} href="/">Return home</Link>
        </>
      ) : null}
      {state.phase === "timeout" ? (
        <>
          <h1 className={styles.title}>Confirmation is taking longer than expected.</h1>
          <p>It is safe to refresh this page and check again.</p>
          <button className={styles.primaryAction} onClick={() => window.location.reload()} type="button">
            Refresh this page
          </button>
        </>
      ) : null}
    </section>
  );
}
