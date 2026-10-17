import type { MouseEvent } from "react";

import { TRACKING_CARRIERS } from "../../../server/orders/orderFulfillmentContract";
import {
  extensionForMimeType,
  fulfillmentActionFor,
  fulfillmentWarningFor,
  type OrderWorkbenchData,
} from "./orderWorkbenchContract";

const defaultStyles: Record<string, string> = new Proxy(
  {},
  {
    get: (_target, property) => String(property),
  },
);

export type TrackingDraft = {
  carrier: string;
  trackingNumber: string;
};

export const OrderWorkbenchDetails = ({
  data,
  error,
  onSubmit,
  ordersListURL = "/admin/collections/orders",
  pending,
  tracking = { carrier: "", trackingNumber: "" },
  onTrackingChange = () => {},
  styles = defaultStyles,
}: {
  data: OrderWorkbenchData;
  error: string | null;
  onSubmit: (event: MouseEvent<HTMLButtonElement>) => void;
  ordersListURL?: string;
  pending: boolean;
  tracking?: TrackingDraft;
  onTrackingChange?: (tracking: TrackingDraft) => void;
  styles?: Record<string, string>;
}) => {
  const action = fulfillmentActionFor(data.fulfillment.orderStatus);
  const warning = fulfillmentWarningFor(data.fulfillment);
  const shipping = action?.nextState === "shipped";
  const address = data.shippingAddress;

  return (
    <section
      className={styles.workbench}
      aria-labelledby="order-workbench-title"
    >
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Artist order workbench</p>
          <h2 id="order-workbench-title">Order #{data.orderId}</h2>
        </div>
        <div className={styles.headerActions}>
          <a href={ordersListURL}>Back to Orders</a>
          <span
            className={styles.state}
            data-order-state={data.fulfillment.orderStatus}
          >
            {data.fulfillment.orderStatus.replaceAll("_", " ")}
          </span>
        </div>
      </header>

      {warning ? (
        <p className={styles.warning} role="status">
          {warning} The server will continue to enforce this restriction.
        </p>
      ) : null}

      <div className={styles.grid}>
        <section className={styles.panel} aria-labelledby="customer-heading">
          <h3 id="customer-heading">Customer &amp; delivery</h3>
          <dl className={styles.definitionList}>
            <div>
              <dt>Name</dt>
              <dd>{data.customer.name}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{data.customer.email}</dd>
            </div>
          </dl>
          <address className={styles.address}>
            {address.recipientName}
            <br />
            {address.line1}
            <br />
            {address.line2 ? (
              <>
                {address.line2}
                <br />
              </>
            ) : null}
            {address.city}
            {address.state ? `, ${address.state}` : ""}
            {address.postalCode ? ` ${address.postalCode}` : ""}
            <br />
            {address.country}
          </address>
        </section>

        <section className={styles.panel} aria-labelledby="payment-heading">
          <h3 id="payment-heading">Payment snapshot</h3>
          <dl className={styles.definitionList}>
            <div>
              <dt>Subtotal</dt>
              <dd>{data.amounts.subtotal}</dd>
            </div>
            <div>
              <dt>Shipping</dt>
              <dd>{data.amounts.shipping}</dd>
            </div>
            {data.shippingClass && (
              <div>
                <dt>Shipping service</dt>
                <dd>{data.shippingClass}</dd>
              </div>
            )}
            <div>
              <dt>Total</dt>
              <dd>
                <strong>{data.amounts.total}</strong>
              </dd>
            </div>
            <div>
              <dt>Refunded</dt>
              <dd>{data.fulfillment.refundedAmount}</dd>
            </div>
            <div>
              <dt>Refund state</dt>
              <dd>{data.fulfillment.refundState}</dd>
            </div>
            <div>
              <dt>Dispute state</dt>
              <dd>{data.fulfillment.stripeDisputeStatus ?? "None"}</dd>
            </div>
          </dl>
        </section>

        <section className={styles.panel} aria-labelledby="timing-heading">
          <h3 id="timing-heading">Timing</h3>
          <dl className={styles.definitionList}>
            <div>
              <dt>Created</dt>
              <dd>{data.timestamps.created}</dd>
            </div>
            <div>
              <dt>Shipped</dt>
              <dd>{data.timestamps.shipped ?? "Not shipped"}</dd>
            </div>
            <div>
              <dt>Delivered</dt>
              <dd>{data.timestamps.delivered ?? "Not delivered"}</dd>
            </div>
          </dl>
        </section>

        {!data.portraits && (
          <section className={styles.panel} aria-labelledby="note-heading">
            <h3 id="note-heading">Artist note</h3>
            <p className={styles.note}>
              {data.artistNote || "No artist note provided."}
            </p>
          </section>
        )}
      </div>

      {data.portraits?.map((p) => (
        <section
          key={p.id}
          className={styles.panel}
          aria-labelledby={`portrait-${p.id}-heading`}
        >
          <h3 id={`portrait-${p.id}-heading`}>
            Portrait {p.position} · {p.templateName} · {p.amount}
          </h3>
          {/* eslint-disable-next-line @next/next/no-img-element -- artist-authenticated immutable preview bypasses public optimizer */}
          <img
            className={styles.templatePreview}
            src={p.templatePreviewUrl}
            alt={p.templatePreviewAlt}
          />
          {p.templateDescription && <p>{p.templateDescription}</p>}
          <p>
            Subjects:{" "}
            {p.subjects.map((s) => `${s.name} (${s.kind})`).join(", ")}
          </p>
          <p className={styles.note}>
            Note: {p.artistNote || "No note for this portrait."}
          </p>
          <ul className={styles.imageList}>
            {p.uploads.map((u) => {
              const names = p.subjects
                .filter((s) => u.subjectIds?.includes(s.id))
                .map((s) => s.name)
                .join(", ");
              const prefix = `/api/admin/orders/${data.orderId}/uploads/${u.id}`;
              return (
                <li key={u.id} className={styles.imageCard}>
                  <p>
                    Reference {u.position}: {names}
                  </p>
                  <a
                    href={`${prefix}/preview`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Preview portrait ${p.position} reference ${u.position}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- private reference bytes cannot use public optimizer */}
                    <img
                      src={`${prefix}/preview`}
                      alt={`Portrait ${p.position} reference ${u.position}: ${names}`}
                    />
                  </a>
                  <a
                    href={`${prefix}/download`}
                    download={`portrait-${p.position}-reference-${u.position}.${extensionForMimeType(u.mimeType)}`}
                  >
                    Download reference {u.position}
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {!data.portraits && (
        <section className={styles.images} aria-labelledby="images-heading">
          <h3 id="images-heading">Reference images</h3>
          {data.uploads.length ? (
            <ul className={styles.imageList}>
              {data.uploads.map((upload) => {
                const preview = `/api/admin/orders/${data.orderId}/uploads/${upload.id}/preview`;
                const download = `/api/admin/orders/${data.orderId}/uploads/${upload.id}/download`;
                const label = `reference image ${upload.position}`;
                return (
                  <li key={upload.id} className={styles.imageCard}>
                    <a
                      aria-label={`Preview ${label}`}
                      href={preview}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {/* The same authenticated route supplies the inline thumbnail and full preview. */}
                      {/* eslint-disable-next-line @next/next/no-img-element -- private bytes cannot pass through a public image optimizer */}
                      <img
                        alt={`Reference image ${upload.position}`}
                        src={preview}
                      />
                    </a>
                    <a
                      download={`reference-${upload.position}.${extensionForMimeType(upload.mimeType)}`}
                      href={download}
                    >
                      Download reference image {upload.position}
                    </a>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p>No reference images are attached.</p>
          )}
        </section>
      )}

      <section
        className={styles.fulfillment}
        aria-labelledby="fulfillment-heading"
      >
        <h3 id="fulfillment-heading">Fulfillment</h3>
        {data.fulfillment.tracking ? (
          <p>
            Tracking: {data.fulfillment.tracking.carrier.toUpperCase()}{" "}
            {data.fulfillment.tracking.trackingNumber}
          </p>
        ) : null}
        {action && !warning ? (
          <div>
            {shipping ? (
              <fieldset className={styles.tracking} disabled={pending}>
                <legend>Optional carrier and tracking</legend>
                <label>
                  Carrier
                  <select
                    aria-label="Tracking carrier"
                    onChange={(event) =>
                      onTrackingChange({
                        ...tracking,
                        carrier: event.target.value,
                      })
                    }
                    value={tracking.carrier}
                  >
                    <option value="">No tracking</option>
                    {TRACKING_CARRIERS.map((carrier) => (
                      <option key={carrier} value={carrier}>
                        {carrier === "other" ? "Other" : carrier.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Tracking number
                  <input
                    aria-label="Tracking number"
                    autoComplete="off"
                    maxLength={64}
                    onChange={(event) =>
                      onTrackingChange({
                        ...tracking,
                        trackingNumber: event.target.value,
                      })
                    }
                    value={tracking.trackingNumber}
                  />
                </label>
              </fieldset>
            ) : null}
            <button disabled={pending} onClick={onSubmit} type="button">
              {pending ? "Updating…" : action.label}
            </button>
          </div>
        ) : action ? null : (
          <p>
            This order is delivered. No further fulfillment action is available.
          </p>
        )}
        {error ? (
          <p className={styles.error} role="alert" tabIndex={-1}>
            {error}
          </p>
        ) : null}
      </section>
    </section>
  );
};
