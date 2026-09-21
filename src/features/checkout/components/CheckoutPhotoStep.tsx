import type { ChangeEvent, DragEvent, RefObject } from "react";
import {
  formatAllowedPhotoTypes,
  formatBytesAsMebibytes,
  type CheckoutLimits,
} from "../clientCheckoutDraft";

export type LocalPhotoPreview = { file: File; id: number; previewUrl: string };

type Props = {
  error: string | null;
  inputRef: RefObject<HTMLInputElement | null>;
  limits: CheckoutLimits;
  note: string;
  onChoose: (event: ChangeEvent<HTMLInputElement>) => void;
  onDrop: (files: File[]) => void;
  onOpenPicker: (replaceIndex: number | null) => void;
  onRemove: (index: number) => void;
  photos: LocalPhotoPreview[];
  setNote: (value: string) => void;
};

export function CheckoutPhotoStep(props: Props) {
  const { error, inputRef, limits, note, onChoose, onDrop, onOpenPicker, onRemove, photos, setNote } = props;
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    onDrop(Array.from(event.dataTransfer.files));
  };
  return (
    <section className="checkout-step" aria-labelledby="checkout-modal-title">
      <p className="step-kicker">Step 2 of 3 · The inspiration tray</p>
      <h2 id="checkout-modal-title">Add your photos</h2>
      <p className="step-intro">Pick 1–3 references. They stay in this browser preview and are not uploaded.</p>
      <div className="photo-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
        <span className="dropzone-sketch" aria-hidden="true">▱</span>
        <strong>Drop photos onto the paper</strong>
        <span>or</span>
        <button onClick={() => onOpenPicker(null)} type="button">Choose photos</button>
        <small>{formatAllowedPhotoTypes(limits.allowedMimeTypes)} · {formatBytesAsMebibytes(limits.maxFileBytes)} each · {formatBytesAsMebibytes(limits.maxTotalBytes)} total</small>
      </div>
      <input
        accept={limits.allowedMimeTypes.join(",")}
        className="visually-hidden-input"
        multiple
        onChange={onChoose}
        ref={inputRef}
        tabIndex={-1}
        type="file"
      />
      {photos.length > 0 && <ol className="photo-preview-list" aria-label="Selected photo previews">
        {photos.map((photo, index) => <li key={photo.id}>
          {/* The local filename is intentionally not rendered. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt={`Photo ${index + 1} preview`} src={photo.previewUrl} />
          <span>Photo {index + 1} of {photos.length}</span>
          <div><button onClick={() => onOpenPicker(index)} type="button">Replace</button>
            <button onClick={() => onRemove(index)} type="button">Remove</button></div>
        </li>)}
      </ol>}
      <p className="field-error" role={error ? "alert" : undefined}>{error ?? "\u00a0"}</p>
      <label className="private-note">Private note for the artist <span>(optional)</span>
        <textarea maxLength={600} onChange={(event) => setNote(event.target.value)} value={note} />
      </label>
    </section>
  );
}
