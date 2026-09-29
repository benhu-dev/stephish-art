export const BUSINESS_TIME_ZONE = "America/New_York";
export const SCENE_DAY_START_HOUR = 6;
export const SCENE_NIGHT_START_HOUR = 18;

export type NewYorkDateTimeParts = {
  day: number;
  hour: number;
  minute: number;
  month: number;
  second: number;
  year: number;
};

export type NewYorkDayPeriod = "day" | "night";

const partsFormatter = new Intl.DateTimeFormat("en-US-u-nu-latn", {
  day: "numeric",
  hour: "numeric",
  hourCycle: "h23",
  minute: "numeric",
  month: "numeric",
  second: "numeric",
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
});

const validInstant = (instant: Date) => {
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) {
    throw new Error("INVALID_TIME_INSTANT");
  }
  return instant;
};

export const getNewYorkDateTimeParts = (
  instant: Date,
): NewYorkDateTimeParts => {
  const values = Object.fromEntries(
    partsFormatter
      .formatToParts(validInstant(instant))
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, Number(value)]),
  );
  const { day, hour, minute, month, second, year } = values;
  if (
    [day, hour, minute, month, second, year].some(
      (value) => !Number.isInteger(value),
    )
  ) {
    throw new Error("NEW_YORK_TIME_FORMAT_UNAVAILABLE");
  }
  return { day, hour, minute, month, second, year };
};

export const dayPeriodForHour = (hour: number): NewYorkDayPeriod => {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error("INVALID_HOUR");
  }
  return hour >= SCENE_DAY_START_HOUR && hour < SCENE_NIGHT_START_HOUR
    ? "day"
    : "night";
};

export const newYorkDayPeriod = (instant: Date): NewYorkDayPeriod =>
  dayPeriodForHour(getNewYorkDateTimeParts(instant).hour);

export const formatNewYorkBusinessDateTime = (instant: Date) => {
  const formatted = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: BUSINESS_TIME_ZONE,
    timeZoneName: "short",
  }).format(validInstant(instant));
  return `${formatted} (New York time)`;
};
