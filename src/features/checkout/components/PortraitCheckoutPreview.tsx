"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useSceneTheme } from "../../postcard-machine/hooks/useSceneTheme";
import { PortraitCheckoutModal } from "./PortraitCheckoutModal";

export function PortraitCheckoutPreview() {
  const theme = useSceneTheme();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <main className="portrait-preview-page" data-theme={theme}>
        <p className="portrait-overline">Stephish.art · Development preview</p>
        <h1>
          A postcard for
          <br />
          your favorite faces.
        </h1>
        <p>
          Try the new Photo Booth draft flow. Confirmed portraits and private
          photos are saved in this browser&apos;s checkout.
        </p>
        <button
          type="button"
          ref={trigger}
          className="portrait-primary"
          onClick={() => setOpen(true)}
        >
          Drop Your Coins ↗
        </button>
        <Link href="/">Return to Photo Booth</Link>
        <small>
          Connected Sandbox checkout. Use test cards only.
        </small>
      </main>
      <PortraitCheckoutModal
        open={open}
        onClose={close}
        theme={theme}
        triggerRef={trigger}
      />
    </>
  );
}
