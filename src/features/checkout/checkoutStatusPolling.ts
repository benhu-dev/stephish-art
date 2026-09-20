export const CHECKOUT_STATUS_POLL_INTERVAL_MS = 2_000;
export const CHECKOUT_STATUS_POLL_LIMIT_MS = 60_000;

export type CheckoutStatusResponse =
  | { state: "expired" | "not_started" | "processing" }
  | {
      currency: "usd";
      shippingAmountCents: number;
      state: "confirmed";
      subtotalAmountCents: number;
      totalAmountCents: number;
    };

export type CheckoutStatusViewState =
  | { phase: "expired" | "loading" | "not_started" | "processing" }
  | { phase: "timeout" | "unavailable" }
  | ({ phase: "confirmed" } & Omit<
      Extract<CheckoutStatusResponse, { state: "confirmed" }>,
      "state"
    >);

type Clock = {
  clearTimeout: (handle: unknown) => void;
  now: () => number;
  setTimeout: (callback: () => void, delay: number) => unknown;
};

type Visibility = {
  isVisible: () => boolean;
  subscribe: (listener: () => void) => () => void;
};

const browserClock: Clock = {
  clearTimeout: (handle) => window.clearTimeout(handle as number),
  now: () => Date.now(),
  setTimeout: (callback, delay) => window.setTimeout(callback, delay),
};

const browserVisibility: Visibility = {
  isVisible: () => document.visibilityState === "visible",
  subscribe: (listener) => {
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  },
};

export const createCheckoutStatusPoller = ({
  clock = browserClock,
  onState,
  readStatus,
  visibility = browserVisibility,
}: {
  clock?: Clock;
  onState: (state: CheckoutStatusViewState) => void;
  readStatus: (signal: AbortSignal) => Promise<CheckoutStatusResponse>;
  visibility?: Visibility;
}) => {
  let activeController: AbortController | undefined;
  let phase: CheckoutStatusViewState["phase"] = "loading";
  let startedAt = 0;
  let stopped = false;
  let timer: unknown;

  const clearTimer = () => {
    if (timer !== undefined) clock.clearTimeout(timer);
    timer = undefined;
  };

  const publish = (state: CheckoutStatusViewState) => {
    phase = state.phase;
    onState(state);
  };

  const timeoutIfDue = () => {
    if (clock.now() - startedAt < CHECKOUT_STATUS_POLL_LIMIT_MS) return false;
    clearTimer();
    publish({ phase: "timeout" });
    return true;
  };

  const schedule = () => {
    clearTimer();
    const remaining = CHECKOUT_STATUS_POLL_LIMIT_MS - (clock.now() - startedAt);
    if (remaining <= 0) {
      publish({ phase: "timeout" });
      return;
    }
    timer = clock.setTimeout(
      () => void requestStatus(),
      Math.min(CHECKOUT_STATUS_POLL_INTERVAL_MS, remaining),
    );
  };

  const requestStatus = async () => {
    if (stopped || activeController || timeoutIfDue()) return;
    clearTimer();
    const controller = new AbortController();
    activeController = controller;

    try {
      const status = await readStatus(controller.signal);
      if (stopped) return;
      switch (status.state) {
        case "confirmed":
          publish({
            currency: status.currency,
            phase: "confirmed",
            shippingAmountCents: status.shippingAmountCents,
            subtotalAmountCents: status.subtotalAmountCents,
            totalAmountCents: status.totalAmountCents,
          });
          break;
        case "expired":
          publish({ phase: "expired" });
          break;
        case "not_started":
          publish({ phase: "not_started" });
          break;
        case "processing":
          if (!timeoutIfDue()) {
            publish({ phase: "processing" });
            schedule();
          }
          break;
      }
    } catch (error) {
      if (!stopped && !(error instanceof DOMException && error.name === "AbortError")) {
        publish({ phase: "unavailable" });
      }
    } finally {
      if (activeController === controller) activeController = undefined;
    }
  };

  const unsubscribe = visibility.subscribe(() => {
    if (visibility.isVisible() && phase === "processing" && !activeController) {
      void requestStatus();
    }
  });

  return {
    start() {
      if (stopped) return;
      startedAt = clock.now();
      publish({ phase: "loading" });
      void requestStatus();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearTimer();
      activeController?.abort();
      unsubscribe();
    },
  };
};
