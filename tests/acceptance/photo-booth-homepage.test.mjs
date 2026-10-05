import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("homepage composes the Photo Booth story before the existing park scene", async () => {
  const [page, home] = await Promise.all([
    read("src/app/(frontend)/page.tsx"),
    read("src/features/photo-booth/components/PhotoBoothHome.tsx"),
  ]);

  assert.match(page, /<PhotoBoothHome/);
  const orderedSections = [
    "photo-booth-hero",
    "photo-booth-about",
    "photo-booth-gallery",
    "photo-booth-transition",
    "<PostcardScene",
  ];
  let lastIndex = -1;
  for (const section of orderedSections) {
    const index = home.indexOf(section);
    assert.ok(index > lastIndex, `${section} should follow the previous homepage section`);
    lastIndex = index;
  }
  assert.match(home, /Steph&apos;s<br \/>Photobooth/);
  assert.match(home, /Drop Your Coins/);
  assert.match(home, /Real event photos will live here/);
  assert.match(home, /src="\/videos\/example\.mp4"/);
  assert.match(home, /poster="\/videos\/example-poster\.jpg"/);
  assert.match(home, /preload="auto"/);
  assert.doesNotMatch(home, /onCanPlay/);
});

test("homepage owns one unchanged checkout modal shared by both purchase entry points", async () => {
  const [home, scene, narrative] = await Promise.all([
    read("src/features/photo-booth/components/PhotoBoothHome.tsx"),
    read("src/features/postcard-machine/components/PostcardScene.tsx"),
    read("src/features/postcard-machine/components/ScrollNarrative.tsx"),
  ]);

  assert.equal(home.match(/<ArtisticCheckoutModal/g)?.length, 1);
  assert.match(home, /checkoutTriggerRef\.current = trigger/);
  assert.match(home, /<PostcardScene onOpenCheckout={openCheckout} theme={theme}/);
  assert.match(scene, /<ScrollNarrative onOpenCheckout={onOpenCheckout}/);
  assert.match(narrative, /onOpenCheckout\(event\.currentTarget\)/);
  assert.doesNotMatch(narrative, /ArtisticCheckoutModal/);
});

test("homepage visual foundation includes responsive, theme, focus, and reduced-motion states", async () => {
  const [home, styles] = await Promise.all([
    read("src/features/photo-booth/components/PhotoBoothHome.tsx"),
    read("src/features/photo-booth/photo-booth.css"),
  ]);

  assert.match(home, /data-theme={theme}/);
  assert.match(home, /role="img" aria-label={moment\.label}/);
  assert.match(home, /aria-labelledby="photo-booth-title"/);
  assert.match(home, /motionPreference\.matches \|\| document\.hidden/);
  assert.match(home, /video\.pause\(\)/);
  assert.match(home, /video\.play\(\)/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /data-theme="night"/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce/);
  assert.match(styles, /orientation:\s*landscape/);
  assert.match(styles, /max-width:\s*600px/);
  assert.match(styles, /overflow-x:\s*clip/);
  assert.match(styles, /\.photo-booth-hero-video\s*\{[^}]*object-fit:\s*cover/s);
  assert.doesNotMatch(styles, /\.photo-booth-hero-video\s*\{[^}]*opacity:\s*0/s);
  assert.match(styles, /\.photo-booth-hero-shade\s*\{[^}]*linear-gradient\(180deg,[^}]*#fffdf394/s);
  assert.match(styles, /prefers-reduced-motion:[^}]+\}[\s\S]*\.photo-booth-hero-video\s*\{[^}]*display:\s*none/s);
});
