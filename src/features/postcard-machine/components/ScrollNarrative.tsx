"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { AnimationEvent } from "react";
import { ArtisticCheckoutModal } from "../../checkout/components/ArtisticCheckoutModal";
import {
  PRESENTATION_TRANSITION_FALLBACK_MS,
  createNarrativeTransition,
  narrativeTransitionReducer,
} from "../lib/narrative-transition";
import {
  CTA_PRESENTATION_INDEX,
  HERO_PRESENTATION_INDEX,
  NARRATIVE_MOMENTS,
  NARRATIVE_PRESENTATION_OFFSET,
} from "../lib/scroll-narrative";
import type { SceneTheme } from "../lib/theme";

type Props = { presentationIndex: number; theme: SceneTheme };

export function ScrollNarrative({ presentationIndex, theme }: Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeModal = useCallback(() => setModalOpen(false), []);
  const [transition, dispatch] = useReducer(
    narrativeTransitionReducer,
    HERO_PRESENTATION_INDEX,
    createNarrativeTransition,
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    dispatch({ immediate: reducedMotion, stage: presentationIndex, type: "request" });
  }, [presentationIndex, reducedMotion]);
  useEffect(() => {
    if (transition.phase === "settled") return;
    const fallback = window.setTimeout(
      () => dispatch({ type: "finish" }),
      PRESENTATION_TRANSITION_FALLBACK_MS,
    );
    return () => window.clearTimeout(fallback);
  }, [transition.displayed, transition.phase]);

  const finishTransition = (event: AnimationEvent<HTMLElement>) => {
    if (event.currentTarget === event.target) dispatch({ type: "finish" });
  };
  const presentationProps = (index: number) => {
    const active = transition.displayed === index;
    return {
      "aria-hidden": !active,
      "data-phase": active ? transition.phase : "inactive",
      "data-presentation-active": active,
      "data-presentation-index": index,
      onAnimationEnd: finishTransition,
    };
  };
  const ctaSettled = transition.displayed === CTA_PRESENTATION_INDEX
    && transition.phase === "settled";
  const announcedCopy = transition.displayed === CTA_PRESENTATION_INDEX
    ? "Want one of your own? Draw Me One."
    : transition.displayed >= NARRATIVE_PRESENTATION_OFFSET
      ? NARRATIVE_MOMENTS[transition.displayed - NARRATIVE_PRESENTATION_OFFSET].copy
      : "";

  return (
    <>
      <section className="scroll-narrative" aria-label="Postcard story">
        <div
          className="scene-heading presentation-group text-center"
          data-scene-heading
          {...presentationProps(HERO_PRESENTATION_INDEX)}
        >
          <p className="eyebrow">A tiny souvenir. A big little city.</p>
          <h1>A little piece of <em>New York.</em></h1>
          <p className="intro">One coin. One postcard. A little everyday magic.</p>
        </div>
        <div className="narrative-copy">
          {NARRATIVE_MOMENTS.map((moment, index) => (
            <p
              className="presentation-group"
              data-narrative-index={index}
              data-narrative-stage
              key={moment.copy}
              {...presentationProps(index + NARRATIVE_PRESENTATION_OFFSET)}
            >
              {moment.copy}<span data-narrative-mark />
            </p>
          ))}
        </div>
        <div
          className="final-cta presentation-group"
          data-final-cta
          {...presentationProps(CTA_PRESENTATION_INDEX)}
        >
          <p className="cta-kicker">Your turn</p>
          <h2>Want one of your own?</h2>
          <p>Choose your price and turn your favorite photo into a postcard.</p>
          <button
            onClick={() => setModalOpen(true)}
            ref={triggerRef}
            tabIndex={ctaSettled ? 0 : -1}
            type="button"
          >
            Draw Me One <span aria-hidden="true">↗</span>
          </button>
        </div>
        <p aria-atomic="true" aria-live="polite" className="sr-only" role="status">
          {announcedCopy}
        </p>
      </section>
      <ArtisticCheckoutModal
        onClose={closeModal}
        open={modalOpen}
        theme={theme}
        triggerRef={triggerRef}
      />
    </>
  );
}
