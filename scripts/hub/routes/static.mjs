/**
 * Static file serving for the portal, with SPA fallback.
 *
 * - portal/dist exists  -> serve it; unknown extension-less paths get index.html
 * - portal/dist missing -> serve the Hub placeholder page (and /api/state still works)
 *
 * Paths are resolved and clamped inside the dist directory; traversal is rejected.
 */

import fs from "node:fs";
import path from "node:path";

import { sendJson, sendText } from "../http.mjs";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

function contentType(file) {
  return MIME_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** Resolve a URL path inside `root`, or null when it escapes / is malformed. */
export function safeResolveInside(root, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const relative = decoded.replace(/^[/\\]+/, "");
  const full = path.resolve(root, relative);
  const base = path.resolve(root);
  if (full !== base && !full.startsWith(base + path.sep)) return null;
  return full;
}

function sendFile(req, res, file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    sendText(res, 404, "not found\n");
    return;
  }
  const isHtml = path.extname(file).toLowerCase() === ".html";
  const cacheControl = isHtml
    ? "no-cache"
    : file.includes(`${path.sep}assets${path.sep}`)
      ? "public, max-age=31536000, immutable"
      : "public, max-age=3600";
  res.writeHead(200, {
    "content-type": contentType(file),
    "content-length": stat.size,
    "cache-control": cacheControl,
    "x-content-type-options": "nosniff",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  const stream = fs.createReadStream(file);
  stream.once("error", () => {
    if (!res.headersSent) sendText(res, 500, "could not read file\n");
    else res.destroy();
  });
  stream.pipe(res);
}

/**
 * @param {object} options
 * @param {string} options.distDir     portal/dist
 * @param {string} options.indexFile   portal/dist/index.html
 * @param {string} options.placeholderFile  Hub placeholder (used until the portal is built)
 */
export function createStaticHandler({ distDir, indexFile, placeholderFile }) {
  return function serveStatic(req, res, url) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, 405, { error: "method not allowed" }, { allow: "GET, HEAD" });
      return;
    }

    const resolved = safeResolveInside(distDir, url.pathname);
    if (!resolved) {
      sendText(res, 400, "bad path\n");
      return;
    }

    if (isFile(resolved) && resolved !== path.resolve(indexFile)) {
      sendFile(req, res, resolved);
      return;
    }

    const hasExtension = Boolean(path.extname(url.pathname));
    if (isFile(indexFile)) {
      if (!hasExtension) {
        sendFile(req, res, indexFile); // SPA fallback for client-side routes
        return;
      }
      sendText(res, 404, "not found\n"); // a missing asset is not an SPA route
      return;
    }

    // Portal not built yet: a clear placeholder for every non-asset route.
    if (hasExtension) {
      sendText(res, 404, "Portal build not found. Run: node scripts/setup.mjs\n");
      return;
    }
    if (!isFile(placeholderFile)) {
      sendText(
        res,
        200,
        "IELTS Study Hub is running.\n\nThe portal is not built yet. Run: node scripts/setup.mjs\nthen reload this page. The API is available at /api/state.\n",
        { "x-hub-placeholder": "1", "content-type": "text/plain; charset=utf-8" },
      );
      return;
    }
    res.setHeader("x-hub-placeholder", "1");
    sendFile(req, res, placeholderFile);
  };
}
