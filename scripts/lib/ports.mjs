/**
 * Loopback port helpers.
 *
 * Availability is decided by an actual bind attempt (never by parsing netstat), so
 * the answer matches what `next start` / the BandReady sidecar will experience.
 * Ports are only ever probed for availability here — nothing is ever killed by port.
 */

import net from "node:net";

const DEFAULT_HOST = "127.0.0.1";

/**
 * Attempt to bind `port` on `host`.
 * @returns {Promise<{ available: boolean, code: string|null, error: string|null }>}
 */
export function checkPortAvailable(port, { host = DEFAULT_HOST, timeoutMs = 2_000 } = {}) {
  return new Promise((resolve) => {
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      resolve({ available: false, code: "EINVAL", error: `invalid port ${port}` });
      return;
    }

    const server = net.createServer();
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        server.close();
      } catch {
        /* already closed */
      }
      resolve(result);
    };
    const timer = setTimeout(() => {
      finish({ available: false, code: "ETIMEDOUT", error: `timed out binding ${host}:${port}` });
    }, timeoutMs);
    timer.unref?.();

    server.once("error", (error) => {
      const code = error && typeof error.code === "string" ? error.code : null;
      finish({ available: false, code, error: error instanceof Error ? error.message : String(error) });
    });
    server.once("listening", () => {
      finish({ available: true, code: null, error: null });
    });
    server.listen({ port, host, exclusive: true });
  });
}

/**
 * Check several ports at once.
 * @param {Array<number|{port:number,label?:string}>} ports
 * @returns {Promise<Array<{port:number,label:string,available:boolean,code:string|null,error:string|null}>>}
 */
export async function checkPorts(ports, { host = DEFAULT_HOST } = {}) {
  const entries = ports.map((entry) =>
    typeof entry === "number" ? { port: entry, label: `port ${entry}` } : entry,
  );
  return Promise.all(
    entries.map(async (entry) => {
      const result = await checkPortAvailable(entry.port, { host });
      return { ...entry, ...result };
    }),
  );
}

/** Ask the OS for an unused loopback port. */
export function findFreePort({ host = DEFAULT_HOST } = {}) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen({ port: 0, host }, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => {
        if (Number.isInteger(port)) resolve(port);
        else reject(new Error("could not determine a free port"));
      });
    });
  });
}

/** Human-readable remediation for an occupied port. */
export function portBusyHint(port, { pid = null, envVar = null } = {}) {
  const owner = pid ? ` (pid ${pid})` : "";
  const alternative = envVar ? ` or start the Hub with a different ${envVar}` : "";
  return `Port ${port} is already in use${owner}. Close that process${alternative}.`;
}
