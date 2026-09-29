import {
  dayPeriodForHour,
  newYorkDayPeriod,
} from "../../../lib/newYorkTime";

export type SceneTheme = "day" | "night";

export const themeForHour = (hour: number): SceneTheme =>
  dayPeriodForHour(hour);

export function calculateTheme(
  instant: Date | number,
  override: string | null,
): SceneTheme {
  if (override === "day" || override === "night") return override;
  return typeof instant === "number"
    ? themeForHour(instant)
    : newYorkDayPeriod(instant);
}

type SceneThemeMonitorOptions = {
  addPopstateListener: (callback: () => void) => () => void;
  now: () => Date;
  onTheme: (theme: SceneTheme) => void;
  readOverride: () => string | null;
  setRecurringUpdate: (
    callback: () => void,
    milliseconds: number,
  ) => () => void;
};

export const startSceneThemeMonitor = ({
  addPopstateListener,
  now,
  onTheme,
  readOverride,
  setRecurringUpdate,
}: SceneThemeMonitorOptions) => {
  let active = true;
  const update = () => {
    if (active) onTheme(calculateTheme(now(), readOverride()));
  };
  update();
  const clearRecurringUpdate = setRecurringUpdate(update, 30_000);
  const removePopstateListener = addPopstateListener(update);
  return () => {
    if (!active) return;
    active = false;
    clearRecurringUpdate();
    removePopstateListener();
  };
};
