/**
 * Hub HTTP server: loopback-only API + portal static hosting.
 *
 * The server object is returned unlistened so tests and dev.mjs can decide when to
 * bind. `startHubServer` binds 127.0.0.1 only.
 */

import http from "node:http";

import { createApiRouter } from "./routes/api.mjs";
import { createStaticHandler } from "./routes/static.mjs";
import { isAllowedHostHeader, setSecurityHeaders } from "./http.mjs";

export function createHubServer({ manager, config, logger = console }) {
  const apiRoute = createApiRouter({ manager, config, logger });
  const serveStatic = createStaticHandler({
    distDir: config.paths.portalDist,
    indexFile: config.paths.portalIndex,
    placeholderFile: config.paths.placeholderFile,
  });

  const server = http.createServer(async (req, res) => {
    setSecurityHeaders(res);
    try {
      if (!isAllowedHostHeader(req.headers.host, config.hub.port)) {
        res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "forbidden host header" }));
        return;
      }
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/api" || url.pathname.startsWith("/api/") || url.pathname.startsWith("/open/")) {
        await apiRoute(req, res, url);
        return;
      }
      serveStatic(req, res, url);
    } catch (error) {
      logger.error?.(`request failed: ${error instanceof Error ? error.message : String(error)}`);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "internal error" }));
      } else {
        res.destroy();
      }
    }
  });

  server.on("clientError", (_error, socket) => {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });

  return server;
}

/** Bind the Hub on 127.0.0.1. Rejects with an actionable EADDRINUSE message. */
export function startHubServer({ manager, config, logger = console }) {
  const server = createHubServer({ manager, config, logger });
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.removeListener("listening", onListening);
      if (error && error.code === "EADDRINUSE") {
        reject(
          new Error(
            `Port ${config.hub.port} is already in use. Stop the other process or start with HUB_PORT=<port> node scripts/dev.mjs`,
          ),
        );
        return;
      }
      reject(error);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve(server);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ host: config.hub.host, port: config.hub.port, exclusive: true });
  });
}
