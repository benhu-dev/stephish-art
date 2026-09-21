import { formatUsd } from "../clientCheckoutDraft";

type Props = {
  amountCents: number | null;
  customAmount: string;
  error: string | null;
  minimumAmountCents: number;
  onCustomAmount: (value: string) => void;
  onPreset: (cents: number) => void;
  pending: boolean;
};

const PRESETS = [500, 1000, 2000] as const;

export function CheckoutAmountStep(props: Props) {
  const { amountCents, customAmount, error, minimumAmountCents, onCustomAmount, onPreset, pending } = props;
  return (
    <section aria-busy={pending} className="checkout-step" aria-labelledby="checkout-modal-title">
      <p className="step-kicker">Step 1 of 3 · The little gold coin</p>
      <h2 id="checkout-modal-title">Choose your amount</h2>
      <p className="step-intro">Set the price that feels right for your handmade postcard.</p>
      <fieldset className="amount-fieldset">
        <legend>Quick picks</legend>
        <div className="amount-presets">
          {PRESETS.map((cents) => (
            <button
              aria-pressed={amountCents === cents && customAmount === ""}
              className="amount-preset"
              disabled={pending || cents < minimumAmountCents}
              key={cents}
              onClick={() => onPreset(cents)}
              type="button"
            >
              {formatUsd(cents).replace(".00", "")}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="amount-custom">
        <span>Or write your own amount in USD</span>
        <span className="amount-input-wrap"><span aria-hidden="true">$</span>
          <input
            aria-describedby="amount-help amount-error"
            disabled={pending}
            inputMode="decimal"
            onChange={(event) => onCustomAmount(event.target.value)}
            placeholder="5.00"
            value={customAmount}
          />
        </span>
      </label>
      <p id="amount-help" className="field-help">Minimum {formatUsd(minimumAmountCents)} · dollars and cents only</p>
      <p id="amount-error" className="field-error" role={error ? "alert" : undefined}>{error ?? "\u00a0"}</p>
    </section>
  );
}
