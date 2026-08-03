import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(new URL(".", import.meta.url).pathname);
const port = Number(process.env.PORT || 4173);

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".glb": "model/gltf-binary",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".wasm": "application/wasm",
};

// Source files revalidate every load so /v2 needs no ?v= cache-bust params.
// Big binaries (models, music) are content-stable, so let the browser keep them.
const noCache = new Set([".html", ".js", ".mjs", ".css"]);

function sendError(response, code, message) {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.writeHead(code, { "content-type": "text/plain; charset=utf-8" });
  response.end(message);
}

async function handle(request, response) {
  // Malformed request targets (protocol-relative "//", bad percent-escapes)
  // are a client error, not a server crash.
  let url;
  try {
    url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  } catch {
    return sendError(response, 400, "Bad request");
  }
  let requested;
  try {
    requested = decodeURIComponent(url.pathname);
  } catch {
    return sendError(response, 400, "Bad request");
  }
  if (requested.endsWith("/")) requested += "index.html";
  const path = normalize(join(root, requested));
  if (!path.startsWith(root)) return sendError(response, 403, "Forbidden");

  const info = await stat(path).catch(() => null);
  if (!info || !info.isFile()) return sendError(response, 404, "Not found");

  const ext = extname(path);
  const headers = {
    "content-type": types[ext] || "application/octet-stream",
    "accept-ranges": "bytes",
  };
  headers["cache-control"] = noCache.has(ext) ? "no-cache" : "public, max-age=3600";

  // Range support matters for <audio>: browsers request music by byte range and
  // some will not start playback (or cannot seek) without a proper 206.
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range || "");
  let start = 0;
  let end = info.size - 1;
  let status = 200;
  if (range) {
    const [, rawStart, rawEnd] = range;
    if (rawStart === "" && rawEnd === "") return sendError(response, 416, "Bad range");
    if (rawStart === "") {
      start = Math.max(0, info.size - Number(rawEnd));
    } else {
      start = Number(rawStart);
      if (rawEnd !== "") end = Math.min(end, Number(rawEnd));
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= info.size) {
      response.writeHead(416, { "content-range": `bytes */${info.size}` });
      return response.end();
    }
    status = 206;
    headers["content-range"] = `bytes ${start}-${end}/${info.size}`;
  }
  headers["content-length"] = end - start + 1;

  response.writeHead(status, headers);
  if (request.method === "HEAD") return response.end();

  // Stream rather than buffer: model GLBs are ~20MB each and music tracks a few
  // MB, and buffering them per request spikes memory under concurrent loads.
  const stream = createReadStream(path, { start, end });
  stream.on("error", () => response.destroy());
  // A client that navigates away mid-download (very common with 20MB models)
  // aborts the socket; tear the read stream down instead of leaking it.
  response.on("close", () => stream.destroy());
  stream.pipe(response);
}

const server = createServer((request, response) => {
  // Socket errors (client aborts, resets) surface here as stream 'error'
  // events. Unhandled, they become uncaught exceptions that kill the process
  // and leave the next request with ERR_CONNECTION_CLOSED.
  request.on("error", () => response.destroy());
  response.on("error", () => {});
  handle(request, response).catch((error) => {
    console.error(`[server] ${request.method} ${request.url}: ${error?.message || error}`);
    sendError(response, 500, "Server error");
  });
});

server.on("clientError", (error, socket) => {
  if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

// Last-resort guard: a dev server going down mid-session is far more disruptive
// than a logged error, and every known throw path above is already handled.
process.on("uncaughtException", (error) => {
  console.error(`[server] uncaught: ${error?.stack || error}`);
});

// Bind every interface by default so a PHONE on the same wifi can open the
// game and the debug pages. Loopback-only meant the only way to look at
// anything on a handset was to not look at it. Set HOST=127.0.0.1 to go back
// to loopback if you are on a network you do not trust.
const host = process.env.HOST || "0.0.0.0";
server.listen(port, host, () => {
  console.log(`BattleBot Arena running at http://127.0.0.1:${port}`);
  if (host === "0.0.0.0") {
    for (const [name, addrs] of Object.entries(networkInterfaces())) {
      for (const a of addrs || []) {
        if (a.family === "IPv4" && !a.internal) console.log(`  on ${name}: http://${a.address}:${port}`);
      }
    }
  }
});
