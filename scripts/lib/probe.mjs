/**
 * Readiness probes and the BandReady launch-file reader.
 *
 * `/health` is the only unauthenticated BandReady route, so readiness uses it.
 * The launch secret from web.json is never returned by anything that logs or is
 * persisted: only `buildBandReadyLaunchUrl` uses it, for the Hub's redirect route.
 */

import fs from "node:fs";
import http from "node:http";
import https from "node:https";

const DEFAULT_TIMEOUT_MS = 3_000;

/**
 * One HTTP GET. Redirects are not followed: a readiness probe must answer itself.
 *
 * @returns {Promise<{ok:boolean, statusCode:number|null, error:string|null, ms:number}>}
 */
export function requestUrl(url, { timeoutMs = DEFAULT_TIMEOUT_MS, method = "GET", headers = {} } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      resolve({ ok: false, statusCode: null, error: `invalid URL: ${url}`, ms: 0 });
      return;
    }
    const transport = parsed.protocol === "https:" ? https : http;
    let settled = false;
    let timer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ ...result, ms: Date.now() - started });
    };

    let request;
    try {
      request = transport.request(
        parsed,
        { method, headers: { accept: "text/html,application/json;q=0.9,*/*;q=0.8", ...headers } },
        (response) => {
          response.resume(); // drain and discard the body
          finish({ ok: response.statusCode === 200, statusCode: response.statusCode ?? null, error: null });
        },
      );
    } catch (error) {
      finish({ ok: false, statusCode: null, error: error instanceof Error ? error.message : String(error), ms: 0 });
      return;
    }

    timer = setTimeout(() => {
      request.destroy(new Error(`timeout after ${timeoutMs} ms`));
    }, timeoutMs);
    timer.unref?.();

    request.once("error", (error) => {
      finish({ ok: false, statusCode: null, error: error instanceof Error ? error.message : String(error) });
    });
    request.end();
  });
}

/** Readiness probe for an app URL + path (`/` for ISTS, `/health` for BandReady). */
export function probeModule(port, pathname = "/", { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return requestUrl(`http://127.0.0.1:${port}${pathname}`, { timeoutMs });
}

/**
 * Poll `check` until it reports ok or the deadline passes.
 * `check` is injectable so tests never need a socket or a real clock.
 *
 * @returns {Promise<{ok:boolean, attempts:number, waitedMs:number, last:any}>}
 */
export async function waitFor(check, {
  timeoutMs = 60_000,
  intervalMs = 500,
  sleep = defaultSleep,
  now = Date.now,
  signal = null,
} = {}) {
  const started = now();
  let attempts = 0;
  let last = null;

  while (true) {
    if (signal?.aborted) return { ok: false, attempts, waitedMs: now() - started, last: { ok: false, error: "aborted" } };
    attempts += 1;
    try {
      last = await check();
    } catch (error) {
      last = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    if (last && last.ok) {
      return { ok: true, attempts, waitedMs: now() - started, last };
    }
    const elapsed = now() - started;
    if (elapsed >= timeoutMs) {
      return { ok: false, attempts, waitedMs: elapsed, last };
    }
    await sleep(Math.min(intervalMs, Math.max(0, timeoutMs - elapsed)));
  }
}

function defaultSleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Read %APPDATA%\BandReady\web.json.
 * @returns {Promise<{ok:true, port:number, launch:string}|{ok:false, port:null, launch:null, error:string}>}
 */
export async function readBandReadyLaunchFile(file, { readFile = fs.promises.readFile } = {}) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    const code = error && typeof error.code === "string" ? error.code : null;
    return {
      ok: false,
      port: null,
      launch: null,
      error: code === "ENOENT" ? `BandReady launch file not found: ${file}` : `cannot read ${file}: ${error.message}`,
    };
  }
  let value;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    return { ok: false, port: null, launch: null, error: `${file} is not valid JSON` };
  }
  const port = value && typeof value === "object" ? value.port : null;
  const launch = value && typeof value === "object" ? value.launch : null;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return { ok: false, port: null, launch: null, error: `${file} has no valid port` };
  }
  if (typeof launch !== "string" || launch.length === 0) {
    return { ok: false, port: null, launch: null, error: `${file} has no launch secret` };
  }
  return { ok: true, port, launch };
}

/** Safe summary of web.json for logs (never the secret). */
export function describeLaunchFile(state) {
  if (!state || state.ok !== true) return `BandReady launch state unavailable: ${state?.error ?? "unknown error"}`;
  return `BandReady launch state: port ${state.port}, launch token present`;
}

/** `http://127.0.0.1:<port>/?launch=<encoded secret>` — only for the redirect route. */
export function buildBandReadyLaunchUrl(port, launch) {
  return `http://127.0.0.1:${port}/?launch=${encodeURIComponent(launch)}`;
}

/** Strip credentials/tokens from a URL before logging it. */
export function redactUrl(value) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (/^(launch|token|secret|key|api_key|password|auth)$/i.test(key)) url.searchParams.set(key, "[redacted]");
    }
    if (url.username || url.password) {
      url.username = "";
      url.password = "";
    }
    return url.toString();
  } catch {
    return String(value).replace(/([?&](?:launch|token|secret|key|api_key|password)=)[^&#\s]*/gi, "$1[redacted]");
  }
}
