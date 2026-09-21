// Run with the production server and a headless Chromium on debugging port 9222.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const targets = await fetch("http://127.0.0.1:9222/json").then((response) => response.json());
const target = targets.find((item) => item.type === "page");
assert(target, "Open a Chromium page with --remote-debugging-port=9222 first");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
let nextId = 0;
const pending = new Map();
const errors = [];
socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails);
  if (message.method === "Log.entryAdded" && message.params.entry.level === "error") errors.push(message.params.entry);
  if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") errors.push(message.params.args);
  if (message.id) {
    const handlers = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) handlers.reject(message.error); else handlers.resolve(message.result);
  }
});
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function navigate(theme = "day") {
  await send("Page.navigate", { url: `http://127.0.0.1:3000/?theme=${theme}` });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await delay(100);
    if (await evaluate('document.readyState === "complete" && document.querySelectorAll("[data-presentation-index]").length === 6')) break;
  }
  await evaluate("window.scrollTo(0, 0)");
  await delay(450);
}
async function setScroll(progress, wait = 35) {
  await evaluate(`window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * ${progress})`);
  await delay(wait);
}
async function snapshot() {
  return evaluate(`(() => {
    const groups = [...document.querySelectorAll('[data-presentation-index]')].map((node) => {
      const style = getComputedStyle(node);
      return {
        active: node.dataset.presentationActive === 'true',
        ariaHidden: node.getAttribute('aria-hidden'),
        index: Number(node.dataset.presentationIndex),
        opacity: Number(style.opacity),
        phase: node.dataset.phase,
        pointerEvents: style.pointerEvents,
        transformY: style.transform === 'none' ? 0 : new DOMMatrixReadOnly(style.transform).m42,
        visibility: style.visibility,
      };
    });
    return {
      groups,
      overflow: document.documentElement.scrollWidth > innerWidth,
      readable: groups.filter(({ opacity, visibility }) => visibility === 'visible' && opacity > .05).map(({ index }) => index),
    };
  })()`);
}
function assertSettledState(state, index) {
  const active = state.groups.filter((group) => group.active);
  assert.equal(state.groups.length, 6);
  assert.equal(active.length, 1);
  assert.equal(active[0].index, index);
  assert.equal(active[0].phase, "settled");
  assert.equal(active[0].opacity, 1);
  assert.equal(active[0].visibility, "visible");
  assert.equal(active[0].transformY, 0);
  assert.deepEqual(state.readable, [index]);
  for (const group of state.groups.filter(({ active: isActive }) => !isActive)) {
    assert.equal(group.opacity, 0);
    assert.equal(group.visibility, "hidden");
    assert.equal(group.pointerEvents, "none");
    assert.equal(group.ariaHidden, "true");
  }
}
async function assertSettled(progress, index) {
  await setScroll(progress);
  assert((await snapshot()).readable.length <= 1, "Transition never overlaps readable text");
  await delay(450);
  assertSettledState(await snapshot(), index);
}

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Emulation.setEmulatedMedia", { features: [] });
  await navigate();

  assertSettledState(await snapshot(), 0);
  for (const [progress, index] of [[0.09, 1], [0.21, 2], [0.45, 3], [0.69, 4]]) {
    await assertSettled(progress, index);
  }
  for (const [progress, index] of [[0.66, 3], [0.42, 2], [0.18, 1], [0.06, 0]]) {
    await assertSettled(progress, index);
  }
  console.log("PASS every forward/reverse trigger finishes with one settled presentation");

  await setScroll(0.21);
  await setScroll(0.45);
  await setScroll(0.7);
  await delay(500);
  assertSettledState(await snapshot(), 4);
  await setScroll(0.45);
  await setScroll(0.21);
  await setScroll(0.06);
  await delay(500);
  assertSettledState(await snapshot(), 0);
  console.log("PASS rapid forward/reverse scrolling retains only the latest presentation");

  await evaluate(`(() => {
    const style = document.createElement('style');
    style.id = 'disable-presentation-animation';
    style.textContent = '.presentation-group { animation: none !important; }';
    document.head.append(style);
  })()`);
  await setScroll(0.21);
  await delay(700);
  assertSettledState(await snapshot(), 2);
  await evaluate("document.querySelector('#disable-presentation-animation').remove()");
  console.log("PASS timeout fallback settles when animation events are unavailable");

  await assertSettled(0.69, 4);
  const dwell = await evaluate("(.92 - .68) * (document.documentElement.scrollHeight - innerHeight) / innerHeight");
  assert(dwell >= 0.95 && dwell <= 1.1, `Expected about one viewport of final dwell, received ${dwell}`);
  for (const progress of [0.78, 0.86, 0.919]) {
    await setScroll(progress, 80);
    assertSettledState(await snapshot(), 4);
  }
  await setScroll(0.93);
  let state = await snapshot();
  assert(state.readable.length <= 1);
  assert.equal(state.groups.find(({ index }) => index === 5).visibility, "hidden");
  await delay(450);
  assertSettledState(await snapshot(), 5);
  await mkdir(".next/scene-checks", { recursive: true });
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(".next/scene-checks/unified-text-cta.png", Buffer.from(data, "base64"));
  console.log("PASS final narrative dwells for about one viewport and never overlaps the CTA");

  for (const [width, height] of [[1440, 900], [390, 844], [844, 390]]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    for (const theme of ["day", "night"]) {
      await navigate(theme);
      await assertSettled(0.7, 4);
      state = await snapshot();
      assert.equal(state.overflow, false);
      await assertSettled(0.95, 5);
      console.log(`PASS ${width}×${height} ${theme}: final narrative and CTA are exclusive`);
    }
  }

  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await navigate("night");
  await setScroll(0.45, 60);
  assertSettledState(await snapshot(), 3);
  await setScroll(0.95, 60);
  assertSettledState(await snapshot(), 5);
  console.log("PASS reduced motion switches immediately between settled presentations");
  await send("Emulation.setEmulatedMedia", { features: [] });
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log("PASS no browser console errors or uncaught exceptions");
} finally {
  socket.close();
}
