"use client";

import { useSceneTheme } from "../hooks/useSceneTheme";
import { useScrollAnimation } from "../hooks/useScrollAnimation";
import { SCROLL_TIMING, STAGE_COPY } from "../lib/animation-config";
import { MachineIllustration } from "./MachineIllustration";
import { ParkBackground } from "./ParkBackground";
import "../scene.css";

export function PostcardScene() {
  const theme = useSceneTheme();
  const { containerRef, stage } = useScrollAnimation();
  return (
    <main ref={containerRef} className="postcard-scroll" style={{ height: SCROLL_TIMING.scrollHeight }}>
      <section className="postcard-scene" data-theme={theme} aria-label="An illustrated postcard machine in a New York park">
        <ParkBackground />
        <header className="scene-header flex items-center justify-between">
          <span className="artist-signature">Stephish.art<span className="signature-star" aria-hidden="true">✳</span></span>
          <span className="scene-location">Handmade in New York <span aria-hidden="true">↗</span></span>
        </header>
        <div className="scene-heading text-center">
          <p className="eyebrow">A tiny souvenir. A big little city.</p>
          <h1>A little piece of <em>New York.</em></h1>
          <p className="intro">One coin. One postcard. A little everyday magic.</p>
        </div>
        <div className="machine-stage"><MachineIllustration /></div>
        <aside className="handwritten-note" aria-hidden="true">a little art,<br />just for you.<span>⤵</span></aside>
        <div className="scene-instructions text-center">
          <p role="status" aria-live="polite" aria-atomic="true">{STAGE_COPY[stage]}</p>
          <div className="progress-track" aria-hidden="true"><span data-progress /></div>
          <p className="scroll-hint">{stage === 3 ? "Scroll up to rewind" : "Scroll slowly to discover"} <span aria-hidden="true">{stage === 3 ? "↑" : "↓"}</span></p>
        </div>
        <footer className="scene-footer flex items-center justify-between">
          <span>Made by hand, with love.</span>
          <span className="theme-label"><span aria-hidden="true">{theme === "day" ? "☀" : "☾"}</span> {theme === "day" ? "Day in the park" : "Night in the park"}</span>
        </footer>
        <p className="sr-only">Scroll down to insert a coin, then print an illustrated New York postcard. Scroll up to reverse. With reduced motion enabled, the scene changes in steps.</p>
        <noscript><p className="no-script">Enable JavaScript to insert a coin and print your postcard.</p></noscript>
      </section>
    </main>
  );
}
