// Run against `npm run start` and a headless Chromium on debugging port 9222.
import assert from "node:assert/strict";

const targets = await fetch("http://127.0.0.1:9222/json").then((response) =>
  response.json(),
);
const target = targets.find((item) => item.type === "page");
assert(target, "Open a Chromium page with --remote-debugging-port=9222 first");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) =>
  socket.addEventListener("open", resolve, { once: true }),
);

let nextId = 0;
const pending = new Map();
socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  if (!message.id) return;
  const handlers = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) handlers.reject(message.error);
  else handlers.resolve(message.result);
});

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { reject, resolve });
    socket.send(JSON.stringify({ id, method, params }));
  });

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
  });
  assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

async function navigate(query = "") {
  await send("Page.navigate", {
    url: `http://127.0.0.1:3000/${query}`,
  });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await delay(100);
    const theme = await evaluate(
      'document.querySelector("[data-theme]")?.dataset.theme ?? null',
    );
    if (theme) return theme;
  }
  throw new Error("Scene theme did not render");
}

const fixedInstant = "2027-07-15T10:00:00.000Z";
const dateMock = `(() => {
  const NativeDate = Date;
  const fixedTime = NativeDate.parse(${JSON.stringify(fixedInstant)});
  class FixedDate extends NativeDate {
    constructor(...args) {
      super(...(args.length === 0 ? [fixedTime] : args));
    }
    static now() { return fixedTime; }
  }
  globalThis.Date = FixedDate;
})();`;

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setTimezoneOverride", {
    timezoneId: "America/Los_Angeles",
  });
  const preload = await send("Page.addScriptToEvaluateOnNewDocument", {
    source: dateMock,
  });

  assert.equal(
    await navigate(),
    "day",
    "06:00 EDT must resolve to day even when the browser timezone is Los Angeles",
  );
  assert.equal(
    await navigate("?theme=night"),
    "night",
    "The explicit night query override must win",
  );

  await send("Page.removeScriptToEvaluateOnNewDocument", {
    identifier: preload.identifier,
  });
  console.log("PASS New York automatic theme and explicit query override");
} finally {
  socket.close();
}
