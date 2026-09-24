import { SHIPPING_AMOUNT_CENTS, formatUsd } from "../clientCheckoutDraft";
import { formatBytesAsMebibytes } from "../clientCheckoutDraft";
import { photoPreviewUrl, type PhotoEntry } from "./CheckoutPhotoStep";

type Props = {
  amountCents: number;
  artistNote: string;
  onFinish: () => void;
  onRetryPreview: (position: number) => void;
  photos: PhotoEntry[];
};

export function CheckoutReviewStep({ amountCents, artistNote, onFinish, onRetryPreview, photos }: Props) {
  return (
    <section className="checkout-step review-step" aria-labelledby="checkout-modal-title">
      <p className="step-kicker">Step 3 of 3 · One last look</p>
      <h2 id="checkout-modal-title">Ready for the press?</h2>
      <p className="step-intro">Here is the postcard plan you made in this preview.</p>
      <div className="review-photos">
        {photos.map((photo) => photoPreviewUrl(photo) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt={`Photo ${photo.position} preview`} key={photo.position} src={photoPreviewUrl(photo)} />
        ) : <div className="uploaded-photo-placeholder" key={photo.position}>
          Photo {photo.position}<br />{photo.server?.mimeType?.split("/")[1]?.toUpperCase() ?? "Photo"}<br />
          {photo.server?.sizeBytes == null ? "Private" : formatBytesAsMebibytes(photo.server.sizeBytes)}
          {!photo.local && photo.serverPreview?.status === "failed" && <button
            aria-label={`Retry Photo ${photo.position} preview`}
            className="preview-retry"
            onClick={() => onRetryPreview(photo.position)}
            type="button"
          >Retry preview</button>}
        </div>)}
        <span>{photos.length} {photos.length === 1 ? "photo" : "photos"}</span>
      </div>
      <dl className="review-totals">
        <div><dt>Your amount</dt><dd>{formatUsd(amountCents)}</dd></div>
        <div><dt>Shipping</dt><dd>{formatUsd(SHIPPING_AMOUNT_CENTS)}</dd></div>
        <div className="review-total"><dt>Total</dt><dd>{formatUsd(amountCents + SHIPPING_AMOUNT_CENTS)}</dd></div>
      </dl>
      {artistNote && <div className="review-artist-note">
        <strong>Private note for the artist</strong>
        <p>{artistNote}</p>
      </div>}
      <button className="secure-checkout-button" onClick={onFinish} type="button">
        Continue to Secure Checkout
      </button>
    </section>
  );
}
