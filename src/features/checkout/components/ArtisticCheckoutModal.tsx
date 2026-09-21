"use client";

import { type ChangeEvent, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  INITIAL_CHECKOUT_LIMITS,
  formatUsdInput,
  parseUsdAmount,
  validatePhotoSelection,
} from "../clientCheckoutDraft";
import { submitCheckoutAmount } from "../checkoutIntentClient";
import { CheckoutAmountStep } from "./CheckoutAmountStep";
import { CheckoutPhotoStep, type LocalPhotoPreview } from "./CheckoutPhotoStep";
import { CheckoutReviewStep } from "./CheckoutReviewStep";
import "./checkout-modal.css";

type Props = {
  onClose: () => void;
  open: boolean;
  theme: "day" | "night";
  triggerRef: RefObject<HTMLButtonElement | null>;
};

const FOCUSABLE = "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";

export function ArtisticCheckoutModal({ onClose, open, theme, triggerRef }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceIndexRef = useRef<number | null>(null);
  const nextPhotoId = useRef(0);
  const photosRef = useRef<LocalPhotoPreview[]>([]);
  const requestControllerRef = useRef<AbortController | null>(null);
  const [step, setStep] = useState(1);
  const [amountCents, setAmountCents] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);
  const [amountPending, setAmountPending] = useState(false);
  const [limits, setLimits] = useState(INITIAL_CHECKOUT_LIMITS);
  const [photos, setPhotos] = useState<LocalPhotoPreview[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => () => {
    requestControllerRef.current?.abort();
    photosRef.current.forEach(({ previewUrl }) => URL.revokeObjectURL(previewUrl));
  }, []);

  const closeModal = useCallback(() => {
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    setAmountPending(false);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeModal();
        return;
      }
      if (event.key === "Tab") {
        const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable.at(-1)!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [closeModal, open, triggerRef]);

  const commitPhotos = (next: LocalPhotoPreview[]) => {
    photosRef.current = next;
    setPhotos(next);
  };
  const acceptFiles = (selected: File[], replaceIndex: number | null) => {
    const incoming = replaceIndex === null ? selected : selected.slice(0, 1);
    const remaining = replaceIndex === null ? photos : photos.filter((_, index) => index !== replaceIndex);
    const result = validatePhotoSelection(remaining.map(({ file }) => file), incoming, limits);
    if (result.error) {
      setPhotoError(result.error);
      return;
    }
    const additions = incoming.map((file) => ({
      file,
      id: ++nextPhotoId.current,
      previewUrl: URL.createObjectURL(file),
    }));
    if (replaceIndex === null) commitPhotos([...photos, ...additions]);
    else {
      URL.revokeObjectURL(photos[replaceIndex].previewUrl);
      const next = [...photos];
      next.splice(replaceIndex, 1, additions[0]);
      commitPhotos(next);
    }
    setPhotoError(null);
  };
  const onChoose = (event: ChangeEvent<HTMLInputElement>) => {
    acceptFiles(Array.from(event.target.files ?? []), replaceIndexRef.current);
    replaceIndexRef.current = null;
    event.target.value = "";
  };
  const openPicker = (replaceIndex: number | null) => {
    replaceIndexRef.current = replaceIndex;
    inputRef.current?.click();
  };
  const removePhoto = (index: number) => {
    URL.revokeObjectURL(photos[index].previewUrl);
    commitPhotos(photos.filter((_, photoIndex) => photoIndex !== index));
  };
  const onCustomAmount = (value: string) => {
    setCustomAmount(value);
    const result = parseUsdAmount(value, limits.minimumAmountCents);
    setAmountCents(result.cents);
    setAmountError(result.error);
  };
  const choosePreset = (cents: number) => {
    setCustomAmount("");
    setAmountCents(cents);
    setAmountError(null);
  };
  const saveAmount = async () => {
    if (amountCents === null || requestControllerRef.current) return;
    const submittedAmountCents = amountCents;
    const usedCustomAmount = customAmount !== "";
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setAmountPending(true);
    setAmountError(null);
    try {
      const result = await submitCheckoutAmount(submittedAmountCents, { signal: controller.signal });
      if (requestControllerRef.current !== controller) return;
      if (!result.ok) {
        setAmountError(result.message);
        return;
      }
      setAmountCents(result.value.amountCents);
      setLimits(result.value.limits);
      if (usedCustomAmount || result.value.amountCents !== submittedAmountCents) {
        setCustomAmount(formatUsdInput(result.value.amountCents));
      }
      setStep(2);
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
        setAmountPending(false);
      }
    }
  };

  if (!open) return null;
  return createPortal(
    <div className="checkout-modal-overlay" data-checkout-modal data-theme={theme}>
      <div aria-labelledby="checkout-modal-title" aria-modal="true" className="checkout-paper" ref={dialogRef} role="dialog">
        <span className="paper-tape paper-tape-left" aria-hidden="true" />
        <span className="paper-tape paper-tape-right" aria-hidden="true" />
        <button aria-label="Close checkout preview" className="modal-close" data-initial-focus onClick={closeModal} type="button">×</button>
        <ol aria-label="Checkout preview progress" className="step-progress">
          {[1, 2, 3].map((number) => <li aria-current={step === number ? "step" : undefined} key={number}>{number}</li>)}
        </ol>
        {step === 1 && <CheckoutAmountStep
          amountCents={amountCents}
          customAmount={customAmount}
          error={amountError}
          minimumAmountCents={limits.minimumAmountCents}
          onCustomAmount={onCustomAmount}
          onPreset={choosePreset}
          pending={amountPending}
        />}
        {step === 2 && <CheckoutPhotoStep
          error={photoError}
          inputRef={inputRef}
          limits={limits}
          note={note}
          onChoose={onChoose}
          onDrop={(files) => acceptFiles(files, null)}
          onOpenPicker={openPicker}
          onRemove={removePhoto}
          photos={photos}
          setNote={setNote}
        />}
        {step === 3 && amountCents !== null && <CheckoutReviewStep
          amountCents={amountCents}
          onFinish={() => setNotice("Your choices are saved in this preview. Secure checkout is not connected yet.")}
          photos={photos}
        />}
        <div className="modal-actions">
          {step > 1 && <button className="back-button" onClick={() => setStep(step - 1)} type="button">Back</button>}
          {step < 3 && <button
            className="continue-button"
            disabled={step === 1 ? amountCents === null || amountPending : photos.length === 0}
            onClick={() => { if (step === 1) void saveAmount(); else setStep(step + 1); }}
            type="button"
          >{step === 1 && amountPending ? "Saving your amount…" : "Continue"}</button>}
        </div>
        <p aria-live="polite" className="modal-notice">{notice}</p>
      </div>
    </div>,
    document.body,
  );
}
