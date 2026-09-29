import nextEnvironment from "@next/env";
import { fileURLToPath } from "node:url";
import { createLocalReq, getPayload, type Payload } from "payload";

import { parseEmailOutboxArguments } from "../src/server/email/emailOutboxCli";
import { deliverEmailOutbox } from "../src/server/email/emailOutboxService";

const { loadEnvConfig } = nextEnvironment;
loadEnvConfig(fileURLToPath(new URL("../", import.meta.url)), true, {
  error() {},
  info() {},
});

type PoolClient = {
  release: () => void;
  removeAllListeners: (event: "error") => void;
};
type Pool = {
  _clients?: PoolClient[];
  _idle?: Array<{ client: PoolClient }>;
  end: () => Promise<void>;
  ended?: boolean;
  ending?: boolean;
};

const closePayload = async (payload: Payload) => {
  const pool = payload.db.pool as Pool | undefined;
  let firstError: unknown;
  try {
    await payload.destroy();
  } catch (error) {
    firstError = error;
  }
  try {
    if (pool && !pool.ending && !pool.ended) {
      const idleClients = new Set((pool._idle ?? []).map(({ client }) => client));
      for (const client of pool._clients ?? []) {
        if (!idleClients.has(client)) {
          client.removeAllListeners("error");
          client.release();
        }
      }
      await pool.end();
    }
  } catch (error) {
    firstError ??= error;
  }
  if (firstError) throw firstError;
};

let payload: Payload | undefined;
let failed = false;
try {
  parseEmailOutboxArguments(process.argv.slice(2));
  const { default: configPromise } = await import("../src/payload.config");
  const baseConfig = await configPromise;
  payload = await getPayload({
    config: {
      ...baseConfig,
      telemetry: false,
      typescript: { ...baseConfig.typescript, autoGenerate: false },
    },
  });
  const summary = await deliverEmailOutbox({
    request: await createLocalReq({}, payload),
  });
  console.log(JSON.stringify(summary));
} catch {
  console.error("Email outbox processing failed.");
  failed = true;
} finally {
  try {
    if (payload) await closePayload(payload);
  } catch {
    if (!failed) console.error("Email outbox processing failed.");
    failed = true;
  }
  process.exitCode = failed ? 1 : 0;
}
