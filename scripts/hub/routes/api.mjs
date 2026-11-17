/**
 * Hub API routes.
 *
 *   GET  /api/health             liveness of the Hub itself
 *   GET  /api/state              portal contract (hub + module statuses)
 *   POST /api/modules/:id/start  202 { status: "starting" }
 *   POST /api/modules/:id/stop   202 { status: "stopping" }
 *   GET  /open/:id               302 to the app; BandReady's redirect carries the
 *                                launch secret, which never enters state.json/logs
 */

import { MODULE_IDS } from "../../lib/config.mjs";
import { isAllowedOriginHeader, sendJson, sendText, setSecurityHeaders } from "../http.mjs";

function methodNotAllowed(res, allowed) {
  sendJson(res, 405, { error: "method not allowed" }, { allow: allowed.join(", ") });
}

export function createApiRouter({ manager, config, logger = console }) {
  return async function routeApi(req, res, url) {
    const pathname = url.pathname;

    if (pathname === "/api/health") {
      if (req.method !== "GET" && req.method !== "HEAD") return methodNotAllowed(res, ["GET"]);
      return sendJson(res, 200, {
        ok: true,
        status: "ok",
        version: config.version,
        port: config.hub.port,
        uptimeSeconds: Math.round(process.uptime()),
      });
    }

    if (pathname === "/api/state") {
      if (req.method !== "GET" && req.method !== "HEAD") return methodNotAllowed(res, ["GET"]);
      return sendJson(res, 200, manager.getState());
    }

    const moduleRoute = pathname.match(/^\/api\/modules\/([^/]+)\/(start|stop)$/);
    if (moduleRoute) {
      if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
      if (!isAllowedOriginHeader(req.headers.origin, config.hub.port)) {
        return sendJson(res, 403, { error: "cross-origin requests are not allowed" });
      }
      const [, id, action] = moduleRoute;
      if (!MODULE_IDS.includes(id)) return sendJson(res, 404, { error: `unknown module: ${id}` });

      if (action === "start") {
        const gate = manager.canStart(id);
        if (!gate.ok) {
          return sendJson(res, 409, { status: manager.getState().modules[id]?.status ?? null, error: gate.error });
        }
        sendJson(res, 202, { status: "starting" });
        manager.startModule(id).catch((error) => {
          logger.error?.(`start ${id} failed: ${error instanceof Error ? error.message : String(error)}`);
        });
        return undefined;
      }

      const current = manager.getState().modules[id];
      if (!current) return sendJson(res, 404, { error: `unknown module: ${id}` });
      if (current.external) {
        return sendJson(res, 409, {
          status: current.status,
          error: `${id} was started outside the Hub; close it from its own window`,
        });
      }
      if (!["running", "starting", "error"].includes(current.status)) {
        return sendJson(res, 409, { status: current.status, error: `${id} is not running` });
      }
      sendJson(res, 202, { status: "stopping" });
      manager.stopModule(id).catch((error) => {
        logger.error?.(`stop ${id} failed: ${error instanceof Error ? error.message : String(error)}`);
      });
      return undefined;
    }

    const openRoute = pathname.match(/^\/open\/([^/]+)$/);
    if (openRoute) {
      if (req.method !== "GET" && req.method !== "HEAD") return methodNotAllowed(res, ["GET"]);
      const result = await manager.resolveOpenUrl(openRoute[1]);
      if (!result.ok) {
        return sendJson(res, result.status, { status: result.moduleStatus ?? null, error: result.error });
      }
      // The Location header may contain BandReady's launch secret: never cached,
      // never logged, never sent as a referrer.
      res.writeHead(302, {
        location: result.url,
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "content-length": "0",
      });
      res.end();
      return undefined;
    }

    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return sendJson(res, 404, { error: `no such endpoint: ${pathname}` });
    }

    setSecurityHeaders(res);
    return sendText(res, 404, "not found\n");
  };
}
