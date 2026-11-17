/**
 * Shared HTTP helpers for the Hub server: loopback-only host checks, JSON/text
 * responses and baseline security headers.
 */

export function sendJson(res, statusCode, body, headers = {}) {
  const text = `${JSON.stringify(body)}\n`;
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
    ...headers,
  });
  res.end(text);
}

export function sendText(res, statusCode, text, headers = {}) {
  res.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
    ...headers,
  });
  res.end(text);
}

export function setSecurityHeaders(res) {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("x-frame-options", "DENY");
}

/** The Hub is loopback-only by contract; reject DNS-rebinding-style hosts. */
export function isAllowedHostHeader(hostHeader, port) {
  if (typeof hostHeader !== "string" || !hostHeader) return false;
  const allowed = new Set([
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    `[::1]:${port}`,
  ]);
  return allowed.has(hostHeader.trim().toLowerCase());
}

/**
 * POSTs from a browser must be same-origin (or have no Origin at all, e.g. curl).
 * This blocks a random website from starting/stopping local apps.
 */
export function isAllowedOriginHeader(origin, port) {
  if (origin === undefined) return true;
  if (!origin || origin === "null") return false;
  try {
    const url = new URL(origin);
    const host = url.hostname;
    const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
    const effectivePort = url.port ? Number.parseInt(url.port, 10) : url.protocol === "https:" ? 443 : 80;
    return loopback && effectivePort === port;
  } catch {
    return false;
  }
}
