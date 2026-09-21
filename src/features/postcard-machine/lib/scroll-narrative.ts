export const NARRATIVE_MOMENTS = [
  { copy: "Every memory deserves a place to land.", startsAt: 0.08 },
  { copy: "Drop in a little inspiration.", startsAt: 0.2 },
  { copy: "Hold still — something personal is developing.", startsAt: 0.44 },
  { copy: "A small piece of your story, made by hand.", startsAt: 0.68 },
] as const;

export const CTA_REVEAL_PROGRESS = 0.92;
export const PRESENTATION_THRESHOLD_BUFFER = 0.008;
export const HERO_PRESENTATION_INDEX = 0;
export const NARRATIVE_PRESENTATION_OFFSET = 1;
export const CTA_PRESENTATION_INDEX = NARRATIVE_MOMENTS.length + 1;
export const PRESENTATION_THRESHOLDS = [
  0,
  ...NARRATIVE_MOMENTS.map(({ startsAt }) => startsAt),
  CTA_REVEAL_PROGRESS,
] as const;

export function getBufferedPresentationIndex(
  progress: number,
  currentIndex: number,
  buffer = PRESENTATION_THRESHOLD_BUFFER,
) {
  const bounded = Math.min(1, Math.max(0, progress));
  let selected = Math.min(PRESENTATION_THRESHOLDS.length - 1, Math.max(0, currentIndex));
  while (
    selected < PRESENTATION_THRESHOLDS.length - 1
    && bounded >= PRESENTATION_THRESHOLDS[selected + 1] + buffer
  ) selected += 1;
  while (selected > 0 && bounded < PRESENTATION_THRESHOLDS[selected] - buffer) selected -= 1;
  return selected;
}

export function getNarrativeState(progress: number) {
  const bounded = Math.min(1, Math.max(0, progress));
  let activeIndex = 0;
  for (let index = 0; index < NARRATIVE_MOMENTS.length; index += 1) {
    if (bounded >= NARRATIVE_MOMENTS[index].startsAt) activeIndex = index;
  }
  return { activeIndex, ctaVisible: bounded >= CTA_REVEAL_PROGRESS };
}
