import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

import {
  BUSINESS_TIME_ZONE,
  formatNewYorkBusinessDateTime,
  getNewYorkDateTimeParts,
  newYorkDayPeriod,
} from "../../src/lib/newYorkTime.ts";
import {
  calculateTheme,
  startSceneThemeMonitor,
  themeForHour,
} from "../../src/features/postcard-machine/lib/theme.ts";

test("New York parts derive winter EST and summer EDT from the IANA zone", () => {
  assert.equal(BUSINESS_TIME_ZONE, "America/New_York");
  assert.deepEqual(
    getNewYorkDateTimeParts(new Date("2027-01-15T10:59:00.000Z")),
    { day: 15, hour: 5, minute: 59, month: 1, second: 0, year: 2027 },
  );
  assert.deepEqual(
    getNewYorkDateTimeParts(new Date("2027-07-15T09:59:00.000Z")),
    { day: 15, hour: 5, minute: 59, month: 7, second: 0, year: 2027 },
  );
  assert.match(
    formatNewYorkBusinessDateTime(new Date("2027-01-15T17:00:00.000Z")),
    /12:00 PM EST.*New York time/,
  );
  assert.match(
    formatNewYorkBusinessDateTime(new Date("2027-07-15T16:00:00.000Z")),
    /12:00 PM EDT.*New York time/,
  );
});

test("the existing 06:00 and 18:00 scene boundaries are unchanged", () => {
  assert.equal(themeForHour(5), "night");
  assert.equal(themeForHour(6), "day");
  assert.equal(themeForHour(17), "day");
  assert.equal(themeForHour(18), "night");

  assert.equal(newYorkDayPeriod(new Date("2027-01-15T10:59:00.000Z")), "night");
  assert.equal(newYorkDayPeriod(new Date("2027-01-15T11:00:00.000Z")), "day");
  assert.equal(newYorkDayPeriod(new Date("2027-01-15T22:59:00.000Z")), "day");
  assert.equal(newYorkDayPeriod(new Date("2027-01-15T23:00:00.000Z")), "night");
  assert.equal(newYorkDayPeriod(new Date("2027-07-15T09:59:00.000Z")), "night");
  assert.equal(newYorkDayPeriod(new Date("2027-07-15T10:00:00.000Z")), "day");
  assert.equal(newYorkDayPeriod(new Date("2027-07-15T21:59:00.000Z")), "day");
  assert.equal(newYorkDayPeriod(new Date("2027-07-15T22:00:00.000Z")), "night");
});

test("the same instant resolves identically under unrelated host timezones", () => {
  const program = [
    'import { newYorkDayPeriod } from "./src/lib/newYorkTime.ts";',
    'process.stdout.write(newYorkDayPeriod(new Date("2027-07-15T10:00:00.000Z")));',
  ].join("");
  const results = ["UTC", "America/Los_Angeles", "Asia/Taipei"].map((TZ) =>
    execFileSync(process.execPath, ["--input-type=module", "--eval", program], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, TZ },
    }),
  );
  assert.deepEqual(results, ["day", "day", "day"]);
});

test("valid query overrides win and invalid values use automatic New York time", () => {
  const nightInNewYork = new Date("2027-07-15T09:59:00.000Z");
  assert.equal(calculateTheme(nightInNewYork, "day"), "day");
  assert.equal(calculateTheme(nightInNewYork, "night"), "night");
  for (const invalid of [null, "", "dusk", "DAY", "night "]) {
    assert.equal(calculateTheme(nightInNewYork, invalid), "night");
  }
});

test("scene theme monitoring clears resources and ignores callbacks after cleanup", () => {
  const themes = [];
  let intervalCallback;
  let popstateCallback;
  let intervalClears = 0;
  let listenerRemovals = 0;
  const stop = startSceneThemeMonitor({
    addPopstateListener(callback) {
      popstateCallback = callback;
      return () => { listenerRemovals += 1; };
    },
    now: () => new Date("2027-01-15T11:00:00.000Z"),
    onTheme: (theme) => themes.push(theme),
    readOverride: () => null,
    setRecurringUpdate(callback, milliseconds) {
      assert.equal(milliseconds, 30_000);
      intervalCallback = callback;
      return () => { intervalClears += 1; };
    },
  });
  assert.deepEqual(themes, ["day"]);
  intervalCallback();
  popstateCallback();
  assert.deepEqual(themes, ["day", "day", "day"]);
  stop();
  assert.equal(intervalClears, 1);
  assert.equal(listenerRemovals, 1);
  intervalCallback();
  popstateCallback();
  assert.deepEqual(themes, ["day", "day", "day"]);
});
