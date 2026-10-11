// Isolated browser fixture proxy. Never forwards any /api request to the app.
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { WebSocket, WebSocketServer } from "ws";

const target = process.argv[2] ?? "http://127.0.0.1:3000";
const port = Number(process.argv[3] ?? 3105);
const mode = process.argv[4] ?? "fresh";
const image = await sharp({
  create: { width: 120, height: 160, channels: 3, background: "#cba88e" },
})
  .png()
  .toBuffer();
await sharp(image).toFile(".next/portrait-preview-reference.png");
const themes = [
  "Central Park",
  "Rene Magritte",
  "Tarot: The Lover",
  "Tarot: The World",
  "Tarot: The Star",
];
const catalog = themes.map((name, index) => ({
  id: index + 1,
  name,
  description: "A hand-drawn little world for your favorite faces.",
  preview: {
    alt: `Synthetic ${name} preview`,
    width: 600,
    height: 800,
    url: `/api/storefront/template-media/${index + 1}`,
  },
}));
const limits = {
  additionalSubjectAmountCents: 500,
  baseAmountCents: 2000,
  maximumPortraits: 5,
  maximumSubjectNameCharacters: 80,
  maximumSubjectsPerPortrait: 3,
  minimumPortraits: 1,
  minimumSubjectsPerPortrait: 1,
};
const uploadLimits = {
  maximumBytesPerCart: 104857600,
  maximumBytesPerPortrait: 31457280,
  maximumFilesPerCart: 15,
  maximumFilesPerPortrait: 3,
  maximumPixels: 50000000,
  perFileUploadLimitBytes: 15728640,
};
let portraits = [];
let intent = mode === "legacy" || mode === "payment";
let nextPhoto = 1;
const cart = () => ({
  limits,
  portraits,
  subtotalCents: portraits.reduce((sum, p) => sum + p.amountCents, 0),
  uploadLimits,
});
const refresh = (p) => {
  p.photos.forEach((photo, i) => {
    photo.position = i + 1;
  });
  const covered = new Set(p.photos.flatMap((photo) => photo.subjectIds));
  p.photoState = {
    complete: p.subjects.every((s) => covered.has(s.id)),
    coveredSubjectIds: p.subjects
      .filter((s) => covered.has(s.id))
      .map((s) => s.id),
    totalBytes: p.photos.length * image.length,
  };
};

const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://fixture.local").pathname;
  const json = (body, status = 200) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(body));
  };
  try {
    if (!path.startsWith("/api/")) {
      const headers = { ...req.headers, host: new URL(target).host };
      delete headers.connection;
      const upstream = await fetch(`${target}${req.url}`, {
        headers,
        redirect: "manual",
      });
      const responseHeaders = Object.fromEntries(upstream.headers);
      delete responseHeaders["content-encoding"];
      delete responseHeaders["content-length"];
      res.writeHead(upstream.status, responseHeaders);
      res.end(Buffer.from(await upstream.arrayBuffer()));
      return;
    }
    if (path === "/api/storefront/postcard-templates") {
      json({ templates: mode === "empty" ? [] : catalog });
      return;
    }
    if (path.startsWith("/api/storefront/template-media/")) {
      const n = Number(path.split("/").at(-1));
      const color =
        ["#7b9987", "#819aa9", "#bc8c96", "#859aa8", "#baa277"][n - 1] ??
        "#7b9987";
      res.writeHead(200, { "Content-Type": "image/svg+xml" });
      res.end(
        `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800"><rect width="600" height="800" fill="#eee7d1"/><rect x="30" y="30" width="540" height="740" fill="${color}"/><circle cx="300" cy="300" r="150" fill="#d6cfb2"/><path d="M80 740L140 270L185 740M420 740L450 200L490 740" stroke="#334a3d" stroke-width="24" fill="none"/><rect x="160" y="430" width="280" height="220" rx="120" fill="#eee7d1"/><text x="300" y="120" text-anchor="middle" font-family="Georgia" font-size="24" fill="#f9f1da">${themes[n - 1]}</text></svg>`,
      );
      return;
    }
    const root = "/api/storefront/checkout-intents";
    if (path === `${root}/current` && req.method === "GET") {
      if (!intent) {
        json({ error: { code: "INTENT_UNAVAILABLE" } }, 401);
        return;
      }
      json({
        amountCents: cart().subtotalCents || 2000,
        status: mode === "payment" ? "checkout_created" : "draft",
        uploads: portraits.flatMap((p) => p.photos),
      });
      return;
    }
    if (path === root && req.method === "POST") {
      intent = true;
      json(
        {
          amountCents: 2000,
          artistNote: "",
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          status: "draft",
          uploads: [],
          limits: {
            allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
            maxFileBytes: 15728640,
            maxFiles: 3,
            maxTotalBytes: 31457280,
            minimumAmountCents: 500,
          },
        },
        201,
      );
      return;
    }
    if (path === `${root}/current/abandon`) {
      intent = false;
      portraits = [];
      res.writeHead(204);
      res.end();
      return;
    }
    if (path === `${root}/current/cart`) {
      json(cart());
      return;
    }
    const base = `${root}/current/cart/portraits`;
    const segments = path.slice(base.length).split("/").filter(Boolean);
    const p = portraits.find((item) => item.id === segments[0]);
    if (path.startsWith(base)) {
      if (segments[1] === "uploads" && segments[3] === "preview" && p) {
        res.writeHead(200, {
          "Content-Type": "image/png",
          "Content-Length": image.length,
        });
        res.end(image);
        return;
      }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      if (segments[1] === "uploads" && p) {
        const id = Number(segments[2]);
        if (req.method === "POST") {
          const request = new Request("http://fixture.local", {
            method: "POST",
            headers: { "Content-Type": req.headers["content-type"] },
            body,
          });
          const data = await request.formData();
          const metadata = JSON.parse(data.get("_payload"));
          const photoId = nextPhoto++;
          p.photos.push({
            id: photoId,
            position: p.photos.length + 1,
            height: 160,
            width: 120,
            sizeBytes: image.length,
            mimeType: "image/png",
            subjectIds: metadata.subjectIds,
            previewUrl: `${base}/${p.id}/uploads/${photoId}/preview`,
          });
        } else if (req.method === "DELETE")
          p.photos = p.photos.filter((photo) => photo.id !== id);
        else if (req.method === "PUT") {
          const metadata = JSON.parse(body);
          p.photos.find((photo) => photo.id === id).subjectIds =
            metadata.subjectIds;
        }
        refresh(p);
        json(cart(), req.method === "POST" ? 201 : 200);
        return;
      }
      if (req.method === "DELETE" && p) {
        portraits = portraits.filter((item) => item.id !== p.id);
        portraits.forEach((item, i) => {
          item.position = i + 1;
        });
        json(cart());
        return;
      }
      const input = JSON.parse(body);
      const subjects = input.subjects.map((s, index) => ({
        ...s,
        id: s.id ?? randomUUID(),
        position: index + 1,
      }));
      const t = catalog.find((t) => t.id === input.templateId);
      if (p)
        Object.assign(p, {
          subjects,
          artistNote: input.artistNote.trim(),
          template: { ...t, available: true },
          amountCents: 2000 + (subjects.length - 1) * 500,
        });
      else
        portraits.push({
          id: randomUUID(),
          position: portraits.length + 1,
          subjects,
          artistNote: input.artistNote.trim(),
          template: { ...t, available: true },
          amountCents: 2000 + (subjects.length - 1) * 500,
          photos: [],
        });
      portraits.forEach(refresh);
      json(cart(), p ? 200 : 201);
      return;
    }
    json({ error: { code: "UNMOCKED_API_BLOCKED" } }, 503);
  } catch {
    json({ error: { code: "FIXTURE_FAILED" } }, 500);
  }
});
// Next dev's runtime waits for its HMR connection; proxy it without forwarding APIs.
const upgrades = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  if (!req.url.startsWith("/_next/")) {
    socket.destroy();
    return;
  }
  const upstream = new WebSocket(`${target.replace(/^http/, "ws")}${req.url}`);
  upstream.on("open", () =>
    upgrades.handleUpgrade(req, socket, head, (downstream) => {
      downstream.on("message", (data, binary) => {
        if (upstream.readyState === WebSocket.OPEN)
          upstream.send(data, { binary });
      });
      upstream.on("message", (data, binary) => {
        if (downstream.readyState === WebSocket.OPEN)
          downstream.send(data, { binary });
      });
      downstream.on("close", () => upstream.close());
      upstream.on("close", () => downstream.close());
    }),
  );
  upstream.on("error", () => socket.destroy());
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    `Portrait preview fixture: http://127.0.0.1:${port}/checkout/preview (all API traffic mocked)`,
  ),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => server.close(() => process.exit(0)));
