import nextEnvironment from "@next/env";
import { fileURLToPath } from "node:url";
import { createLocalReq, getPayload, type Payload } from "payload";

import { parseCheckoutCleanupArguments } from "../src/server/checkout-cleanup/checkoutCleanupCli";
import { runCheckoutCleanup } from "../src/server/checkout-cleanup/checkoutCleanupService";

const { loadEnvConfig } = nextEnvironment;
loadEnvConfig(fileURLToPath(new URL("../", import.meta.url)), true, {
  error() {},
  info() {},
});

type PostgresPoolClient = {
  release: () => void;
  removeAllListeners: (event: "error") => void;
};
type PostgresPool = {
  _clients?: PostgresPoolClient[];
  _idle?: Array<{ client: PostgresPoolClient }>;
  end: () => Promise<void>;
  ended?: boolean;
  ending?: boolean;
};

const closeCliPayload = async (payload: Payload) => {
  const pool = payload.db.pool as PostgresPool | undefined;
  let firstError: unknown;
  try {
    await payload.destroy();
  } catch (error) {
    firstError = error;
  }

  try {
    if (pool && !pool.ending && !pool.ended) {
      // Payload 3.88 keeps its reconnect listener's pg client checked out.
      // Release that CLI-owned client before the supported pool shutdown.
      const idleClients = new Set(
        (pool._idle ?? []).map(({ client }) => client),
      );
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

const closeCliOwnedNetworkHandles = () => {
  const activeHandles = (
    process as typeof process & { _getActiveHandles: () => object[] }
  )._getActiveHandles();
  for (const handle of activeHandles) {
    if (
      handle === process.stdin ||
      handle === process.stdout ||
      handle === process.stderr ||
      !["Socket", "TLSSocket"].includes(handle.constructor?.name ?? "")
    ) {
      continue;
    }
    // All non-stdio sockets in this standalone process were opened by this
    // invocation, and all provider/database work has already been awaited.
    const socket = handle as { destroy?: () => void; unref?: () => void };
    socket.destroy?.();
    socket.unref?.();
  }
};

let payload: Payload | undefined;
let failed = false;
try {
  const { execute } = parseCheckoutCleanupArguments(process.argv.slice(2));
  const { default: configPromise } = await import("../src/payload.config");
  const baseConfig = await configPromise;
  const config = {
    ...baseConfig,
    // These server-start background tasks are not part of a one-shot CLI.
    telemetry: false,
    typescript: { ...baseConfig.typescript, autoGenerate: false },
  };
  payload = await getPayload({ config });
  const summary = await runCheckoutCleanup({
    execute,
    request: await createLocalReq({}, payload),
  });
  console.log(JSON.stringify({ mode: execute ? "execute" : "dry-run", ...summary }));
} catch {
  console.error("Checkout cleanup failed.");
  failed = true;
} finally {
  try {
    if (payload) await closeCliPayload(payload);
  } catch {
    if (!failed) console.error("Checkout cleanup failed.");
    failed = true;
  }
  try {
    closeCliOwnedNetworkHandles();
  } catch {
    if (!failed) console.error("Checkout cleanup failed.");
    failed = true;
  }
  process.exitCode = failed ? 1 : 0;
}
