import type { ChangeEvent, DragEvent, RefObject } from "react";
import {
  formatAllowedPhotoTypes,
  formatBytesAsMebibytes,
  type CheckoutLimits,
} from "../clientCheckoutDraft";
import type { SafeUpload } from "../checkoutIntentClient";
import { MAX_ARTIST_NOTE_CHARACTERS } from "../../../lib/artistNoteContract";

export type LocalPhotoPreview = { file: File; id: number; previewUrl: string };
export type ServerPhotoPreview =
  | { status: "failed" | "loading" }
  | { previewUrl: string; status: "ready" };
export type PhotoEntry = {
  position: 1 | 2 | 3;
  local?: LocalPhotoPreview;
  server?: SafeUpload;
  serverPreview?: ServerPhotoPreview;
  status: "local" | "uploading" | "confirmed" | "deleting" | "failed" | "uncertain";
};

export const photoPreviewUrl = (photo: PhotoEntry) =>
  photo.local?.previewUrl ??
  (photo.serverPreview?.status === "ready"
    ? photo.serverPreview.previewUrl
    : undefined);

type Props = {
  error: string | null;
  inputRef: RefObject<HTMLInputElement | null>;
  limits: CheckoutLimits;
  note: string;
  pending: boolean;
  onChoose: (event: ChangeEvent<HTMLInputElement>) => void;
  onDrop: (files: File[]) => void;
  onOpenPicker: (replaceIndex: number | null) => void;
  onRemove: (position: number) => void;
  onRetryPreview: (position: number) => void;
  photos: PhotoEntry[];
  setNote: (value: string) => void;
};

export function CheckoutPhotoStep(props: Props) {
  const { error, inputRef, limits, note, onChoose, onDrop, onOpenPicker, onRemove, onRetryPreview, pending, photos, setNote } = props;
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    onDrop(Array.from(event.dataTransfer.files));
  };
  return (
    <section className="checkout-step" aria-labelledby="checkout-modal-title">
      <p className="step-kicker">Step 2 of 3 · The inspiration tray</p>
      <h2 id="checkout-modal-title">Add your photos</h2>
      <p className="step-intro">Pick 1–3 references. They are privately uploaded when you continue.</p>
      <div className="photo-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
        <span className="dropzone-sketch" aria-hidden="true">▱</span>
        <strong>Drop photos onto the paper</strong>
        <span>or</span>
        <button disabled={pending} onClick={() => onOpenPicker(null)} type="button">Choose photos</button>
        <small>{formatAllowedPhotoTypes(limits.allowedMimeTypes)} · {formatBytesAsMebibytes(limits.maxFileBytes)} each · {formatBytesAsMebibytes(limits.maxTotalBytes)} total</small>
      </div>
      <input
        accept={limits.allowedMimeTypes.join(",")}
        className="visually-hidden-input"
        disabled={pending}
        multiple
        onChange={onChoose}
        ref={inputRef}
        tabIndex={-1}
        type="file"
      />
      {photos.length > 0 && <ol className="photo-preview-list" aria-label="Selected photo previews">
        {photos.map((photo) => <li key={photo.position}>
          {photoPreviewUrl(photo) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt={`Photo ${photo.position} preview`} src={photoPreviewUrl(photo)} />
          ) : <div className="uploaded-photo-placeholder" aria-label={`Photo ${photo.position} uploaded`}>
            Uploaded {photo.server?.mimeType?.split("/")[1]?.toUpperCase() ?? "photo"}<br />
            {photo.server?.sizeBytes == null ? "Private photo" : formatBytesAsMebibytes(photo.server.sizeBytes)}
          </div>}
          {!photo.local && photo.serverPreview?.status === "failed" &&
            <button
              aria-label={`Retry Photo ${photo.position} preview`}
              className="preview-retry"
              onClick={() => onRetryPreview(photo.position)}
              type="button"
            >Retry preview</button>}
          <span>Photo {photo.position} · {photo.status === "confirmed" ? "Uploaded privately" : photo.status === "uploading" ? "Uploading…" : photo.status === "deleting" ? "Removing…" : photo.status === "uncertain" ? "Checking upload…" : photo.status === "failed" ? "Retry needed" : "Ready to upload"}</span>
          <div><button disabled={pending} onClick={() => onOpenPicker(photo.position)} type="button">Replace</button>
            <button disabled={pending} onClick={() => onRemove(photo.position)} type="button">Remove</button></div>
        </li>)}
      </ol>}
      <p aria-live="polite" className="photo-progress">{pending ? "Saving your private photos…" : photos.filter((photo) => photo.status === "confirmed").length > 0 ? `${photos.filter((photo) => photo.status === "confirmed").length} of ${photos.length} uploaded privately` : "\u00a0"}</p>
      <p className="field-error" role={error ? "alert" : undefined}>{error ?? "\u00a0"}</p>
      <label className="private-note">Private note for the artist <span>(optional)</span>
        <textarea disabled={pending} maxLength={MAX_ARTIST_NOTE_CHARACTERS} onChange={(event) => setNote(event.target.value)} value={note} />
      </label>
    </section>
  );
}
