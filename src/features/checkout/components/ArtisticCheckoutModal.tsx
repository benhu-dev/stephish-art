"use client";

import { type ChangeEvent, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  INITIAL_CHECKOUT_LIMITS,
  formatUsdInput,
  parseUsdAmount,
  validatePhotoSelection,
} from "../clientCheckoutDraft";
import { saveCheckoutArtistNote, submitCheckoutAmount } from "../checkoutIntentClient";
import { abandonCurrentCheckout, readCurrentCheckoutState } from "../checkoutRecoveryClient";
import { requestCheckoutSession } from "../checkoutSessionClient";
import { deletePhoto, readCurrentPhotos, uploadPhoto } from "../checkoutPhotoClient";
import { createCheckoutPhotoPreviewManager } from "../checkoutPhotoPreviewClient";
import type { SafeUpload } from "../checkoutIntentClient";
import { CheckoutAmountStep } from "./CheckoutAmountStep";
import { CheckoutPhotoStep, type PhotoEntry } from "./CheckoutPhotoStep";
import { CheckoutRecoveryStep } from "./CheckoutRecoveryStep";
import { CheckoutReviewStep } from "./CheckoutReviewStep";
import "./checkout-modal.css";

type Props = {
  onClose: () => void;
  open: boolean;
  theme: "day" | "night";
  triggerRef: RefObject<HTMLButtonElement | null>;
};

const FOCUSABLE = "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";
const matchesLocalFile = (upload: SafeUpload, file: File) =>
  upload.mimeType === file.type && upload.sizeBytes === file.size;

export function ArtisticCheckoutModal({ onClose, open, theme, triggerRef }: Props) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const replacePositionRef = useRef<number | null>(null);
  const nextPhotoId = useRef(0);
  const photosRef = useRef<PhotoEntry[]>([]);
  const previewManagerRef = useRef<ReturnType<typeof createCheckoutPhotoPreviewManager> | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);
  const hydratedRef = useRef(false);
  const photoActionRef = useRef(false);
  const [step, setStep] = useState(1);
  const [amountCents, setAmountCents] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);
  const [amountPending, setAmountPending] = useState(false);
  const [limits, setLimits] = useState(INITIAL_CHECKOUT_LIMITS);
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoPending, setPhotoPending] = useState(false);
  const [note, setNote] = useState("");
  const [confirmedNote, setConfirmedNote] = useState("");
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [checkoutPending, setCheckoutPending] = useState(false);
  const [confirmStartOver, setConfirmStartOver] = useState(false);
  const [hydrating, setHydrating] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recoveryPending, setRecoveryPending] = useState<"abandon" | "resume" | null>(null);

  const getPreviewManager = useCallback(() => {
    previewManagerRef.current ??= createCheckoutPhotoPreviewManager();
    return previewManagerRef.current;
  }, []);

  useEffect(() => () => {
    const controller = requestControllerRef.current;
    requestControllerRef.current = null;
    controller?.abort();
    photosRef.current.forEach(({ local }) => { if (local) URL.revokeObjectURL(local.previewUrl); });
    const previewManager = previewManagerRef.current;
    previewManagerRef.current = null;
    previewManager?.dispose();
  }, []);

  const closeModal = useCallback(() => {
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    setAmountPending(false);
    setCheckoutPending(false);
    setHydrating(false);
    setRecoveryPending(null);
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

  const commitPhotos = useCallback((next: PhotoEntry[]) => {
    const missing = next.filter((photo) =>
      photo.server && !photo.local && !photo.serverPreview,
    );
    const requestedIds = new Set(missing.map((photo) => photo.server!.id));
    const sorted = next.map((photo) =>
      photo.server && requestedIds.has(photo.server.id)
        ? { ...photo, serverPreview: { status: "loading" as const } }
        : photo,
    ).sort((a, b) => a.position - b.position);
    photosRef.current = sorted;
    setPhotos(sorted);

    if (requestedIds.size === 0) return;
    const previewManager = getPreviewManager();
    for (const uploadId of requestedIds) {
      void previewManager.load(uploadId).then((result) => {
        if (result.kind === "aborted") return;
        const current = photosRef.current.find(
          (photo) => photo.server?.id === uploadId,
        );
        if (!current || current.local) {
          if (result.kind === "ready") {
            previewManager.release(uploadId);
          }
          return;
        }
        const updated = photosRef.current.map((photo) =>
          photo.server?.id === uploadId
            ? {
                ...photo,
                serverPreview: result.kind === "ready"
                  ? { previewUrl: result.previewUrl, status: "ready" as const }
                  : { status: "failed" as const },
              }
            : photo,
        ).sort((first, second) => first.position - second.position);
        photosRef.current = updated;
        setPhotos(updated);
      });
    }
  }, [getPreviewManager]);

  const mergeUploads = useCallback((uploads: SafeUpload[], created = false) => {
    const existing = photosRef.current;
    const retainedServerIds = new Set(uploads.map((upload) => upload.id));
    for (const old of existing) {
      if (old.server && !retainedServerIds.has(old.server.id)) {
        previewManagerRef.current?.release(old.server.id);
      }
    }
    const next: PhotoEntry[] = [];
    for (const position of [1, 2, 3] as const) {
      const old = existing.find((photo) => photo.position === position);
      const server = uploads.find((upload) => upload.position === position);
      if (server) {
        const sameServer = old?.server?.id === server.id;
        const keepLocal = Boolean(old?.local && (sameServer || (
          (old.status === "uploading" || old.status === "uncertain") &&
          matchesLocalFile(server, old.local.file)
        )));
        if (old?.server && !sameServer) {
          previewManagerRef.current?.release(old.server.id);
        }
        if (old?.local && !keepLocal) {
          URL.revokeObjectURL(old.local.previewUrl);
        }
        next.push({
          position,
          server,
          ...(keepLocal ? { local: old!.local } : {}),
          ...(sameServer && old?.serverPreview
            ? { serverPreview: old.serverPreview }
            : {}),
          status: "confirmed",
        });
      }
      else if (old?.local) next.push({ position, local: old.local, status: created || old.status !== "failed" ? "local" : "failed" });
    }
    commitPhotos(next);
  }, [commitPhotos]);

  const resetCheckoutClientState = useCallback((message: string | null = null) => {
    const controller = requestControllerRef.current;
    requestControllerRef.current = null;
    controller?.abort();
    photosRef.current.forEach(({ local }) => {
      if (local) URL.revokeObjectURL(local.previewUrl);
    });
    photosRef.current = [];
    previewManagerRef.current?.dispose();
    previewManagerRef.current = null;
    photoActionRef.current = false;
    hydratedRef.current = true;
    setAmountCents(null);
    setCustomAmount("");
    setAmountError(message);
    setAmountPending(false);
    setLimits(INITIAL_CHECKOUT_LIMITS);
    setPhotos([]);
    setPhotoError(null);
    setPhotoPending(false);
    setNote("");
    setConfirmedNote("");
    setCheckoutError(null);
    setCheckoutPending(false);
    setConfirmStartOver(false);
    setHydrating(false);
    setRecovery(false);
    setRecoveryError(null);
    setRecoveryPending(null);
    setStep(1);
  }, []);

  useEffect(() => {
    if (!open || hydratedRef.current || requestControllerRef.current) return;
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setHydrating(true);
    void readCurrentCheckoutState({ signal: controller.signal }).then((result) => {
      if (requestControllerRef.current !== controller) return;
      hydratedRef.current = result.kind !== "aborted";
      if (result.kind === "draft") {
        setAmountCents(result.state.amountCents);
        setCustomAmount(formatUsdInput(result.state.amountCents));
        setLimits(result.state.limits);
        setNote(result.state.artistNote);
        setConfirmedNote(result.state.artistNote);
        mergeUploads(result.state.uploads);
      } else if (result.kind === "recovery") {
        setRecovery(true);
      } else if (result.kind === "processing") {
        router.push("/checkout/success");
      } else if (result.kind === "fresh") {
        resetCheckoutClientState();
      } else if (result.kind === "failed") {
        setAmountError("We couldn't restore your checkout. You can try saving your amount again.");
      }
    }).finally(() => {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
        setHydrating(false);
      }
    });
    return () => {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
        controller.abort();
        setHydrating(false);
      }
    };
  }, [mergeUploads, open, resetCheckoutClientState, router]);
  const unavailableIntent = () => {
    resetCheckoutClientState("That checkout is no longer available. Start a fresh order below.");
  };
  const acceptFiles = async (selected: File[], replacePosition: number | null) => {
    if (photoActionRef.current) return;
    const incoming = replacePosition === null ? selected : selected.slice(0, 1);
    const remaining = photosRef.current.filter(({ position }) => position !== replacePosition);
    const result = validatePhotoSelection(remaining.map(({ local, server }) => ({
      size: local?.file.size ?? server?.sizeBytes ?? 0,
      type: local?.file.type ?? server?.mimeType ?? "image/png",
      name: "",
    })), incoming, limits);
    if (result.error) {
      setPhotoError(result.error);
      return;
    }
    if (replacePosition !== null) {
      const old = photosRef.current.find((photo) => photo.position === replacePosition);
      if (!old) return;
      if (old.server) {
        const removed = await removePhoto(replacePosition);
        if (!removed) return;
      } else if (old.local) {
        URL.revokeObjectURL(old.local.previewUrl);
        commitPhotos(photosRef.current.filter((photo) => photo.position !== replacePosition));
      }
    }
    const occupied = new Set(photosRef.current.map(({ position }) => position));
    const available = ([1, 2, 3] as const).filter((position) => !occupied.has(position));
    const positions = replacePosition === null ? available : [replacePosition as 1 | 2 | 3];
    const additions: PhotoEntry[] = incoming.map((file, index) => ({
      position: positions[index], status: "local",
      local: { file, id: ++nextPhotoId.current, previewUrl: URL.createObjectURL(file) },
    }));
    commitPhotos([...photosRef.current, ...additions]);
    setPhotoError(null);
  };
  const onChoose = (event: ChangeEvent<HTMLInputElement>) => {
    void acceptFiles(Array.from(event.target.files ?? []), replacePositionRef.current);
    replacePositionRef.current = null;
    event.target.value = "";
  };
  const openPicker = (replacePosition: number | null) => {
    if (photoActionRef.current) return;
    replacePositionRef.current = replacePosition;
    inputRef.current?.click();
  };
  const retryPhotoPreview = (position: number) => {
    const entry = photosRef.current.find((photo) => photo.position === position);
    if (!entry?.server || entry.local) return;
    previewManagerRef.current?.release(entry.server.id);
    commitPhotos(photosRef.current.map((photo) =>
      photo.position === position
        ? { ...photo, serverPreview: undefined }
        : photo,
    ));
  };
  const removePhoto = async (position: number): Promise<boolean> => {
    if (photoActionRef.current) return false;
    const entry = photosRef.current.find((photo) => photo.position === position);
    if (!entry) return false;
    if (!entry.server) {
      if (entry.local) URL.revokeObjectURL(entry.local.previewUrl);
      commitPhotos(photosRef.current.filter((photo) => photo.position !== position));
      setPhotoError(null);
      return true;
    }
    photoActionRef.current = true;
    setPhotoPending(true);
    commitPhotos(photosRef.current.map((photo) => photo.position === position ? { ...photo, status: "deleting" } : photo));
    try {
      let result = await deletePhoto(entry.server.id);
      if (result.kind === "uncertain") {
        result = await readCurrentPhotos();
        if (result.kind === "confirmed") {
          const stillPresent = result.state.uploads.some((upload) => upload.id === entry.server?.id);
          if (!stillPresent) result = { kind: "deleted" };
        }
      }
      if (result.kind === "unavailable") { unavailableIntent(); return false; }
      if (result.kind === "deleted") {
        previewManagerRef.current?.release(entry.server.id);
        if (entry.local) URL.revokeObjectURL(entry.local.previewUrl);
        commitPhotos(photosRef.current.filter((photo) => photo.position !== position));
        setPhotoError(null);
        return true;
      }
      commitPhotos(photosRef.current.map((photo) => photo.position === position ? { ...photo, status: "failed" } : photo));
      setPhotoError("We couldn't remove that photo. Please try again.");
      return false;
    } finally {
      photoActionRef.current = false;
      setPhotoPending(false);
    }
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
        if (result.reason === "conflict") {
          const current = await readCurrentCheckoutState({ signal: controller.signal });
          if (requestControllerRef.current !== controller) return;
          if (current.kind === "recovery") {
            setRecovery(true);
            setRecoveryError(null);
            return;
          }
          if (current.kind === "processing") {
            router.push("/checkout/success");
            return;
          }
          if (current.kind === "fresh") {
            resetCheckoutClientState("That checkout is no longer available. Start a fresh order below.");
            return;
          }
        }
        if (result.reason === "fresh") {
          resetCheckoutClientState("That checkout is no longer available. Start a fresh order below.");
          return;
        }
        setAmountError(result.message);
        return;
      }
      setAmountCents(result.value.amountCents);
      setNote(result.value.artistNote);
      setConfirmedNote(result.value.artistNote);
      setLimits(result.value.limits);
      mergeUploads(result.value.uploads, result.value.created);
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

  const continuePhotos = async () => {
    if (photoActionRef.current || photosRef.current.length === 0) return;
    photoActionRef.current = true;
    setPhotoPending(true);
    setPhotoError(null);
    try {
      if (photosRef.current.some(({ status }) => status === "uncertain")) {
        const current = await readCurrentPhotos();
        if (current.kind === "unavailable") { unavailableIntent(); return; }
        if (current.kind !== "confirmed") {
          setPhotoError("We couldn't check your photos. Please check your connection and try again.");
          return;
        }
        mergeUploads(current.state.uploads);
      }
      if (photosRef.current.some(({ server, status }) => server && status === "failed")) {
        setPhotoError("A confirmed photo needs attention. Remove or replace it before continuing.");
        return;
      }
      for (const position of [1, 2, 3] as const) {
        const entry = photosRef.current.find((photo) => photo.position === position);
        if (!entry || entry.server || !entry.local) continue;
        commitPhotos(photosRef.current.map((photo) => photo.position === position ? { ...photo, status: "uploading" } : photo));
        let result = await uploadPhoto(entry.local.file, position);
        if (result.kind === "uncertain") result = await readCurrentPhotos();
        if (result.kind === "unavailable") { unavailableIntent(); return; }
        if (result.kind === "confirmed") {
          mergeUploads(result.state.uploads);
          if (result.state.uploads.some((upload) =>
            upload.position === position && matchesLocalFile(upload, entry.local!.file))) continue;
        }
        commitPhotos(photosRef.current.map((photo) => photo.position === position ? {
          ...photo, status: result.kind === "uncertain" ? "uncertain" : "failed",
        } : photo));
        setPhotoError(result.kind === "uncertain"
          ? "We couldn't confirm that upload. Check your connection and try again."
          : "One photo couldn't be uploaded. Please try again.");
        return;
      }
      if (photosRef.current.length > 0 && photosRef.current.every(({ server, status }) => server && status === "confirmed")) {
        const noteResult = await saveCheckoutArtistNote(note);
        if (!noteResult.ok) {
          setPhotoError(noteResult.message);
          return;
        }
        setNote(noteResult.value.artistNote);
        setConfirmedNote(noteResult.value.artistNote);
        setStep(3);
      }
    } finally {
      photoActionRef.current = false;
      setPhotoPending(false);
    }
  };

  const openSecureCheckout = async (fromRecovery = false) => {
    if (requestControllerRef.current) return;
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setCheckoutPending(true);
    setCheckoutError(null);
    if (fromRecovery) {
      setRecoveryPending("resume");
      setRecoveryError(null);
    }
    try {
      const result = await requestCheckoutSession({ signal: controller.signal });
      if (requestControllerRef.current !== controller) return;
      if (result.kind === "failed") {
        if (fromRecovery) setRecoveryError(result.message);
        else setCheckoutError(result.message);
        return;
      }
      if (result.kind === "ready") {
        window.location.assign(result.checkoutUrl);
      } else if (result.kind === "processing") {
        router.push("/checkout/success");
      } else if (result.kind === "fresh") {
        resetCheckoutClientState("That checkout is no longer available. Start a fresh order below.");
      }
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
        setCheckoutPending(false);
        setRecoveryPending(null);
      }
    }
  };

  const startNewOrder = async () => {
    if (requestControllerRef.current) return;
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setRecoveryPending("abandon");
    setRecoveryError(null);
    try {
      const result = await abandonCurrentCheckout({ signal: controller.signal });
      if (requestControllerRef.current !== controller) return;
      if (result.kind === "abandoned" || result.kind === "fresh") {
        resetCheckoutClientState(
          result.kind === "fresh"
            ? "That checkout is no longer available. Start a fresh order below."
            : null,
        );
      } else if (result.kind === "processing") {
        router.push("/checkout/success");
      } else if (result.kind === "failed") {
        setRecoveryError(result.message);
      }
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
        setRecoveryPending(null);
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
        {!hydrating && !recovery && <ol aria-label="Checkout preview progress" className="step-progress">
          {[1, 2, 3].map((number) => <li aria-current={step === number ? "step" : undefined} key={number}>{number}</li>)}
        </ol>}
        {hydrating && <section className="checkout-step recovery-step" aria-labelledby="checkout-modal-title">
          <p className="step-kicker">One moment</p>
          <h2 id="checkout-modal-title">Checking your checkout…</h2>
        </section>}
        {!hydrating && recovery && <CheckoutRecoveryStep
          confirmStartOver={confirmStartOver}
          error={recoveryError}
          onCancelStartOver={() => setConfirmStartOver(false)}
          onConfirmStartOver={() => { void startNewOrder(); }}
          onResume={() => { void openSecureCheckout(true); }}
          onStartOver={() => setConfirmStartOver(true)}
          pending={recoveryPending}
        />}
        {!hydrating && !recovery && step === 1 && <CheckoutAmountStep
          amountCents={amountCents}
          customAmount={customAmount}
          error={amountError}
          minimumAmountCents={limits.minimumAmountCents}
          onCustomAmount={onCustomAmount}
          onPreset={choosePreset}
          pending={amountPending}
        />}
        {!hydrating && !recovery && step === 2 && <CheckoutPhotoStep
          error={photoError}
          inputRef={inputRef}
          limits={limits}
          note={note}
          onChoose={onChoose}
          onDrop={(files) => { void acceptFiles(files, null); }}
          onOpenPicker={openPicker}
          onRemove={(position) => { void removePhoto(position); }}
          onRetryPreview={retryPhotoPreview}
          pending={photoPending}
          photos={photos}
          setNote={setNote}
        />}
        {!hydrating && !recovery && step === 3 && amountCents !== null && <CheckoutReviewStep
          amountCents={amountCents}
          artistNote={confirmedNote}
          checkoutError={checkoutError}
          checkoutPending={checkoutPending}
          onFinish={() => { void openSecureCheckout(); }}
          onRetryPreview={retryPhotoPreview}
          photos={photos}
        />}
        {!hydrating && !recovery && <div className="modal-actions">
          {step > 1 && <button className="back-button" disabled={photoPending || checkoutPending} onClick={() => {
            setCheckoutError(null);
            setStep(step - 1);
          }} type="button">Back</button>}
          {step < 3 && <button
            className="continue-button"
            disabled={step === 1 ? amountCents === null || amountPending : photos.length === 0 || photoPending}
            onClick={() => { if (step === 1) void saveAmount(); else void continuePhotos(); }}
            type="button"
          >{step === 1 && amountPending ? "Saving your amount…" : step === 2 && photoPending ? "Uploading photos…" : "Continue"}</button>}
        </div>}
      </div>
    </div>,
    document.body,
  );
}
