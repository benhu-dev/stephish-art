"use client";

import { useState } from "react";
import {
  cartReady,
  money,
  type CartPortrait,
  type CatalogTemplate,
  type PortraitCart,
  type PortraitPhoto,
  type SubjectInput,
} from "../portraitCartClient";
import { PortraitPhotoPreview } from "./PortraitPhotoPreview";

// Stream catalog previews directly; source images remain behind controlled endpoints.
/* eslint-disable @next/next/no-img-element */

export function TemplateStep({
  templates,
  selected,
  choose,
}: {
  templates: CatalogTemplate[];
  selected: number | null;
  choose: (id: number) => void;
}) {
  return (
    <div
      className="portrait-template-grid"
      role="group"
      aria-label="Postcard designs"
    >
      {templates.map((t) => (
        <button
          type="button"
          className="portrait-template"
          aria-pressed={selected === t.id}
          key={t.id}
          onClick={() => choose(t.id)}
        >
          <div className="portrait-template-art">
            <img
              alt={t.preview.alt}
              src={t.preview.url}
              loading="lazy"
              width={t.preview.width}
              height={t.preview.height}
            />
          </div>
          <span className="portrait-template-caption">
            <strong>{t.name}</strong>
            <span aria-hidden="true">{selected === t.id ? "✓" : "↗"}</span>
          </span>
          {t.description && <small>{t.description}</small>}
        </button>
      ))}
      {templates.length === 0 && (
        <p className="portrait-empty">
          No postcard designs are available just yet. Please check back soon.
        </p>
      )}
    </div>
  );
}

export function SubjectsStep({
  subjects,
  update,
  portrait,
}: {
  subjects: SubjectInput[];
  update: (subjects: SubjectInput[]) => void;
  portrait?: CartPortrait;
}) {
  const canRemove = (subject: SubjectInput) =>
    subjects.length > 1 &&
    !portrait?.photos.some((photo) =>
      photo.subjectIds.includes(subject.id ?? ""),
    ) &&
    (portrait?.photos.length ?? 0) < subjects.length;
  return (
    <>
      <p className="portrait-price-rule">
        $20 includes one person or pet. Each extra friend is $5. Up to three,
        pets included.
      </p>
      <div className="portrait-subjects">
        {subjects.map((s, index) => (
          <fieldset key={s.id ?? `new-${index}`} className="portrait-subject">
            <legend>Friend {index + 1}</legend>
            <label>
              Name{" "}
              <input
                autoComplete="off"
                maxLength={80}
                value={s.name}
                onChange={(e) =>
                  update(
                    subjects.map((old, i) =>
                      i === index ? { ...old, name: e.target.value } : old,
                    ),
                  )
                }
                placeholder="What should Steph call them?"
              />
            </label>
            <label>
              Person or pet{" "}
              <select
                value={s.kind}
                onChange={(e) =>
                  update(
                    subjects.map((old, i) =>
                      i === index
                        ? { ...old, kind: e.target.value as "person" | "pet" }
                        : old,
                    ),
                  )
                }
              >
                <option value="person">Person</option>
                <option value="pet">Pet</option>
              </select>
            </label>
            {subjects.length > 1 && (
              <button
                type="button"
                className="portrait-text-button"
                disabled={!canRemove(s)}
                onClick={() => update(subjects.filter((_, i) => i !== index))}
              >
                Remove friend {index + 1}
              </button>
            )}
            {!canRemove(s) && subjects.length > 1 && (
              <small>Adjust or remove their photos first.</small>
            )}
          </fieldset>
        ))}
      </div>
      {subjects.length < 3 && (
        <button
          type="button"
          className="portrait-secondary"
          onClick={() => update([...subjects, { kind: "person", name: "" }])}
        >
          + Add a person or pet
        </button>
      )}
    </>
  );
}

function Mapping({
  subjects,
  ids,
  update,
  legend,
}: {
  subjects: CartPortrait["subjects"];
  ids: string[];
  update: (ids: string[]) => void;
  legend: string;
}) {
  return (
    <fieldset className="portrait-mapping">
      <legend>{legend}</legend>
      {subjects.map((s) => (
        <label key={s.id}>
          <input
            type="checkbox"
            checked={ids.includes(s.id)}
            onChange={(e) =>
              update(
                e.target.checked
                  ? [...ids, s.id]
                  : ids.filter((id) => id !== s.id),
              )
            }
          />
          {s.name} <small>({s.kind})</small>
        </label>
      ))}
    </fieldset>
  );
}

function PhotoCard({
  photo,
  portrait,
  busy,
  change,
  remove,
  onDirty,
}: {
  photo: PortraitPhoto;
  portrait: CartPortrait;
  busy: boolean;
  change: (photo: PortraitPhoto, ids: string[]) => Promise<boolean>;
  remove: (photo: PortraitPhoto) => void;
  onDirty: (id: number, dirty: boolean) => void;
}) {
  const [ids, setIds] = useState(photo.subjectIds);
  const [confirm, setConfirm] = useState(false);
  const names = portrait.subjects
    .filter((s) => photo.subjectIds.includes(s.id))
    .map((s) => s.name)
    .join(", ");
  const changed =
    ids.length !== photo.subjectIds.length ||
    ids.some((id) => !photo.subjectIds.includes(id));
  return (
    <article className="portrait-photo-card">
      <PortraitPhotoPreview photo={photo} names={names} />
      <div className="portrait-photo-details">
        <span className="portrait-overline">Reference {photo.position}</span>
        <Mapping
          subjects={portrait.subjects}
          ids={ids}
          update={(next) => {
            setIds(next);
            onDirty(
              photo.id,
              next.length !== photo.subjectIds.length ||
                next.some((id) => !photo.subjectIds.includes(id)),
            );
          }}
          legend="Who is in this photo?"
        />
        {changed && (
          <button
            type="button"
            className="portrait-secondary"
            disabled={busy || !ids.length}
            onClick={() => {
              void change(photo, ids).then((saved) => {
                if (saved) onDirty(photo.id, false);
              });
            }}
          >
            Save assignment
          </button>
        )}
        {confirm ? (
          <div className="portrait-inline-confirm">
            <p>Delete this reference photo?</p>
            <button type="button" disabled={busy} onClick={() => remove(photo)}>
              Delete photo
            </button>
            <button type="button" onClick={() => setConfirm(false)}>
              Keep photo
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={busy}
            className="portrait-text-button"
            onClick={() => setConfirm(true)}
          >
            Remove photo
          </button>
        )}
      </div>
    </article>
  );
}

export function PhotosStep({
  portrait,
  cart,
  busy,
  upload,
  change,
  remove,
  onContinue,
  onBack,
}: {
  portrait: CartPortrait;
  cart: PortraitCart;
  busy: boolean;
  upload: (file: File, ids: string[]) => Promise<boolean>;
  change: (photo: PortraitPhoto, ids: string[]) => Promise<boolean>;
  remove: (photo: PortraitPhoto) => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  const [ids, setIds] = useState<string[]>(portrait.subjects.map((s) => s.id));
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [dirtyIds, setDirtyIds] = useState<number[]>([]);
  const unsaved =
    dirtyIds.some((id) => portrait.photos.some((photo) => photo.id === id)) ||
    file !== null;
  const uncovered = portrait.subjects.filter(
    (s) => !portrait.photoState.coveredSubjectIds.includes(s.id),
  );
  return (
    <>
      <p className="portrait-copy">
        Separate photos work best. A group photo is welcome too—select everyone
        shown and describe who is who in your note.
      </p>
      <div className="portrait-photo-list">
        {portrait.photos.map((p) => (
          <PhotoCard
            key={`${p.id}-${p.subjectIds.join("-")}`}
            photo={p}
            portrait={portrait}
            busy={busy}
            change={change}
            remove={remove}
            onDirty={(id, dirty) =>
              setDirtyIds((old) =>
                dirty
                  ? [...old.filter((p) => p !== id), id]
                  : old.filter((p) => p !== id),
              )
            }
          />
        ))}
      </div>
      {portrait.photos.length < portrait.subjects.length && (
        <div className="portrait-upload-box">
          <Mapping
            subjects={portrait.subjects}
            ids={ids}
            update={setIds}
            legend="This new photo shows…"
          />
          <label className="portrait-file-label">
            Choose a reference photo
            <input
              key={inputKey}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <small>
            JPEG, PNG or WebP · 15 MiB / 50 MP each · Up to{" "}
            {portrait.subjects.length} photo
            {portrait.subjects.length === 1 ? "" : "s"} · 30 MiB per portrait
          </small>
          <button
            type="button"
            className="portrait-primary"
            disabled={busy || !file || !ids.length}
            onClick={() => {
              if (file)
                void upload(file, ids).then((saved) => {
                  if (saved) {
                    setFile(null);
                    setInputKey((n) => n + 1);
                  }
                });
            }}
          >
            {busy ? "Saving…" : "Upload private photo"}
          </button>
        </div>
      )}
      <p className="portrait-privacy">
        Your reference photos stay private and are used to draw your portrait.
      </p>
      <p className="portrait-coverage" role="status">
        {uncovered.length
          ? `Still need a photo of: ${uncovered.map((s) => s.name).join(", ")}.`
          : "Everyone has a reference. You're ready to review."}
      </p>
      <small className="portrait-muted">
        Cart photo allowance: {cart.uploadLimits.maximumFilesPerCart} files /
        100 MiB.
      </small>
      {unsaved && (
        <p className="portrait-coverage">
          Save your photo assignments or upload the selected file before
          continuing.
        </p>
      )}
      <footer className="portrait-actions">
        <button type="button" className="portrait-text-button" onClick={onBack}>
          Back
        </button>
        <button
          type="button"
          className="portrait-primary"
          disabled={
            busy ||
            unsaved ||
            !portrait.photoState.complete ||
            !portrait.template.available
          }
          onClick={onContinue}
        >
          Review portrait →
        </button>
      </footer>
    </>
  );
}

export function PortraitReview({
  portrait,
  note,
  update,
}: {
  portrait: CartPortrait;
  note: string;
  update: (note: string) => void;
}) {
  return (
    <>
      <div className="portrait-review-heading">
        <span>{portrait.template.name}</span>
        <strong>{money(portrait.amountCents)}</strong>
      </div>
      <p className="portrait-copy">
        For{" "}
        {portrait.subjects
          .map((s) => `${s.name}${s.kind === "pet" ? " (pet)" : ""}`)
          .join(", ")}
        .
      </p>
      <div className="portrait-review-photos">
        {portrait.photos.map((photo) => (
          <PortraitPhotoPreview
            key={photo.id}
            photo={photo}
            names={portrait.subjects
              .filter((s) => photo.subjectIds.includes(s.id))
              .map((s) => s.name)
              .join(", ")}
          />
        ))}
      </div>
      <label className="portrait-note">
        A little note for Steph <span>(optional, just for this portrait)</span>
        <textarea
          maxLength={1000}
          value={note}
          onChange={(e) => update(e.target.value)}
          rows={4}
          placeholder="Who's on the left? Any little details you'd love Steph to include?"
        />
      </label>
      <small className="portrait-muted">
        {note.length}/1,000 · Saved when you continue.
      </small>
    </>
  );
}

export function CartStep({
  cart,
  edit,
  requestRemove,
  region,
  setRegion,
  accepted,
  setAccepted,
}: {
  cart: PortraitCart;
  edit: (p: CartPortrait) => void;
  requestRemove: (p: CartPortrait) => void;
  region: "us" | "international";
  setRegion: (r: "us" | "international") => void;
  accepted: boolean;
  setAccepted: (v: boolean) => void;
}) {
  return (
    <>
      <div className="portrait-cart-list">
        {cart.portraits.map((p) => (
          <article key={p.id} className="portrait-cart-item">
            {p.template.preview && (
              <img
                alt={p.template.preview.alt}
                src={p.template.preview.url}
                width={p.template.preview.width}
                height={p.template.preview.height}
              />
            )}
            <div>
              <span className="portrait-overline">Portrait {p.position}</span>
              <h3>{p.template.name}</h3>
              <p>{p.subjects.map((s) => s.name).join(", ")}</p>
              <small>
                {!p.template.available
                  ? "Design unavailable—choose another"
                  : p.photoState.complete
                    ? "References complete"
                    : "References needed"}
              </small>
              {p.artistNote && (
                <p className="portrait-cart-note">{p.artistNote}</p>
              )}
              <div className="portrait-cart-controls">
                <button type="button" onClick={() => edit(p)}>
                  Edit portrait {p.position}
                </button>
                {cart.portraits.length > 1 && (
                  <button type="button" onClick={() => requestRemove(p)}>
                    Remove portrait {p.position}
                  </button>
                )}
              </div>
            </div>
            <strong>{money(p.amountCents)}</strong>
          </article>
        ))}
      </div>
      <fieldset className="portrait-shipping">
        <legend>Where is this little postcard headed?</legend>
        <label>
          <input
            type="radio"
            name="shipping-region"
            checked={region === "us"}
            onChange={() => setRegion("us")}
          />{" "}
          United States <span>$10 · USPS + tracking</span>
        </label>
        <label>
          <input
            type="radio"
            name="shipping-region"
            checked={region === "international"}
            onChange={() => setRegion("international")}
          />{" "}
          International <span>$5 · No tracking</span>
        </label>
      </fieldset>
      <dl className="portrait-totals">
        <div>
          <dt>Portrait subtotal</dt>
          <dd>{money(cart.subtotalCents)}</dd>
        </div>
        <div>
          <dt>Estimated shipping · once per order</dt>
          <dd>{money(region === "us" ? 1000 : 500)}</dd>
        </div>
      </dl>
      <p className="portrait-muted">
        Shipping is a preview estimate. Your destination and final total will be
        confirmed at checkout.
      </p>
      <details className="portrait-policy">
        <summary>Made just for you · final-sale policy</summary>
        <p>
          Custom portraits are final sale. We do not accept change-of-mind
          returns, exchanges or voluntary cancellations after payment.
        </p>
        <p>
          If your order is not fulfilled, arrives damaged or incorrect, is
          materially different from its description, or has a payment error,
          contact the artist for help. Applicable legal rights and remedies
          remain available.
        </p>
        <p>
          International mail does not include tracking. Please contact the
          artist if your postcard does not arrive.
        </p>
      </details>
      <label className="portrait-policy-check">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
        />{" "}
        I have read the custom portrait policy.
      </label>
      {!cartReady(cart) && (
        <p className="portrait-coverage">
          Finish every portrait&apos;s design and photo references before
          checkout.
        </p>
      )}
      <button
        className="portrait-primary portrait-payment"
        type="button"
        disabled
      >
        Payment opens after checkout integration
      </button>
      <p className="portrait-muted">
        Development preview · No payment will be taken.
      </p>
    </>
  );
}
