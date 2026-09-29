import configPromise from "@payload-config";
import { createLocalReq, getPayload } from "payload";

import { handleEmailOutboxCronRequest } from "../../../../../server/email/emailOutboxEndpoint";
import { deliverEmailOutbox } from "../../../../../server/email/emailOutboxService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = (request: Request) =>
  handleEmailOutboxCronRequest(request, {
    cronSecret: process.env.CRON_SECRET,
    runProcessor: async () => {
      const payload = await getPayload({ config: configPromise });
      const summary = await deliverEmailOutbox({
        request: await createLocalReq({}, payload),
      });
      console.info("Email outbox processing completed.", summary);
      return summary;
    },
  });
