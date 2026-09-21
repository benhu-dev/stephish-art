"use client";

import { useEffect, useRef, useState } from "react";
import { animate, createTimeline, onScroll } from "animejs";
import { getStage, SCROLL_TIMING as timing } from "../lib/animation-config";
import { getBufferedPresentationIndex } from "../lib/scroll-narrative";

export function useScrollAnimation() {
  const containerRef = useRef<HTMLElement>(null);
  const [stage, setStage] = useState(0);
  const [presentationIndex, setPresentationIndex] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let dispose = () => {};
    const setup = () => {
      dispose();
      const coin = container.querySelector<SVGGElement>("[data-coin]")!;
      const postcard = container.querySelector<SVGGElement>("[data-postcard]")!;
      const meter = container.querySelector<HTMLElement>("[data-progress]")!;
      const reduced = media.matches;
      let selectedPresentationIndex = 0;
      const timeline = createTimeline({ autoplay: false, defaults: { ease: "linear" } });
      timeline.add(meter, { scaleX: [0, 1], duration: timing.duration }, 0);
      if (!reduced) {
        timeline
          .add(coin, { opacity: [0, 1], duration: 60 }, timing.coinAppear)
          .add(coin, { translateX: [0, 120], duration: timing.coinTravelDuration }, timing.coinTravel)
          .add(postcard, { translateY: [-166, 0], duration: timing.printDuration }, timing.printStart);
      }
      const update = (progress: number) => {
        setStage(getStage(progress));
        selectedPresentationIndex = getBufferedPresentationIndex(progress, selectedPresentationIndex);
        setPresentationIndex(selectedPresentationIndex);
        if (reduced) {
          // Discrete states preserve the story without movement through space.
          coin.style.opacity = progress < timing.coinInserted / timing.duration ? "1" : "0";
          postcard.style.transform = progress >= timing.printStart / timing.duration
            ? "translateY(0px)" : "translateY(-166px)";
        }
      };
      const observer = onScroll({
        target: container,
        enter: "top top",
        leave: "bottom bottom",
        sync: true,
        onUpdate: (self) => update(self.progress),
      });
      observer.link(timeline);
      update(observer.progress);
      timeline.seek(observer.progress * timing.duration);
      const ambient = reduced ? [] : [
        animate(container.querySelectorAll("[data-cloud]"), {
          translateX: [-18, 18], duration: 18000, alternate: true, loop: true, ease: "inOutSine",
        }),
        animate(container.querySelector("[data-shooting-star]")!, {
          translateX: [0, 170], translateY: [0, 95],
          opacity: [0, 0.7, 0], duration: 1400, loopDelay: 16000, delay: 8000, loop: true,
        }),
      ];
      const visibility = () => ambient.forEach((animation) => {
        if (document.hidden) animation.pause(); else animation.resume();
      });
      document.addEventListener("visibilitychange", visibility);
      dispose = () => {
        document.removeEventListener("visibilitychange", visibility);
        ambient.forEach((animation) => animation.revert());
        observer.revert();
        timeline.revert();
        coin.style.removeProperty("opacity");
        postcard.style.removeProperty("transform");
      };
    };
    setup();
    media.addEventListener("change", setup);
    return () => { dispose(); media.removeEventListener("change", setup); };
  }, []);

  return { containerRef, presentationIndex, stage };
}
