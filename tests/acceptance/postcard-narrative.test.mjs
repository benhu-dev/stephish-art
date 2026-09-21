import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { SCROLL_TIMING } from "../../src/features/postcard-machine/lib/animation-config.ts";
import {
  CTA_PRESENTATION_INDEX,
  NARRATIVE_MOMENTS,
  PRESENTATION_THRESHOLDS,
  getBufferedPresentationIndex,
  getNarrativeState,
} from "../../src/features/postcard-machine/lib/scroll-narrative.ts";
import {
  createNarrativeTransition,
  narrativeTransitionReducer,
} from "../../src/features/postcard-machine/lib/narrative-transition.ts";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("narrative copy follows the coin and postcard story in both directions", () => {
  assert.deepEqual(NARRATIVE_MOMENTS.map(({ copy }) => copy), [
    "Every memory deserves a place to land.",
    "Drop in a little inspiration.",
    "Hold still — something personal is developing.",
    "A small piece of your story, made by hand.",
  ]);

  const forward = [0.1, 0.22, 0.46, 0.7, 0.95].map(getNarrativeState);
  assert.deepEqual(forward.map(({ activeIndex }) => activeIndex), [0, 1, 2, 3, 3]);
  assert.deepEqual(forward.map(({ ctaVisible }) => ctaVisible), [false, false, false, false, true]);

  const reverse = [0.95, 0.7, 0.46, 0.22, 0.1].map(getNarrativeState);
  assert.deepEqual(reverse, forward.toReversed());
});

test("hero, narrative, and CTA use one buffered presentation sequence", () => {
  assert.deepEqual(PRESENTATION_THRESHOLDS, [0, 0.08, 0.2, 0.44, 0.68, 0.92]);
  assert.equal(CTA_PRESENTATION_INDEX, 5);
  assert.equal(getBufferedPresentationIndex(0.205, 1), 1);
  assert.equal(getBufferedPresentationIndex(0.209, 1), 2);
  assert.equal(getBufferedPresentationIndex(0.195, 2), 2);
  assert.equal(getBufferedPresentationIndex(0.191, 2), 1);
  assert.equal(getBufferedPresentationIndex(0.95, 0), 5);
  assert.equal(getBufferedPresentationIndex(0.1, 5), 1);
});

test("late narrative stages have equal space and the final dwell is about one viewport", () => {
  const narrativeSpans = PRESENTATION_THRESHOLDS.slice(1).map(
    (threshold, index) => PRESENTATION_THRESHOLDS[index + 2] - threshold,
  );
  const earlierMaximum = Math.max(...narrativeSpans.slice(0, 2));
  assert.ok(narrativeSpans[2] >= earlierMaximum);
  assert.ok(narrativeSpans[3] >= earlierMaximum);

  assert.equal(SCROLL_TIMING.scrollHeight, "500svh");
  const scrollableViewports = Number.parseFloat(SCROLL_TIMING.scrollHeight) / 100 - 1;
  const finalDwellViewports = narrativeSpans[3] * scrollableViewports;
  assert.ok(finalDwellViewports >= 0.95 && finalDwellViewports <= 1.1);
});

test("transition state finishes the active phase and retains only the latest request", () => {
  let state = createNarrativeTransition(0);
  state = narrativeTransitionReducer(state, { type: "request", stage: 1 });
  assert.deepEqual(state, { displayed: 0, requested: 1, phase: "exiting" });

  state = narrativeTransitionReducer(state, { type: "request", stage: 2 });
  state = narrativeTransitionReducer(state, { type: "request", stage: 5 });
  assert.deepEqual(state, { displayed: 0, requested: 5, phase: "exiting" });

  state = narrativeTransitionReducer(state, { type: "finish" });
  assert.deepEqual(state, { displayed: 5, requested: 5, phase: "entering" });
  state = narrativeTransitionReducer(state, { type: "finish" });
  assert.deepEqual(state, { displayed: 5, requested: 5, phase: "settled" });

  state = narrativeTransitionReducer(state, { type: "request", stage: 1 });
  state = narrativeTransitionReducer(state, { type: "finish" });
  state = narrativeTransitionReducer(state, { type: "finish" });
  assert.deepEqual(state, { displayed: 1, requested: 1, phase: "settled" });
});

test("reduced-motion requests settle immediately on exactly one presentation", () => {
  let state = createNarrativeTransition(0);
  state = narrativeTransitionReducer(state, { immediate: true, type: "request", stage: 4 });
  assert.deepEqual(state, { displayed: 4, requested: 4, phase: "settled" });
});

test("scene renders one mutually exclusive hero, narrative, and CTA presentation", async () => {
  const [scene, narrative, scrollHook, styles] = await Promise.all([
    read("src/features/postcard-machine/components/PostcardScene.tsx"),
    read("src/features/postcard-machine/components/ScrollNarrative.tsx"),
    read("src/features/postcard-machine/hooks/useScrollAnimation.ts"),
    read("src/features/postcard-machine/scene.css"),
  ]);
  assert.match(scene, /<ScrollNarrative/);
  assert.doesNotMatch(scene, /data-scene-heading/);
  assert.match(narrative, /A tiny souvenir\. A big little city\./);
  assert.match(narrative, /Want one of your own\?/);
  assert.match(narrative, /Draw Me One/);
  assert.match(narrative, /Choose your price and turn your favorite photo into a postcard\./);
  assert.match(narrative, /data-narrative-stage/);
  assert.match(narrative, /data-presentation-index/);
  assert.match(narrative, /data-presentation-active/);
  assert.match(narrative, /data-phase/);
  assert.match(narrative, /onAnimationEnd/);
  assert.match(narrative, /setTimeout/);
  assert.match(narrative, /data-final-cta/);
  assert.doesNotMatch(scrollHook, /data-scene-heading/);
  assert.doesNotMatch(scrollHook, /data-final-cta/);
  assert.match(styles, /\.presentation-group\s*\{[^}]*opacity:\s*0[^}]*visibility:\s*hidden[^}]*pointer-events:\s*none/s);
  assert.match(styles, /@keyframes presentation-stage-exit/);
  assert.match(styles, /@keyframes presentation-stage-enter/);
});
