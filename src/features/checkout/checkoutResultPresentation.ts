export const CHECKOUT_LOADER_DELAY_MS = 150;
export const CHECKOUT_SLOW_MESSAGE_DELAY_MS = 12_000;

type PresentationClock = {
  clearTimeout: (handle: unknown) => void;
  setTimeout: (callback: () => void, delay: number) => unknown;
};

const browserClock: PresentationClock = {
  clearTimeout: (handle) => window.clearTimeout(handle as number),
  setTimeout: (callback, delay) => window.setTimeout(callback, delay),
};

export const createCheckoutResultPresentation = ({
  clock = browserClock,
  onLoaderVisible,
  onSlow,
}: {
  clock?: PresentationClock;
  onLoaderVisible: () => void;
  onSlow: () => void;
}) => {
  let loaderTimer: unknown;
  let running = false;
  let slowTimer: unknown;

  const clearTimers = () => {
    if (loaderTimer !== undefined) clock.clearTimeout(loaderTimer);
    if (slowTimer !== undefined) clock.clearTimeout(slowTimer);
    loaderTimer = undefined;
    slowTimer = undefined;
  };

  return {
    start() {
      if (running) return;
      running = true;
      loaderTimer = clock.setTimeout(() => {
        loaderTimer = undefined;
        if (running) onLoaderVisible();
      }, CHECKOUT_LOADER_DELAY_MS);
      slowTimer = clock.setTimeout(() => {
        slowTimer = undefined;
        if (running) onSlow();
      }, CHECKOUT_SLOW_MESSAGE_DELAY_MS);
    },
    stop() {
      if (!running) return;
      running = false;
      clearTimers();
    },
  };
};
