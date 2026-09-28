import assert from "node:assert/strict";
import test from "node:test";

import {
  CHECKOUT_LOADER_DELAY_MS,
  CHECKOUT_SLOW_MESSAGE_DELAY_MS,
  createCheckoutResultPresentation,
} from "../../src/features/checkout/checkoutResultPresentation.ts";

const fakeClock = () => {
  let now = 0;
  let nextID = 0;
  const timers = new Map();
  return {
    clearTimeout: (id) => timers.delete(id),
    pending: () => timers.size,
    setTimeout: (callback, delay) => {
      const id = ++nextID;
      timers.set(id, { at: now + delay, callback });
      return id;
    },
    tick(milliseconds) {
      now += milliseconds;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
  };
};

test("loader stays hidden for 150ms, then appears without delaying polling", () => {
  const clock = fakeClock();
  const events = [];
  const presentation = createCheckoutResultPresentation({
    clock,
    onLoaderVisible: () => events.push("loader"),
    onSlow: () => events.push("slow"),
  });

  presentation.start();
  assert.equal(clock.pending(), 2);
  clock.tick(CHECKOUT_LOADER_DELAY_MS - 1);
  assert.deepEqual(events, []);
  clock.tick(1);
  assert.deepEqual(events, ["loader"]);
});

test("fast confirmation cancels the loader before it can flash", () => {
  const clock = fakeClock();
  const events = [];
  const presentation = createCheckoutResultPresentation({
    clock,
    onLoaderVisible: () => events.push("loader"),
    onSlow: () => events.push("slow"),
  });

  presentation.start();
  presentation.stop();
  clock.tick(CHECKOUT_SLOW_MESSAGE_DELAY_MS);
  assert.deepEqual(events, []);
  assert.equal(clock.pending(), 0);
});

test("slow copy appears deterministically at 12 seconds and cleanup cancels timers", () => {
  const clock = fakeClock();
  const events = [];
  const presentation = createCheckoutResultPresentation({
    clock,
    onLoaderVisible: () => events.push("loader"),
    onSlow: () => events.push("slow"),
  });

  presentation.start();
  clock.tick(CHECKOUT_LOADER_DELAY_MS);
  clock.tick(CHECKOUT_SLOW_MESSAGE_DELAY_MS - CHECKOUT_LOADER_DELAY_MS - 1);
  assert.deepEqual(events, ["loader"]);
  clock.tick(1);
  assert.deepEqual(events, ["loader", "slow"]);
  presentation.stop();
  assert.equal(clock.pending(), 0);
});
