import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const tsxCli = fileURLToPath(
  new URL("../../node_modules/tsx/dist/cli.mjs", import.meta.url),
);
const cleanupCli = fileURLToPath(
  new URL("../../scripts/checkout-cleanup.ts", import.meta.url),
);
const cleanupSummaries = (stdout) =>
  stdout
    .split(/\r?\n/u)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const value = JSON.parse(line);
        return value?.mode === "dry-run" ? [value] : [];
      } catch {
        return [];
      }
    });

const runCli = (arguments_ = []) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [tsxCli, cleanupCli, ...arguments_],
      {
        cwd: projectRoot,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let stderr = "";
    let stdout = "";
    let summaryObserved = false;
    let timedOut = false;
    let timeout = setTimeout(() => {
      timedOut = "before-summary";
      child.kill();
    }, 60_000);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (
        !summaryObserved &&
        !timedOut &&
        cleanupSummaries(stdout).length === 1
      ) {
        summaryObserved = true;
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          timedOut = "after-summary";
          child.kill();
        }, 5_000);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, stderr, stdout, timedOut });
    });
  });

test(
  "standalone cleanup CLI prints one dry-run summary and exits naturally",
  { timeout: 65_000 },
  async () => {
    const result = await runCli();

    assert.equal(result.timedOut, false, "CLI remained alive after its summary");
    assert.equal(result.signal, null);
    assert.equal(result.code, 0);
    const summaries = cleanupSummaries(result.stdout);
    assert.equal(summaries.length, 1);
    assert.equal(Number.isInteger(summaries[0].scanned), true);
    assert.equal(Number.isInteger(summaries[0].eligible), true);
  },
);

test("standalone cleanup CLI exits nonzero for invalid arguments", async () => {
  const result = await runCli(["--invalid"]);

  assert.equal(result.timedOut, false);
  assert.equal(result.signal, null);
  assert.equal(result.code, 1);
  assert.equal(cleanupSummaries(result.stdout).length, 0);
  assert.match(result.stderr, /Checkout cleanup failed\./u);
});
