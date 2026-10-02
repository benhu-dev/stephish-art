export const FULFILLMENT_STATES = [
  "unfulfilled",
  "in_progress",
  "ready_to_ship",
  "shipped",
  "delivered",
] as const;

export type FulfillmentState = (typeof FULFILLMENT_STATES)[number];

export const TRACKING_CARRIERS = ["usps", "ups", "fedex", "other"] as const;

export type TrackingCarrier = (typeof TRACKING_CARRIERS)[number];

export type FulfillmentTracking = {
  carrier: TrackingCarrier;
  trackingNumber: string;
};

export type FulfillmentTransitionInput = {
  expectedCurrentState: FulfillmentState;
  requestedNextState: FulfillmentState;
  tracking?: FulfillmentTracking;
};

export class OrderFulfillmentError extends Error {
  code: string;
  status: number;

  constructor(status: number, code: string) {
    super(code);
    this.name = "OrderFulfillmentError";
    this.status = status;
    this.code = code;
  }
}

const hasExactKeys = (value: object, keys: string[]) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
};

const isFulfillmentState = (value: unknown): value is FulfillmentState =>
  typeof value === "string" &&
  (FULFILLMENT_STATES as readonly string[]).includes(value);

const isTrackingCarrier = (value: unknown): value is TrackingCarrier =>
  typeof value === "string" &&
  (TRACKING_CARRIERS as readonly string[]).includes(value);

export const normalizeTrackingNumber = (value: unknown) => {
  if (typeof value !== "string" || value.length > 128) {
    throw new OrderFulfillmentError(400, "INVALID_TRACKING");
  }

  const normalized = value.replace(/[\s-]+/g, "").toUpperCase();
  if (!/^[A-Z0-9]{6,64}$/.test(normalized)) {
    throw new OrderFulfillmentError(400, "INVALID_TRACKING");
  }
  return normalized;
};

export const parseFulfillmentTransitionInput = (
  value: unknown,
): FulfillmentTransitionInput => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new OrderFulfillmentError(400, "INVALID_REQUEST");
  }

  const body = value as Record<string, unknown>;
  const keys = body.tracking === undefined
    ? ["expectedCurrentState", "requestedNextState"]
    : ["expectedCurrentState", "requestedNextState", "tracking"];
  if (!hasExactKeys(body, keys)) {
    throw new OrderFulfillmentError(400, "INVALID_REQUEST");
  }
  if (
    !isFulfillmentState(body.expectedCurrentState) ||
    !isFulfillmentState(body.requestedNextState)
  ) {
    throw new OrderFulfillmentError(400, "INVALID_STATE");
  }

  let tracking: FulfillmentTracking | undefined;
  if (body.tracking !== undefined) {
    if (
      typeof body.tracking !== "object" ||
      body.tracking === null ||
      Array.isArray(body.tracking) ||
      !hasExactKeys(body.tracking, ["carrier", "trackingNumber"])
    ) {
      throw new OrderFulfillmentError(400, "INVALID_TRACKING");
    }
    const candidate = body.tracking as Record<string, unknown>;
    if (!isTrackingCarrier(candidate.carrier)) {
      throw new OrderFulfillmentError(400, "INVALID_TRACKING");
    }
    tracking = {
      carrier: candidate.carrier,
      trackingNumber: normalizeTrackingNumber(candidate.trackingNumber),
    };
  }

  return {
    expectedCurrentState: body.expectedCurrentState,
    requestedNextState: body.requestedNextState,
    ...(tracking ? { tracking } : {}),
  };
};

export const parseOrderId = (value: unknown) => {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new OrderFulfillmentError(400, "INVALID_ORDER_ID");
  }
  const orderId = Number(value);
  if (!Number.isSafeInteger(orderId)) {
    throw new OrderFulfillmentError(400, "INVALID_ORDER_ID");
  }
  return orderId;
};
