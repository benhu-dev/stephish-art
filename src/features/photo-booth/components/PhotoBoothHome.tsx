"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArtisticCheckoutModal } from "../../checkout/components/ArtisticCheckoutModal";
import { PostcardScene } from "../../postcard-machine/components/PostcardScene";
import { useSceneTheme } from "../../postcard-machine/hooks/useSceneTheme";
import { usePhotoBoothMotion } from "../hooks/usePhotoBoothMotion";
import "../photo-booth.css";

const EVENT_MOMENTS = [
  {
    caption: "A tiny portrait, drawn in the middle of the city.",
    label: "Temporary artwork for an outdoor portrait pop-up photo",
    variant: "park",
  },
  {
    caption: "Come as you are - people, pets, and favorite smiles welcome.",
    label: "Temporary artwork for a guest portrait photo",
    variant: "portrait",
  },
  {
    caption: "Made by hand, then carried home as a little keepsake.",
    label: "Temporary artwork for a finished postcard photo",
    variant: "postcard",
  },
] as const;

function HeroBackgroundVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPlayback = () => {
      if (motionPreference.matches || document.hidden) {
        video.pause();
        return;
      }
      void video.play().catch(() => {
        // The static artwork remains visible when autoplay is unavailable.
      });
    };
    syncPlayback();
    motionPreference.addEventListener("change", syncPlayback);
    document.addEventListener("visibilitychange", syncPlayback);
    return () => {
      motionPreference.removeEventListener("change", syncPlayback);
      document.removeEventListener("visibilitychange", syncPlayback);
      video.pause();
    };
  }, [unavailable]);

  if (unavailable) return null;
  return (
    <video
      aria-hidden="true"
      className="photo-booth-hero-video"
      disablePictureInPicture
      loop
      muted
      onError={() => setUnavailable(true)}
      playsInline
      poster="/videos/example-poster.jpg"
      preload="auto"
      ref={videoRef}
      tabIndex={-1}
    >
      <source src="/videos/example.mp4" type="video/mp4" />
    </video>
  );
}

export function PhotoBoothHome() {
  const theme = useSceneTheme();
  const homeRef = useRef<HTMLElement>(null);
  const checkoutTriggerRef = useRef<HTMLButtonElement>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const openCheckout = useCallback((trigger: HTMLButtonElement) => {
    checkoutTriggerRef.current = trigger;
    setCheckoutOpen(true);
  }, []);
  const closeCheckout = useCallback(() => setCheckoutOpen(false), []);
  usePhotoBoothMotion(homeRef);

  return (
    <main className="photo-booth-home" data-theme={theme} ref={homeRef}>
      <section className="photo-booth-hero" aria-labelledby="photo-booth-title">
        <div className="photo-booth-hero-media photo-booth-motion" data-parallax="18" aria-hidden="true">
          <HeroBackgroundVideo />
        </div>
        <div className="photo-booth-hero-shade" aria-hidden="true" />
        <header className="photo-booth-masthead">
          <a className="photo-booth-wordmark" href="#photo-booth-title" aria-label="Stephish.art home">
            Stephish.art <span aria-hidden="true">✳</span>
          </a>
          <span className="photo-booth-place">New York City · Online</span>
        </header>
        <div className="photo-booth-hero-copy photo-booth-motion" data-parallax="-8">
          <p className="photo-booth-kicker">Portraits from the park, wherever you are</p>
          <h1 id="photo-booth-title">Steph&apos;s<br />Photobooth</h1>
          <p className="photo-booth-lede">
            Can&apos;t make it to the park? Is the line too long? I made a little online version just for that.
          </p>
          <div className="photo-booth-hero-actions">
            <button className="photo-booth-primary-action" onClick={(event) => openCheckout(event.currentTarget)} type="button">
              Drop Your Coins <span aria-hidden="true">↗</span>
            </button>
            <a className="photo-booth-text-link" href="#meet-stephish">Meet Stephish <span aria-hidden="true">↓</span></a>
          </div>
        </div>
        <p className="photo-booth-scroll-cue" aria-hidden="true">Scroll for the story <span>↓</span></p>
      </section>

      <section className="photo-booth-about" id="meet-stephish" aria-labelledby="about-stephish-title">
        <div className="photo-booth-section-label photo-booth-motion" data-reveal>
          <span>01</span>
          <p>Meet the artist</p>
        </div>
        <div className="photo-booth-about-copy">
          <p className="photo-booth-definition photo-booth-motion" data-reveal>Stephish <i>(n.)</i><br /><span>Steph + fish</span></p>
          <h2 className="photo-booth-motion photo-booth-reveal-delay-1" data-reveal id="about-stephish-title">A little fish swimming through the sea of art.</h2>
          <div className="photo-booth-about-columns photo-booth-motion photo-booth-reveal-delay-2" data-reveal>
            <p>
              Stephish is a Taiwanese illustrator living in New York. She started her park pop-up photobooth to meet interesting souls and bring a little lively energy to the city.
            </p>
            <p>
              Each mini portrait turns an everyday smile into something personal: a small piece of your story, drawn by hand and made to keep.
            </p>
          </div>
        </div>
        <aside className="photo-booth-note photo-booth-motion photo-booth-reveal-delay-2" data-reveal aria-label="A note from Stephish">
          <span aria-hidden="true">↘</span>
          hoping to bring a little happiness to your heart.
        </aside>
      </section>

      <section className="photo-booth-gallery" aria-labelledby="event-moments-title">
        <div className="photo-booth-gallery-heading">
          <div className="photo-booth-section-label photo-booth-section-label-light photo-booth-motion" data-reveal>
            <span>02</span>
            <p>In the wild</p>
          </div>
          <h2 className="photo-booth-motion photo-booth-reveal-delay-1" data-reveal id="event-moments-title">Little moments<br />from the park.</h2>
          <p className="photo-booth-motion photo-booth-reveal-delay-2" data-reveal>Real event photos will live here. For now, these art-directed frames hold their place without changing the page structure.</p>
        </div>
        <div className="photo-booth-gallery-grid">
          {EVENT_MOMENTS.map((moment, index) => (
            <figure
              className={`photo-booth-moment photo-booth-moment-${moment.variant} photo-booth-motion photo-booth-reveal-delay-${Math.min(index, 2)}`}
              data-parallax={index === 1 ? "-12" : index === 2 ? "9" : "14"}
              data-reveal
              key={moment.variant}
            >
              <div className="photo-booth-moment-art" role="img" aria-label={moment.label}>
                <span className="moment-sun" />
                <span className="moment-line moment-line-one" />
                <span className="moment-line moment-line-two" />
                <span className="moment-subject" />
                <span className="moment-card" />
              </div>
              <figcaption><span>0{index + 1}</span>{moment.caption}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="photo-booth-transition" aria-labelledby="park-transition-title">
        <p>And if you keep wandering...</p>
        <h2 id="park-transition-title">The park is just below.</h2>
        <span aria-hidden="true">↓</span>
      </section>

      <PostcardScene onOpenCheckout={openCheckout} theme={theme} />

      <ArtisticCheckoutModal
        onClose={closeCheckout}
        open={checkoutOpen}
        theme={theme}
        triggerRef={checkoutTriggerRef}
      />
    </main>
  );
}
