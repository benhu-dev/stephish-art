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
    if (await evaluate('document.readyState === "complete" && !!document.querySelector("[data-final-cta]")')) break;
  }
  await delay(200);
}
async function scroll(progress) {
  await evaluate(`window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * ${progress})`);
  await delay(450);
}
async function openModal() {
  await scroll(1);
  await evaluate('document.querySelector("[data-final-cta] button").click()');
  await delay(260);
}
async function screenshot(name) {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(`.next/scene-checks/${name}.png`, Buffer.from(data, "base64"));
}

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  await mkdir(".next/scene-checks", { recursive: true });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await navigate();
  const story = [];
  for (const progress of [0.26, 0.52, 0.82, 1, 0.82, 0.52, 0.26]) {
    await scroll(progress);
    story.push(await evaluate(`(() => {
      const stages = [...document.querySelectorAll('[data-narrative-stage]')];
      return stages.map((node) => ({ opacity: Number(getComputedStyle(node).opacity), text: node.textContent.trim() }))
        .sort((a, b) => b.opacity - a.opacity)[0].text;
    })()`));
  }
  assert.deepEqual(story.slice(0, 3), [
    "Drop in a little inspiration.",
    "Hold still — something personal is developing.",
    "A small piece of your story, made by hand.",
  ]);
  assert.deepEqual(story.slice(4), story.slice(0, 3).toReversed());
  await scroll(1);
  assert.equal(await evaluate('getComputedStyle(document.querySelector("[data-final-cta]")).visibility'), "visible");
  console.log("PASS narrative timing, final CTA reveal, and exact reverse scroll");

  await evaluate(`(() => {
    window.__checkoutRequests = [];
    window.__checkoutPending = [];
    window.__checkoutStartUrl = location.href;
    window.fetch = (url, options = {}) => {
      window.__checkoutRequests.push({
        body: options.body,
        cache: options.cache,
        credentials: options.credentials,
        headers: Object.fromEntries(new Headers(options.headers)),
        method: options.method,
        url: String(url),
      });
      return new Promise((resolve, reject) => window.__checkoutPending.push({ reject, resolve }));
    };
    window.__replyCheckout = (status, amountCents = 1000, minimumAmountCents = 500) => {
      const pending = window.__checkoutPending.shift();
      const body = status === 200 || status === 201 ? {
        amountCents,
        expiresAt: '2026-09-22T12:00:00.000Z',
        limits: {
          allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
          maxFileBytes: 15 * 1024 * 1024,
          maxFiles: 3,
          maxTotalBytes: 30 * 1024 * 1024,
          minimumAmountCents,
        },
        status: 'draft',
        uploads: [],
      } : { error: { code: status === 400 ? 'INVALID_AMOUNT' : 'INTERNAL_ERROR' } };
      pending.resolve(new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json' }, status,
      }));
    };
  })()`);
  await openModal();
  const opening = await evaluate(`(() => ({
    bodyOverflow: document.body.style.overflow,
    focused: document.activeElement?.getAttribute('aria-label'),
    continueDisabled: [...document.querySelectorAll('.modal-actions button')].find((node) => node.textContent.includes('Continue')).disabled,
    role: document.querySelector('[role=dialog]')?.getAttribute('aria-modal')
  }))()`);
  assert.deepEqual(opening, { bodyOverflow: "hidden", focused: "Close checkout preview", continueDisabled: true, role: "true" });
  await evaluate(`(() => {
    window.__urlCounts = { created: 0, revoked: 0 };
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (value) => { window.__urlCounts.created += 1; return create(value); };
    URL.revokeObjectURL = (value) => { window.__urlCounts.revoked += 1; return revoke(value); };
  })()`);
  await evaluate(`(() => {
    const input = document.querySelector('.amount-input-wrap input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '4.99');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await delay(30);
  assert.equal(await evaluate(`document.querySelector('.modal-actions .continue-button').disabled`), true);
  assert.match(await evaluate(`document.querySelector('.field-error').textContent`), /at least \$5\.00/);
  assert.equal(await evaluate(`window.__checkoutRequests.length`), 0);
  await evaluate(`[...document.querySelectorAll('.amount-preset')].find((node) => node.textContent.trim() === '$10').click()`);
  assert.equal(await evaluate(`document.querySelector('.modal-actions .continue-button').disabled`), false);
  await evaluate(`(() => {
    const button = document.querySelector('.modal-actions .continue-button');
    button.click(); button.click();
  })()`);
  await delay(30);
  assert.deepEqual(await evaluate(`(() => ({
    calls: window.__checkoutRequests.length,
    controlsDisabled: [...document.querySelectorAll('.amount-preset, .amount-input-wrap input')].every((node) => node.disabled),
    forwardDisabled: document.querySelector('.continue-button').disabled,
    label: document.querySelector('.continue-button').textContent,
    step: document.querySelector('#checkout-modal-title').textContent,
  }))()`), {
    calls: 1, controlsDisabled: true, forwardDisabled: true,
    label: "Saving your amount…", step: "Choose your amount",
  });
  assert.deepEqual(await evaluate(`window.__checkoutRequests[0]`), {
    body: JSON.stringify({ amountCents: 1000 }),
    cache: "no-store",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/api/storefront/checkout-intents",
  });
  await evaluate(`window.__replyCheckout(400)`);
  await delay(50);
  assert.deepEqual(await evaluate(`(() => ({
    amountKept: [...document.querySelectorAll('.amount-preset')].find((node) => node.textContent.trim() === '$10').getAttribute('aria-pressed'),
    error: document.querySelector('.field-error').textContent,
    forwardDisabled: document.querySelector('.continue-button').disabled,
    step: document.querySelector('#checkout-modal-title').textContent,
  }))()`), {
    amountKept: "true", error: "Check the amount and try again.",
    forwardDisabled: false, step: "Choose your amount",
  });
  await evaluate(`(() => {
    const button = document.querySelector('.modal-actions .continue-button');
    button.click(); button.click();
  })()`);
  await delay(30);
  assert.equal(await evaluate(`window.__checkoutRequests.length`), 2);
  await evaluate(`window.__replyCheckout(201, 1050, 700)`);
  await delay(80);
  assert.equal(await evaluate(`document.querySelector('#checkout-modal-title').textContent`), "Add your photos");
  await evaluate(`document.querySelector('.back-button').click()`);
  assert.deepEqual(await evaluate(`(() => ({
    help: document.querySelector('#amount-help').textContent,
    value: document.querySelector('.amount-input-wrap input').value,
  }))()`), { help: "Minimum $7.00 · dollars and cents only", value: "10.50" });
  await evaluate(`(() => {
    const input = document.querySelector('.amount-input-wrap input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '12.50');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await delay(30);
  await evaluate(`document.querySelector('.continue-button').click()`);
  await delay(30);
  assert.equal(await evaluate(`window.__checkoutRequests.length`), 3);
  assert.equal(await evaluate(`window.__checkoutRequests[2].body`), JSON.stringify({ amountCents: 1250 }));
  await evaluate(`window.__replyCheckout(200, 1250, 700)`);
  await delay(80);
  assert.equal(await evaluate(`document.querySelector('#checkout-modal-title').textContent`), "Add your photos");
  assert.equal(await evaluate(`location.href === window.__checkoutStartUrl`), true);
  assert.equal(await evaluate(`/intentId|accessToken|tokenHash|checkoutSession|storage/i.test(document.querySelector('[role=dialog]').textContent + location.href)`), false);
  console.log("PASS exact amount request, single-flight loading, safe error retry, and new/resumed Intent responses");
  await evaluate(`(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['x'], 'not-shown.gif', { type: 'image/gif' }));
    document.querySelector('.photo-dropzone').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  })()`);
  await delay(30);
  assert.match(await evaluate(`document.querySelector('.field-error').textContent`), /JPEG, PNG, or WebP/);
  await evaluate(`(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 24; canvas.height = 18;
    const context = canvas.getContext('2d');
    context.fillStyle = '#b9607c'; context.fillRect(0, 0, 24, 18);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'private-one.png', { type: 'image/png' }));
    transfer.items.add(new File([blob], 'private-two.png', { type: 'image/png' }));
    transfer.items.add(new File([blob], 'private-three.png', { type: 'image/png' }));
    document.querySelector('.photo-dropzone').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  })()`);
  await delay(80);
  assert.equal(await evaluate(`document.querySelectorAll('.photo-preview-list li').length`), 3);
  assert.equal(await evaluate(`[...document.querySelectorAll('.photo-preview-list img')].every((image) => image.complete && image.naturalWidth > 0)`), true);
  assert.equal(await evaluate(`document.querySelector('[role=dialog]').textContent.includes('private-one.png')`), false);
  await evaluate(`(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 2; canvas.height = 2;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'fourth.png', { type: 'image/png' }));
    document.querySelector('.photo-dropzone').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  })()`);
  await delay(30);
  assert.match(await evaluate(`document.querySelector('.field-error').textContent`), /up to 3/);
  await evaluate(`[...document.querySelectorAll('.photo-preview-list li:first-child button')].find((node) => node.textContent === 'Remove').click()`);
  await evaluate(`[...document.querySelectorAll('.photo-preview-list li:first-child button')].find((node) => node.textContent === 'Replace').click()`);
  await evaluate(`(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 24; canvas.height = 18;
    const context = canvas.getContext('2d');
    context.fillStyle = '#e7ba58'; context.fillRect(0, 0, 24, 18);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'replacement.png', { type: 'image/png' }));
    const input = document.querySelector('input[type=file]');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await delay(80);
  assert.deepEqual(await evaluate(`window.__urlCounts`), { created: 4, revoked: 2 });
  assert.equal(await evaluate(`document.querySelectorAll('.photo-preview-list li').length`), 2);
  await evaluate(`document.querySelector('.modal-actions .continue-button').click()`);
  const review = await evaluate(`(() => ({
    heading: document.querySelector('#checkout-modal-title').textContent,
    photoCount: document.querySelector('.review-photos span').textContent,
    totals: document.querySelector('.review-totals').textContent.replace(/\s+/g, ' ').trim()
  }))()`);
  assert.equal(review.heading, "Ready for the press?");
  assert.equal(review.photoCount, "2 photos");
  assert.match(review.totals, /Your amount\$12\.50/);
  assert.match(review.totals, /Shipping\$1\.00/);
  assert.match(review.totals, /Total\$13\.50/);
  await evaluate(`(() => {
    window.__clientCalls = 0;
    const fetch = window.fetch;
    window.fetch = (...args) => { window.__clientCalls += 1; return fetch(...args); };
    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (...args) { window.__clientCalls += 1; return open.apply(this, args); };
    navigator.sendBeacon = () => { window.__clientCalls += 1; return false; };
    document.querySelector('.secure-checkout-button').click();
  })()`);
  await delay(50);
  assert.equal(await evaluate(`window.__clientCalls`), 0);
  assert.equal(await evaluate(`window.__checkoutRequests.length`), 3);
  assert.match(await evaluate(`document.querySelector('.modal-notice').textContent`), /not connected yet/);
  await screenshot("checkout-modal-desktop");
  await evaluate(`document.querySelector('.modal-close').click()`);
  assert.deepEqual(await evaluate(`(() => ({
    dialog: !!document.querySelector('[role=dialog]'),
    focused: document.activeElement?.textContent.includes('Draw Me One'),
    overflow: document.body.style.overflow,
    revoked: window.__urlCounts.revoked
  }))()`), { dialog: false, focused: true, overflow: "", revoked: 2 });
  await evaluate(`document.querySelector('[data-final-cta] button').click()`);
  await delay(50);
  assert.equal(await evaluate(`document.querySelector('#checkout-modal-title').textContent`), "Ready for the press?");
  await evaluate(`document.querySelector('.modal-close').focus(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }))`);
  assert.equal(await evaluate(`document.activeElement.textContent.trim()`), "Back");
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))`);
  assert.equal(await evaluate(`document.activeElement.getAttribute('aria-label')`), "Close checkout preview");
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  assert.equal(await evaluate(`document.activeElement.textContent.includes('Draw Me One')`), true);
  console.log("PASS local previews, authoritative review math, no-submit final action, focus trap, Escape, restoration, scroll lock, and session state");

  for (const [width, height, theme] of [[390, 844, "night"], [844, 390, "day"]]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await navigate(theme);
    await openModal();
    const layout = await evaluate(`(() => {
      const rect = document.querySelector('.checkout-paper').getBoundingClientRect();
      const paper = document.querySelector('.checkout-paper');
      const overlay = document.querySelector('.checkout-modal-overlay');
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: innerWidth, height: innerHeight,
        overflow: document.documentElement.scrollWidth > innerWidth || paper.scrollWidth > paper.clientWidth || overlay.scrollWidth > overlay.clientWidth,
        theme: document.querySelector('[data-checkout-modal]').dataset.theme };
    })()`);
    assert(layout.left >= 0 && layout.right <= layout.width && layout.top >= 0 && layout.bottom <= layout.height);
    assert.equal(layout.overflow, false);
    assert.equal(layout.theme, theme);
    await screenshot(`checkout-modal-${width}-${theme}`);
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  }
  console.log("PASS modal day/night art direction and mobile portrait/landscape containment");

  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await navigate("night");
  await openModal();
  assert.deepEqual(await evaluate(`(() => ({
    overlay: getComputedStyle(document.querySelector('.checkout-modal-overlay')).animationName,
    paper: getComputedStyle(document.querySelector('.checkout-paper')).animationName,
    step: getComputedStyle(document.querySelector('.checkout-step')).animationName
  }))()`), { overlay: "none", paper: "none", step: "none" });
  console.log("PASS reduced-motion modal has no entrance animation");
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log("PASS no browser console errors or uncaught exceptions");
} finally {
  socket.close();
}
