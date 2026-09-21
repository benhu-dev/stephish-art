// Timeline units map linearly to the sticky scene's entire scroll distance.
export const SCROLL_TIMING = {
  duration: 1000,
  coinAppear: 80,
  coinTravel: 150,
  coinTravelDuration: 240,
  coinInserted: 390,
  printStart: 500,
  printDuration: 390,
  complete: 890,
  scrollHeight: "500svh",
} as const;

export function getStage(progress: number) {
  const time = progress * SCROLL_TIMING.duration;
  if (time >= SCROLL_TIMING.complete) return 3;
  if (time >= SCROLL_TIMING.printStart) return 2;
  if (time >= SCROLL_TIMING.coinInserted) return 1;
  return 0;
}

export const STAGE_COPY = [
  "Scroll to slip a coin inside.",
  "A little patience. A little magic.",
  "Your little piece of New York is printing.",
  "Made with love. Yours to keep.",
] as const;
