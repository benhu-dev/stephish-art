export type SceneTheme = "day" | "night";

export function calculateTheme(hour: number, override: string | null): SceneTheme {
  if (override === "day" || override === "night") return override;
  return hour >= 6 && hour < 18 ? "day" : "night";
}
