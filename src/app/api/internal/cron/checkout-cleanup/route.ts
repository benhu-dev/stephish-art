import configPromise from "@payload-config";
import { createLocalReq, getPayload } from "payload";

import { handleCheckoutCleanupCronRequest } from "../../../../../server/checkout-cleanup/checkoutCleanupEndpoint";
import { runCheckoutCleanup } from "../../../../../server/checkout-cleanup/checkoutCleanupService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = (request: Request) =>
  handleCheckoutCleanupCronRequest(request, {
    cronSecret: process.env.CRON_SECRET,
    runCleanup: async ({ execute }) => {
      const payload = await getPayload({ config: configPromise });
      const summary = await runCheckoutCleanup({
        execute,
        request: await createLocalReq({}, payload),
      });
      console.info("Checkout cleanup completed.", summary);
      return summary;
    },
  });
