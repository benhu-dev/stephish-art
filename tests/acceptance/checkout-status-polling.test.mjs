import assert from "node:assert/strict";
import test from "node:test";

import {
  CHECKOUT_STATUS_POLL_INTERVAL_MS,
  CHECKOUT_STATUS_POLL_LIMIT_MS,
  createCheckoutStatusPoller,
} from "../../src/features/checkout/checkoutStatusPolling.ts";

const flush = () => new Promise((resolve) => setImmediate(resolve));

const fakeClock = () => {
  let now = 0;
  let nextID = 0;
  const timers = new Map();
  return {
    clearTimeout: (id) => timers.delete(id),
    now: () => now,
    pending: () => timers.size,
    setTimeout: (callback, delay) => {
      const id = ++nextID;
      timers.set(id, { at: now + delay, callback });
      return id;
    },
    tick: async (milliseconds) => {
      now += milliseconds;
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= now);
      for (const [id, timer] of due) {
        timers.delete(id);
        timer.callback();
      }
      await flush();
    },
  };
};

const fakeVisibility = () => {
  let listener;
  let visible = true;
  return {
    emit: () => listener?.(),
    isVisible: () => visible,
    setVisible: (value) => {
      visible = value;
    },
    subscribe: (nextListener) => {
      listener = nextListener;
      return () => {
        listener = undefined;
      };
    },
  };
};

test("processing alone polls at a bounded interval and confirmation stops it", async () => {
  assert.equal(CHECKOUT_STATUS_POLL_INTERVAL_MS > 0, true);
  assert.equal(CHECKOUT_STATUS_POLL_LIMIT_MS, 60_000);
  const clock = fakeClock();
  const visibility = fakeVisibility();
  const states = [];
  const responses = [
    { state: "processing" },
    {
      currency: "usd",
      shippingAmountCents: 100,
      state: "confirmed",
      subtotalAmountCents: 800,
      totalAmountCents: 900,
    },
  ];
  const poller = createCheckoutStatusPoller({
    clock,
    onState: (state) => states.push(state),
    readStatus: async () => responses.shift(),
    visibility,
  });

  poller.start();
  await flush();
  assert.deepEqual(states.map(({ phase }) => phase), ["loading", "processing"]);
  assert.equal(clock.pending(), 1);

  await clock.tick(CHECKOUT_STATUS_POLL_INTERVAL_MS);
  assert.equal(states.at(-1).phase, "confirmed");
  assert.equal(clock.pending(), 0);
  poller.stop();
});

test("polling stops by 60 seconds and exposes a timeout state", async () => {
  const clock = fakeClock();
  const states = [];
  let requests = 0;
  const poller = createCheckoutStatusPoller({
    clock,
    onState: (state) => states.push(state),
    readStatus: async () => {
      requests += 1;
      return { state: "processing" };
    },
    visibility: fakeVisibility(),
  });

  poller.start();
  await flush();
  await clock.tick(CHECKOUT_STATUS_POLL_LIMIT_MS);
  assert.equal(states.at(-1).phase, "timeout");
  assert.equal(clock.pending(), 0);
  const requestsAtTimeout = requests;
  await clock.tick(CHECKOUT_STATUS_POLL_LIMIT_MS);
  assert.equal(requests, requestsAtTimeout);
  poller.stop();
});

test("visibility retries do not overlap and stop aborts the active request", async () => {
  const clock = fakeClock();
  const visibility = fakeVisibility();
  let resolveFirst;
  let secondSignal;
  let requests = 0;
  const poller = createCheckoutStatusPoller({
    clock,
    onState() {},
    readStatus: (signal) => {
      requests += 1;
      if (requests === 1) {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      secondSignal = signal;
      return new Promise(() => {});
    },
    visibility,
  });

  poller.start();
  visibility.emit();
  visibility.emit();
  assert.equal(requests, 1);
  resolveFirst({ state: "processing" });
  await flush();

  visibility.setVisible(false);
  visibility.emit();
  assert.equal(requests, 1);
  visibility.setVisible(true);
  visibility.emit();
  assert.equal(requests, 2);
  visibility.emit();
  assert.equal(requests, 2);

  poller.stop();
  assert.equal(secondSignal.aborted, true);
  assert.equal(clock.pending(), 0);
});

test("expired, not-started, and unavailable responses never poll", async () => {
  for (const [response, phase] of [
    [{ state: "expired" }, "expired"],
    [{ state: "not_started" }, "not_started"],
  ]) {
    const clock = fakeClock();
    const states = [];
    const poller = createCheckoutStatusPoller({
      clock,
      onState: (state) => states.push(state),
      readStatus: async () => response,
      visibility: fakeVisibility(),
    });
    poller.start();
    await flush();
    assert.equal(states.at(-1).phase, phase);
    assert.equal(clock.pending(), 0);
    poller.stop();
  }

  const clock = fakeClock();
  const states = [];
  const poller = createCheckoutStatusPoller({
    clock,
    onState: (state) => states.push(state),
    readStatus: async () => {
      throw new Error("generic failure");
    },
    visibility: fakeVisibility(),
  });
  poller.start();
  await flush();
  assert.equal(states.at(-1).phase, "unavailable");
  assert.equal(clock.pending(), 0);
  poller.stop();
});
