"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import {
  createCheckoutStatusPoller,
  type CheckoutStatusResponse,
  type CheckoutStatusViewState,
} from "../checkoutStatusPolling";
import { createCheckoutResultPresentation } from "../checkoutResultPresentation";
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
  const [loaderVisible, setLoaderVisible] = useState(false);
  const [pollingCycle, setPollingCycle] = useState(0);
  const [slow, setSlow] = useState(false);
  const [state, setState] = useState<CheckoutStatusViewState>({
    phase: "loading",
  });

  useEffect(() => {
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  useEffect(() => {
    const presentation = createCheckoutResultPresentation({
      onLoaderVisible: () => setLoaderVisible(true),
      onSlow: () => setSlow(true),
    });
    const poller = createCheckoutStatusPoller({
      onState: (nextState) => {
        setState(nextState);
        if (nextState.phase !== "loading" && nextState.phase !== "processing") {
          presentation.stop();
        }
      },
      readStatus,
    });
    presentation.start();
    poller.start();
    return () => {
      presentation.stop();
      poller.stop();
    };
  }, [pollingCycle]);

  const checkAgain = () => {
    setLoaderVisible(false);
    setSlow(false);
    setState({ phase: "loading" });
    setPollingCycle((current) => current + 1);
  };

  const confirming = state.phase === "loading" || state.phase === "processing";

  return (
    <section aria-atomic="true" aria-live="polite" className={styles.status}>
      {confirming ? (
        <div className={styles.processingContent}>
          <h1 aria-label="Confirming your order…" className={styles.title}>
            Confirming your order
            <span aria-hidden="true" className={styles.headingEllipsis}>
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
          </h1>
          <p>Your payment was submitted. We’re finalizing your postcard order now.</p>
          <div className={styles.processingStage}>
            {loaderVisible ? (
              <div aria-hidden="true" className={styles.processingPostmark}>
                <svg
                  className={styles.postmarkRing}
                  focusable="false"
                  viewBox="0 0 100 100"
                >
                  <circle
                    className={styles.postmarkRingStroke}
                    cx="50"
                    cy="50"
                    pathLength="100"
                    r="43"
                  />
                </svg>
                <span className={styles.processingPostmarkLabel}>
                  <strong>NYC</strong>
                  <small>POST</small>
                </span>
              </div>
            ) : null}
          </div>
          {slow ? (
            <p className={styles.slowMessage}>This is taking a little longer than usual.</p>
          ) : null}
        </div>
      ) : null}
      {state.phase === "confirmed" ? (
        <div className={styles.confirmedState}>
          <div aria-hidden="true" className={styles.confirmedStamp}>
            <span>NYC</span>
            <strong>CONFIRMED</strong>
          </div>
          <div className={styles.confirmedContent}>
            <h1 className={styles.title}>Your postcard order is confirmed.</h1>
            <p>Thank you for supporting handmade art.</p>
            <dl className={styles.summary}>
              <div><dt>Postcard</dt><dd>{dollars(state.subtotalAmountCents)}</dd></div>
              <div><dt>Shipping</dt><dd>{dollars(state.shippingAmountCents)}</dd></div>
              <div className={styles.total}><dt>Total</dt><dd>{dollars(state.totalAmountCents)}</dd></div>
            </dl>
            <Link className={styles.secondaryAction} href="/">Return Home</Link>
          </div>
        </div>
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
          <h1 className={styles.title}>We’re still confirming your order.</h1>
          <p>Your payment may still be complete. You can safely check again here.</p>
          <div className={styles.actions}>
            <button className={styles.primaryAction} onClick={checkAgain} type="button">
              Check Again
            </button>
            <Link className={styles.secondaryAction} href="/">Return Home</Link>
          </div>
        </>
      ) : null}
    </section>
  );
}
