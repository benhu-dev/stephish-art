"use client";

import { type RefObject, useEffect } from "react";

const MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const MOBILE_QUERY = "(max-width: 800px)";

export function calculateParallaxOffset(
  top: number,
  height: number,
  viewportHeight: number,
  distance: number,
  strength = 1,
) {
  const elementCenter = top + height / 2;
  const viewportCenter = viewportHeight / 2;
  const travel = Math.max(1, (viewportHeight + height) / 2);
  const normalized = Math.max(-1, Math.min(1, (viewportCenter - elementCenter) / travel));
  return normalized * distance * strength;
}

export function usePhotoBoothMotion(rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reducedMotion = window.matchMedia(MOTION_QUERY);
    const mobileViewport = window.matchMedia(MOBILE_QUERY);
    let disposeSetup = () => {};

    const setup = () => {
      disposeSetup();
      const revealNodes = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
      const parallaxNodes = Array.from(root.querySelectorAll<HTMLElement>("[data-parallax]"));
      root.dataset.motionReady = "true";

      if (reducedMotion.matches) {
        revealNodes.forEach((node) => { node.dataset.revealed = "true"; });
        parallaxNodes.forEach((node) => node.style.setProperty("--parallax-y", "0px"));
        disposeSetup = () => {};
        return;
      }

      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          (entry.target as HTMLElement).dataset.revealed = "true";
          observer.unobserve(entry.target);
        });
      }, { rootMargin: "0px 0px -10%", threshold: 0.12 });
      revealNodes.forEach((node) => observer.observe(node));

      let animationFrame = 0;
      const updateParallax = () => {
        animationFrame = 0;
        const strength = mobileViewport.matches ? 0.28 : 1;
        parallaxNodes.forEach((node) => {
          const distance = Number(node.dataset.parallax ?? 0);
          const rect = node.getBoundingClientRect();
          const offset = calculateParallaxOffset(
            rect.top,
            rect.height,
            window.innerHeight,
            distance,
            strength,
          );
          node.style.setProperty("--parallax-y", `${offset.toFixed(2)}px`);
        });
      };
      const requestParallaxUpdate = () => {
        if (animationFrame) return;
        animationFrame = window.requestAnimationFrame(updateParallax);
      };
      updateParallax();
      window.addEventListener("resize", requestParallaxUpdate);
      window.addEventListener("scroll", requestParallaxUpdate, { passive: true });
      mobileViewport.addEventListener("change", requestParallaxUpdate);
      disposeSetup = () => {
        observer.disconnect();
        if (animationFrame) window.cancelAnimationFrame(animationFrame);
        window.removeEventListener("resize", requestParallaxUpdate);
        window.removeEventListener("scroll", requestParallaxUpdate);
        mobileViewport.removeEventListener("change", requestParallaxUpdate);
      };
    };

    setup();
    reducedMotion.addEventListener("change", setup);
    return () => {
      reducedMotion.removeEventListener("change", setup);
      disposeSetup();
      delete root.dataset.motionReady;
    };
  }, [rootRef]);
}
