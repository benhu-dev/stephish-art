import type { Endpoint, PayloadRequest } from "payload";

import {
  OrderFulfillmentError,
  parseFulfillmentTransitionInput,
  parseOrderId,
} from "./orderFulfillmentContract";
import { transitionOrderFulfillment } from "./orderFulfillmentService";
import {
  readStorefrontJson,
  requireNoQueryString,
  requireSameOrigin,
} from "../storefront/storefrontRequestSecurity";
import { StorefrontApiError } from "../storefront/storefrontApiError";

const noStoreHeaders = () => new Headers({ "Cache-Control": "no-store" });

const jsonResponse = (body: unknown, status: number) =>
  Response.json(body, { headers: noStoreHeaders(), status });

const requireAdministrator = (request: PayloadRequest) => {
  if (!request.user || request.user.collection !== "users") {
    throw new OrderFulfillmentError(401, "UNAUTHORIZED");
  }
};

const errorResponse = (request: PayloadRequest, error: unknown) => {
  const knownError =
    error instanceof OrderFulfillmentError || error instanceof StorefrontApiError
      ? error
      : new OrderFulfillmentError(500, "INTERNAL_ERROR");
  if (
    !(error instanceof OrderFulfillmentError) &&
    !(error instanceof StorefrontApiError)
  ) {
    request.payload.logger.error({ msg: "Order fulfillment request failed." });
  }
  return jsonResponse({ error: { code: knownError.code } }, knownError.status);
};

export const createOrderFulfillmentHandler = (
  transition: typeof transitionOrderFulfillment = transitionOrderFulfillment,
) => async (request: PayloadRequest) => {
  try {
    requireAdministrator(request);
    requireSameOrigin(request);
    requireNoQueryString(request);
    const orderId = parseOrderId(request.routeParams?.orderId);
    const input = parseFulfillmentTransitionInput(
      await readStorefrontJson(request, 2 * 1024),
    );
    return jsonResponse(
      await transition({ input, orderId, request }),
      200,
    );
  } catch (error) {
    return errorResponse(request, error);
  }
};

export const orderFulfillmentHandler = createOrderFulfillmentHandler();

export const orderFulfillmentEndpoints: Endpoint[] = [
  {
    handler: orderFulfillmentHandler,
    method: "patch",
    path: "/admin/orders/:orderId/fulfillment",
  },
];
