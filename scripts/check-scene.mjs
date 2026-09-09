// Run against `npm run start` and a headless Chromium on debugging port 9222.
// Uses Node's native WebSocket; no browser-testing dependency is required.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const targets = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
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
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
if (process.argv.includes("--close-browser")) {
  await send("Browser.close");
  process.exit(0);
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function navigate(query = "") {
  await send("Page.navigate", { url: `http://localhost:3000/${query}` });
  for (let i = 0; i < 50; i++) {
    await delay(100);
    if (await evaluate('document.readyState === "complete" && !!document.querySelector("[data-progress]")?.style.transform')) break;
  }
  await delay(250);
}
async function scroll(progress) {
  await evaluate(`window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * ${progress})`);
  await delay(220);
  return evaluate(`(() => {
    const rect = document.querySelector('.machine').getBoundingClientRect();
    const scene = document.querySelector('.postcard-scene').getBoundingClientRect();
    return {
      coin: getComputedStyle(document.querySelector('[data-coin]')).transform,
      coinOpacity: getComputedStyle(document.querySelector('[data-coin]')).opacity,
      card: getComputedStyle(document.querySelector('[data-postcard]')).transform,
      status: document.querySelector('[role=status]').textContent,
      theme: document.querySelector('[data-theme]').dataset.theme,
      overflow: document.documentElement.scrollWidth > innerWidth,
      machine: { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom },
      sceneTop: scene.top, width: innerWidth, height: innerHeight
    };
  })()`);
}
const translate = (matrix, axis) => Number(matrix.slice(7, -1).split(",")[axis === "x" ? 4 : 5]);
async function screenshot(name) {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(`.next/scene-checks/${name}.png`, Buffer.from(data, "base64"));
}

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  await mkdir(".next/scene-checks", { recursive: true });
  for (const [width, height] of [[1440, 900], [390, 844], [844, 390]]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    for (const theme of ["day", "night"]) {
      await navigate(`?theme=${theme}`);
      const start = await scroll(0);
      assert.equal(start.theme, theme);
      assert(!start.overflow, "No horizontal scrolling");
      assert(start.machine.x >= 0 && start.machine.right <= width, "Machine fits horizontally");
      assert(start.machine.y >= 0 && start.machine.bottom <= height, "Machine fits vertically");
      if (height > width) {
        const celestial = await evaluate(`(() => {
          const r = document.querySelector('.${theme === "day" ? "sun" : "moon"}').getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        })()`);
        assert(celestial.left >= 0 && celestial.right <= width && celestial.top >= 0 && celestial.bottom <= height, "Sun or moon fits the mobile scene");
      }
      assert(translate(start.card, "y") <= -165, "Card begins hidden");
      await screenshot(`${width}-${theme}-start`);
      const coin = await scroll(.26);
      assert(translate(coin.coin, "x") > 20 && translate(coin.coin, "x") < 100, "Coin travels toward slot");
      assert.equal(coin.coinOpacity, "1");
      const inserted = await scroll(.43);
      assert(translate(inserted.coin, "x") >= 119, "Coin moves fully behind mask");
      const printing = await scroll(.7);
      assert(translate(printing.card, "y") > -166 && translate(printing.card, "y") < -1, "Postcard partially printed");
      const end = await scroll(1);
      assert.equal(translate(end.card, "y"), 0, "Postcard fully printed");
      assert.equal(end.sceneTop, 0, "Scene stays fixed");
      assert.equal(end.machine.y, start.machine.y, "Machine stays fixed");
      await screenshot(`${width}-${theme}-end`);
      const reverse = await scroll(.7);
      assert(Math.abs(translate(reverse.card, "y") - translate(printing.card, "y")) < 1, "Printing reverses exactly");
      const reverseCoin = await scroll(.26);
      assert(Math.abs(translate(reverseCoin.coin, "x") - translate(coin.coin, "x")) < 1, "Coin reverses exactly");
      const reset = await scroll(0);
      assert.equal(reset.coinOpacity, "0");
      assert(translate(reset.card, "y") <= -165);
      console.log(`PASS ${width}×${height} ${theme}: framing, masking, printing, fixed scene, reversal`);
    }
  }
  for (const [hour, theme] of [[5, "night"], [6, "day"], [17, "day"], [18, "night"]]) {
    const preload = await send("Page.addScriptToEvaluateOnNewDocument", { source: `Date.prototype.getHours = () => ${hour};` });
    await navigate();
    assert.equal((await scroll(0)).theme, theme);
    await navigate(`?theme=${theme === "day" ? "night" : "day"}`);
    assert.notEqual((await scroll(0)).theme, theme, "Query override wins over local time");
    await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: preload.identifier });
  }
  console.log("PASS automatic local-time boundaries and query override precedence");
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await navigate("?theme=night");
  const reducedStart = await scroll(0);
  const reducedMiddle = await scroll(.25);
  assert.equal(reducedStart.coin, reducedMiddle.coin, "Reduced-motion coin does not travel");
  assert.equal((await scroll(.43)).coinOpacity, "0");
  assert.equal(translate((await scroll(.7)).card, "y"), 0);
  assert(translate((await scroll(0)).card, "y") <= -165);
  const ambientStart = await evaluate('document.querySelector("[data-cloud]").getAttribute("style")');
  await delay(300);
  assert.equal(await evaluate('document.querySelector("[data-cloud]").getAttribute("style")'), ambientStart);
  console.log("PASS reduced motion: discrete reversible states and no cloud movement");
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log("PASS no browser console errors or uncaught exceptions");
} finally {
  socket.close();
}
