import { SHIPPING_AMOUNT_CENTS, formatUsd } from "../clientCheckoutDraft";
import type { LocalPhotoPreview } from "./CheckoutPhotoStep";

type Props = { amountCents: number; onFinish: () => void; photos: LocalPhotoPreview[] };

export function CheckoutReviewStep({ amountCents, onFinish, photos }: Props) {
  return (
    <section className="checkout-step review-step" aria-labelledby="checkout-modal-title">
      <p className="step-kicker">Step 3 of 3 · One last look</p>
      <h2 id="checkout-modal-title">Ready for the press?</h2>
      <p className="step-intro">Here is the postcard plan you made in this preview.</p>
      <div className="review-photos">
        {photos.map((photo, index) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt={`Photo ${index + 1} preview`} key={photo.id} src={photo.previewUrl} />
        ))}
        <span>{photos.length} {photos.length === 1 ? "photo" : "photos"}</span>
      </div>
      <dl className="review-totals">
        <div><dt>Your amount</dt><dd>{formatUsd(amountCents)}</dd></div>
        <div><dt>Shipping</dt><dd>{formatUsd(SHIPPING_AMOUNT_CENTS)}</dd></div>
        <div className="review-total"><dt>Total</dt><dd>{formatUsd(amountCents + SHIPPING_AMOUNT_CENTS)}</dd></div>
      </dl>
      <button className="secure-checkout-button" onClick={onFinish} type="button">
        Continue to Secure Checkout
      </button>
    </section>
  );
}
