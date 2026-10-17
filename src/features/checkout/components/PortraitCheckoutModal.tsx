"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { abandonCurrentCheckout } from "../checkoutRecoveryClient";
import { requestCheckoutSession } from "../checkoutSessionClient";
import {
  readPortraitRecovery,
  requestPortraitPayment,
  type PortraitRecovery,
} from "../portraitPaymentClient";
import {
  cartReady,
  changePortraitPhoto,
  money,
  readCart,
  readPreviewIntent,
  readTemplateCatalog,
  removePortrait,
  savePortrait,
  startPortraitDraft,
  uploadPortraitPhoto,
  validateNewPhoto,
  type CartPortrait,
  type CatalogTemplate,
  type ClientResult,
  type PortraitCart,
  type SubjectInput,
} from "../portraitCartClient";
import {
  CartStep,
  PhotosStep,
  PortraitReview,
  SubjectsStep,
  TemplateStep,
} from "./PortraitSteps";
import "./portrait-checkout.css";

// Template previews use the controlled catalog endpoint without optimizer caching.
/* eslint-disable @next/next/no-img-element */

type Step = "template" | "subjects" | "photos" | "review" | "cart";
type Props = {
  open: boolean;
  onClose: () => void;
  theme: "day" | "night";
  triggerRef: RefObject<HTMLButtonElement | null>;
};
const labels: Record<Step, string> = {
  template: "Choose your little world.",
  subjects: "Who's in the portrait?",
  photos: "A face to draw from.",
  review: "A little portrait, just for you.",
  cart: "Your postcard collection.",
};
const progress: Step[] = ["template", "subjects", "photos", "review"];
const FOCUSABLE =
  "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, a[href], [tabindex='0']";

export function PortraitCheckoutModal({
  open,
  onClose,
  theme,
  triggerRef,
}: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const confirmation = useRef<HTMLDivElement>(null);
  const active = useRef<AbortController | null>(null);
  const [step, setStep] = useState<Step>("template");
  const [catalog, setCatalog] = useState<CatalogTemplate[]>([]);
  const [cart, setCart] = useState<PortraitCart | null>(null);
  const [portraitId, setPortraitId] = useState<string | undefined>();
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [subjects, setSubjects] = useState<SubjectInput[]>([
    { kind: "person", name: "" },
  ]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<"legacy" | "payment" | null>(null);
  const [reloadRequired, setReloadRequired] = useState(false);
  const [startOver, setStartOver] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<CartPortrait | null>(null);
  const [region, setRegion] = useState<"us" | "international">("us");
  const [accepted, setAccepted] = useState(false);
  const [recovery, setRecovery] = useState<PortraitRecovery | null>(null);
  const portrait = cart?.portraits.find((p) => p.id === portraitId);
  const selectedTemplate =
    catalog.find((t) => t.id === templateId) ?? portrait?.template;

  useEffect(() => {
    if (startOver || removeTarget) {
      confirmation.current?.focus();
      confirmation.current?.scrollIntoView({ block: "nearest" });
    }
  }, [removeTarget, startOver]);

  const fresh = useCallback(() => {
    setCart(null);
    setPortraitId(undefined);
    setTemplateId(null);
    setSubjects([{ kind: "person", name: "" }]);
    setNote("");
    setStep("template");
    setBlocked(null);
    setStartOver(false);
    setRemoveTarget(null);
    setAccepted(false);
    setRegion("us");
    setRecovery(null);
  }, []);

  const hydrate = useCallback(async () => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setLoading(true);
    setBusy(false);
    setError(null);
    setReloadRequired(false);
    setRemoveTarget(null);
    setStartOver(false);
    try {
      const [templates, intent] = await Promise.all([
        readTemplateCatalog({ signal: controller.signal }),
        readPortraitRecovery({ signal: controller.signal }),
      ]);
      if (active.current !== controller) return;
      if (
        templates.kind !== "ready" &&
        !(
          intent.kind === "ready" &&
          ["checkout_pending", "checkout_created", "completed"].includes(
            intent.value.status,
          )
        )
      ) {
        setError(templates.message);
        setReloadRequired(true);
        return;
      }
      setCatalog(templates.kind === "ready" ? templates.value : []);
      if (
        intent.kind === "fresh" ||
        (intent.kind === "ready" && intent.value.status === "expired")
      ) {
        fresh();
        return;
      }
      if (intent.kind !== "ready") {
        setError(intent.message);
        setReloadRequired(true);
        return;
      }
      if (intent.value.status !== "draft") {
        setCart(null);
        setTemplateId(null);
        setRecovery(intent.value);
        if (intent.value.shippingRegion) setRegion(intent.value.shippingRegion);
        setBlocked("payment");
        return;
      }
      const result = await readCart({ signal: controller.signal });
      setRecovery(null);
      if (active.current !== controller) return;
      if (result.kind === "fresh") {
        fresh();
        return;
      }
      if (result.kind !== "ready") {
        setError(result.message);
        setReloadRequired(true);
        return;
      }
      setCart(result.value);
      if (!result.value.portraits.length) {
        setBlocked("legacy");
        return;
      }
      setBlocked(null);
      setRecovery(null);
      setStep("cart");
      setAccepted(false);
    } finally {
      if (active.current === controller) {
        active.current = null;
        setLoading(false);
      }
    }
  }, [fresh]);

  useEffect(() => {
    if (!open) return;
    void hydrate();
    return () => {
      active.current?.abort();
      active.current = null;
    };
  }, [hydrate, open]);

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    const background = Array.from(document.body.children).filter(
      (el): el is HTMLElement =>
        el instanceof HTMLElement && !el.hasAttribute("data-portrait-overlay"),
    );
    const priorInert = background.map((el) => el.inert);
    background.forEach((el) => {
      el.inert = true;
    });
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => dialog.current?.focus());
    const keydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key !== "Tab") return;
      const elements = Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
      ).filter(
        (el) =>
          !el.closest("fieldset[disabled]") && el.getClientRects().length > 0,
      );
      const first = elements[0];
      const last = elements.at(-1);
      if (!first) {
        e.preventDefault();
        dialog.current?.focus();
        return;
      }
      if (
        e.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === dialog.current)
      ) {
        e.preventDefault();
        last?.focus();
      } else if (
        !e.shiftKey &&
        (document.activeElement === last ||
          document.activeElement === dialog.current)
      ) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = previousOverflow;
      background.forEach((el, i) => {
        el.inert = priorInert[i];
      });
      trigger?.focus();
    };
  }, [onClose, open, triggerRef]);

  useEffect(() => {
    if (open && !loading && !blocked) {
      heading.current?.focus();
      dialog.current?.scrollTo({ top: 0 });
    }
  }, [blocked, loading, open, step]);

  const perform = async (
    work: (signal: AbortSignal) => Promise<ClientResult<PortraitCart>>,
    success?: (value: PortraitCart) => void,
  ) => {
    if (active.current || reloadRequired) return false;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError(null);
    try {
      const result = await work(controller.signal);
      if (active.current !== controller) return false;
      if (result.kind === "ready") {
        setCart(result.value);
        setAccepted(false);
        success?.(result.value);
        return true;
      } else if (result.kind === "fresh") {
        fresh();
        setError(result.message);
      } else if (result.kind !== "aborted") {
        setError(
          result.kind === "uncertain"
            ? "Your change may have been saved. Reload the draft before doing anything else."
            : result.message,
        );
        setReloadRequired(
          result.kind === "uncertain" || result.kind === "locked",
        );
      }
      return false;
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  };

  const saveDetails = async () => {
    if (!templateId || !subjects.every((s) => s.name.trim())) {
      setError("Give every person or pet a name before continuing.");
      return;
    }
    await perform(
      async (signal) => {
        if (!cart) {
          // Re-check before creating a draft; never overwrite an existing checkout.
          const current = await readPreviewIntent({ signal });
          if (current.kind !== "fresh")
            return {
              kind: "locked",
              message:
                "A checkout already exists in this browser. Reload before continuing.",
            };
          const intent = await startPortraitDraft({ signal });
          if (intent.kind !== "ready") return intent;
        }
        return savePortrait(
          { artistNote: note, subjects, templateId },
          portraitId,
          { signal },
        );
      },
      (next) => {
        const saved =
          next.portraits.find((p) => p.id === portraitId) ??
          next.portraits.at(-1)!;
        setPortraitId(saved.id);
        setSubjects(
          saved.subjects.map(({ id, kind, name }) => ({ id, kind, name })),
        );
        setNote(saved.artistNote);
        setStep("photos");
      },
    );
  };

  const leaveReview = (add: boolean) => {
    if (
      !portrait ||
      !cart ||
      !portrait.photoState.complete ||
      !portrait.template.available
    )
      return;
    void perform(
      (signal) =>
        savePortrait(
          {
            templateId: portrait.template.id,
            subjects: portrait.subjects.map(({ id, kind, name }) => ({
              id,
              kind,
              name,
            })),
            artistNote: note,
          },
          portrait.id,
          { signal },
        ),
      () => {
        if (add) {
          setPortraitId(undefined);
          setTemplateId(null);
          setSubjects([{ kind: "person", name: "" }]);
          setNote("");
          setStep("template");
        } else setStep("cart");
      },
    );
  };

  const edit = (p: CartPortrait) => {
    setPortraitId(p.id);
    setTemplateId(p.template.id);
    setSubjects(p.subjects.map(({ id, kind, name }) => ({ id, kind, name })));
    setNote(p.artistNote);
    setError(null);
    setStep("template");
  };
  const add = () => {
    setPortraitId(undefined);
    setTemplateId(null);
    setSubjects([{ kind: "person", name: "" }]);
    setNote("");
    setStep("template");
    setError(null);
  };
  const remove = () => {
    if (!removeTarget) return;
    const target = removeTarget;
    void perform(
      async (signal) => {
        for (const photo of target.photos) {
          const result = await changePortraitPhoto(target.id, photo.id, null, {
            signal,
          });
          if (result.kind !== "ready") return result;
          if (active.current?.signal !== signal)
            return { kind: "aborted", message: "" };
          setCart(result.value);
        }
        return removePortrait(target.id, { signal });
      },
      () => {
        setRemoveTarget(null);
        heading.current?.focus();
        dialog.current?.scrollTo({ top: 0 });
      },
    );
  };
  const abandon = async () => {
    if (active.current || recovery?.status === "completed") return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError(null);
    try {
      const result = await abandonCurrentCheckout({
        signal: controller.signal,
      });
      if (active.current !== controller) return;
      if (result.kind === "abandoned" || result.kind === "fresh") fresh();
      else {
        setError(
          "We couldn't start over. Reload the current draft before continuing.",
        );
        setReloadRequired(true);
      }
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  };

  const pay = async (resume = false) => {
    if (active.current || reloadRequired) return;
    if (!resume && (!cart || !cartReady(cart) || !accepted)) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError(null);
    try {
      const result = resume
        ? await requestCheckoutSession({ signal: controller.signal })
        : await requestPortraitPayment(region, { signal: controller.signal });
      if (active.current !== controller || result.kind === "aborted") return;
      if (result.kind === "ready") {
        window.location.assign(result.checkoutUrl);
        return;
      }
      if (result.kind === "fresh") {
        fresh();
        setError("This checkout has expired. Please start a new portrait.");
      } else {
        setError(
          result.kind === "failed"
            ? result.message
            : "Your payment state changed. Reload to continue safely.",
        );
        // The server may have reserved or created a Session, even on network/5xx failure.
        setReloadRequired(true);
      }
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  };

  if (!open) return null;
  const canContinue =
    step === "template"
      ? !!catalog.find((t) => t.id === templateId)
      : step === "subjects"
        ? subjects.every((s) => s.name.trim())
        : step === "photos"
          ? !!portrait?.photoState.complete && !!portrait.template.available
          : true;
  return createPortal(
    <div className="portrait-overlay" data-portrait-overlay data-theme={theme}>
      <div
        className="portrait-paper"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="portrait-title"
        aria-describedby="portrait-preview-notice"
        tabIndex={-1}
      >
        <header className="portrait-top">
          <span className="portrait-brand">
            Steph&apos;s Photobooth<span aria-hidden="true"> ✳</span>
          </span>
          <button
            className="portrait-close"
            type="button"
            aria-label="Close portrait checkout"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="portrait-layout">
          <aside className="portrait-sidebar">
            <span className="portrait-overline">From the park, with love</span>
            <div className="portrait-stamp" aria-hidden="true">
              NYC
              <br />
              <span>drawn by hand</span>
            </div>
            <p>
              A tiny keepsake.
              <br />A story only yours.
            </p>
            {selectedTemplate?.preview && (
              <img
                alt={selectedTemplate.preview.alt}
                src={selectedTemplate.preview.url}
                width={selectedTemplate.preview.width}
                height={selectedTemplate.preview.height}
              />
            )}
            <div className="portrait-sidebar-total">
              <span>
                {blocked === "payment"
                  ? recovery?.status === "completed"
                    ? "Payment confirmed"
                    : "Payment reserved"
                  : `${cart?.portraits.length ?? 0} / 5 portraits`}
              </span>
              {cart && <strong>{money(cart.subtotalCents)}</strong>}
            </div>
            <small id="portrait-preview-notice">
              Private references.
              <br />
              Secure card checkout.
            </small>
          </aside>
          <div className="portrait-content">
            <p className="portrait-overline">
              {loading
                ? "One moment"
                : blocked
                  ? "Your existing checkout"
                  : step === "cart"
                    ? "All together now"
                    : `Portrait ${portrait?.position ?? (cart?.portraits.length ?? 0) + 1} · ${progress.indexOf(step) + 1} of 4`}
            </p>
            <h2 id="portrait-title" ref={heading} tabIndex={-1}>
              {loading
                ? "Finding your postcards…"
                : blocked
                  ? "Let's keep your draft safe."
                  : labels[step]}
            </h2>
            {!loading && !blocked && step !== "cart" && (
              <ol className="portrait-progress" aria-label="Portrait progress">
                {progress.map((s, i) => (
                  <li key={s} aria-current={step === s ? "step" : undefined}>
                    <span>{String(i + 1).padStart(2, "0")}</span>
                    {
                      {
                        template: "Design",
                        subjects: "Friends",
                        photos: "Photos",
                        review: "Review",
                      }[s as Exclude<Step, "cart">]
                    }
                  </li>
                ))}
              </ol>
            )}
            {error && (
              <div className="portrait-error" role="alert">
                <p>{error}</p>
                {reloadRequired && (
                  <button
                    type="button"
                    className="portrait-secondary"
                    disabled={busy || loading}
                    onClick={() => {
                      void hydrate();
                    }}
                  >
                    Reload draft
                  </button>
                )}
              </div>
            )}
            {!loading && blocked && (
              <div className="portrait-recovery">
                <p>
                  {blocked === "payment"
                    ? recovery?.status === "completed"
                      ? "Your payment is confirmed. View your order status below."
                      : "A checkout has already moved to payment. Resume the reserved checkout below; its portrait details cannot be edited."
                    : "An older unfinished draft is saved in this browser. Its purchase flow has been retired. Confirm below to start a new portrait draft; nothing is discarded without your confirmation."}
                </p>
                <Link className="portrait-secondary" href="/">
                  Return to Photo Booth
                </Link>
                {blocked === "payment" && recovery?.status === "completed" ? (
                  <Link className="portrait-primary" href="/checkout/success">
                    View order status
                  </Link>
                ) : (
                  blocked === "payment" && (
                    <button
                      className="portrait-primary"
                      type="button"
                      disabled={busy || reloadRequired || startOver}
                      onClick={() => {
                        void pay(true);
                      }}
                    >
                      Resume secure checkout →
                    </button>
                  )
                )}
                {recovery?.totalAmountCents != null && (
                  <p>
                    Reserved total: {money(recovery.totalAmountCents)} ·{" "}
                    {recovery.shippingRegion === "us"
                      ? "US tracked shipping"
                      : "International untracked shipping"}
                  </p>
                )}
                {blocked === "payment" && recovery?.status !== "completed" && (
                  <button
                    type="button"
                    className="portrait-text-button"
                    disabled={busy || reloadRequired || startOver}
                    onClick={() => setStartOver(true)}
                  >
                    Start a new draft
                  </button>
                )}
                {blocked === "legacy" && (
                  <>
                    <button
                      type="button"
                      className="portrait-text-button"
                      disabled={busy || reloadRequired}
                      onClick={() => setStartOver(true)}
                    >
                      Start a new draft
                    </button>
                  </>
                )}
              </div>
            )}
            {!loading && !blocked && (
              <fieldset
                className="portrait-step-fields"
                disabled={
                  busy || reloadRequired || startOver || removeTarget !== null
                }
                aria-busy={busy}
              >
                <legend className="portrait-sr-only">{labels[step]}</legend>
                {step === "template" && (
                  <TemplateStep
                    templates={catalog}
                    selected={templateId}
                    choose={setTemplateId}
                  />
                )}
                {step === "subjects" && (
                  <SubjectsStep
                    subjects={subjects}
                    update={setSubjects}
                    portrait={portrait}
                  />
                )}
                {step === "photos" && portrait && cart && (
                  <PhotosStep
                    key={portrait.id}
                    portrait={portrait}
                    cart={cart}
                    busy={busy}
                    onContinue={() => setStep("review")}
                    onBack={() => setStep("subjects")}
                    upload={async (file, ids) => {
                      const problem = validateNewPhoto(
                        file,
                        portrait,
                        cart,
                        ids,
                      );
                      if (problem) {
                        setError(problem);
                        return false;
                      }
                      return perform((signal) =>
                        uploadPortraitPhoto(
                          portrait.id,
                          file,
                          {
                            position: portrait.photos.length + 1,
                            subjectIds: ids,
                          },
                          { signal },
                        ),
                      );
                    }}
                    change={(photo, ids) => {
                      return perform((signal) =>
                        changePortraitPhoto(
                          portrait.id,
                          photo.id,
                          { position: photo.position, subjectIds: ids },
                          { signal },
                        ),
                      );
                    }}
                    remove={(photo) => {
                      void perform((signal) =>
                        changePortraitPhoto(portrait.id, photo.id, null, {
                          signal,
                        }),
                      );
                    }}
                  />
                )}
                {step === "review" && portrait && (
                  <PortraitReview
                    portrait={portrait}
                    note={note}
                    update={setNote}
                  />
                )}
                {step === "cart" && cart && (
                  <CartStep
                    cart={cart}
                    edit={edit}
                    requestRemove={setRemoveTarget}
                    region={region}
                    setRegion={setRegion}
                    accepted={accepted}
                    setAccepted={setAccepted}
                    pay={() => {
                      void pay();
                    }}
                  />
                )}
                <footer className="portrait-actions" hidden={step === "photos"}>
                  {step !== "template" && step !== "cart" && (
                    <button
                      type="button"
                      className="portrait-text-button"
                      onClick={() => {
                        setError(null);
                        setStep(progress[progress.indexOf(step) - 1]);
                      }}
                    >
                      Back
                    </button>
                  )}
                  {step === "template" && !!cart?.portraits.length && (
                    <button
                      type="button"
                      className="portrait-text-button"
                      onClick={() => setStep("cart")}
                    >
                      Back to collection
                    </button>
                  )}
                  {step === "review" ? (
                    <>
                      {(cart?.portraits.length ?? 0) < 5 && (
                        <button
                          type="button"
                          className="portrait-secondary"
                          onClick={() => leaveReview(true)}
                        >
                          Order another portrait
                        </button>
                      )}
                      <button
                        type="button"
                        className="portrait-primary"
                        onClick={() => leaveReview(false)}
                      >
                        Save & next →
                      </button>
                    </>
                  ) : step === "cart" ? (
                    <>
                      {(cart?.portraits.length ?? 0) < 5 && (
                        <button
                          type="button"
                          className="portrait-secondary"
                          onClick={add}
                        >
                          + Order another portrait
                        </button>
                      )}
                      <button
                        type="button"
                        className="portrait-text-button"
                        onClick={() => setStartOver(true)}
                      >
                        Start over
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="portrait-primary"
                      disabled={!canContinue}
                      onClick={() => {
                        setError(null);
                        if (step === "subjects") void saveDetails();
                        else
                          setStep(step === "template" ? "subjects" : "review");
                      }}
                    >
                      {busy
                        ? "Saving…"
                        : step === "subjects"
                          ? "Save & add photos →"
                          : step === "photos"
                            ? "Review portrait →"
                            : "Next →"}
                    </button>
                  )}
                </footer>
                {step === "cart" && cart && !cartReady(cart) && (
                  <small className="portrait-muted">
                    You can close this window and finish your saved draft later.
                  </small>
                )}
              </fieldset>
            )}
            {!loading && (startOver || removeTarget) && (
              <div
                className="portrait-confirm"
                ref={confirmation}
                tabIndex={-1}
                role="group"
                aria-label="Confirm draft removal"
              >
                <h3>
                  {removeTarget
                    ? `Remove portrait ${removeTarget.position}?`
                    : "Start a new draft?"}
                </h3>
                <p>
                  {removeTarget
                    ? "Its private reference photos will be deleted. This cannot be undone."
                    : "Your saved draft will be abandoned. It cannot be resumed after you confirm."}
                </p>
                <button
                  type="button"
                  className="portrait-secondary"
                  disabled={busy}
                  onClick={() => {
                    setStartOver(false);
                    setRemoveTarget(null);
                    heading.current?.focus();
                  }}
                >
                  Keep my draft
                </button>
                <button
                  type="button"
                  className="portrait-primary"
                  disabled={busy || reloadRequired}
                  onClick={() => {
                    if (removeTarget) remove();
                    else void abandon();
                  }}
                >
                  Confirm {removeTarget ? "removal" : "start over"}
                </button>
              </div>
            )}
            {busy && (
              <p className="portrait-saving" role="status">
                Saving or opening secure checkout…
              </p>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
