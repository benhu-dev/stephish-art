type Props = {
  confirmStartOver: boolean;
  error: string | null;
  onCancelStartOver: () => void;
  onConfirmStartOver: () => void;
  onResume: () => void;
  onStartOver: () => void;
  pending: "abandon" | "resume" | null;
};

export function CheckoutRecoveryStep({
  confirmStartOver,
  error,
  onCancelStartOver,
  onConfirmStartOver,
  onResume,
  onStartOver,
  pending,
}: Props) {
  return (
    <section className="checkout-step recovery-step" aria-labelledby="checkout-modal-title">
      <p className="step-kicker">Your postcard is waiting</p>
      <h2 id="checkout-modal-title">Your checkout is ready</h2>
      <p className="step-intro">
        Continue to secure checkout, or close this payment session and begin again.
      </p>
      {confirmStartOver ? <div className="recovery-confirmation">
        <p>Starting over will close this payment session. Your current uploads and note will no longer be available.</p>
        <div className="recovery-actions">
          <button disabled={pending !== null} onClick={onConfirmStartOver} type="button">
            {pending === "abandon" ? "Starting over…" : "Confirm Start Over"}
          </button>
          <button disabled={pending !== null} onClick={onCancelStartOver} type="button">Keep Checkout</button>
        </div>
      </div> : <div className="recovery-actions">
        <button disabled={pending !== null} onClick={onResume} type="button">
          {pending === "resume" ? "Opening secure checkout…" : "Resume Secure Checkout"}
        </button>
        <button disabled={pending !== null} onClick={onStartOver} type="button">Start a New Order</button>
      </div>}
      <p className="field-error" role="alert">{error}</p>
    </section>
  );
}
