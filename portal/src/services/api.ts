/**
 * Typed client for the Hub API.
 *
 * The portal talks to the Hub process and nothing else. In development Vite
 * proxies `/api` to http://127.0.0.1:8780; in production the Hub serves this
 * bundle itself, so the same relative paths work.
 */

export const API_BASE = "/api";
export const REQUEST_TIMEOUT_MS = 4_000;

export const MODULE_IDS = ["ists", "bandready"] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

/**
 * The contract lists `not-installed | not-ready | starting | running | stopped |
 * error`. `stopping` is accepted because the stop endpoint can answer with it,
 * and `unknown` is a portal-only state used before the first successful poll.
 */
export type ModuleStatus =
  | "not-installed"
  | "not-ready"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "error"
  | "unknown";

export interface HubInfo {
  version: string;
  port: number;
}

export interface ModuleState {
  status: ModuleStatus;
  port: number | null;
  url: string | null;
  startedAt: string | null;
  error: string | null;
}

export interface HubState {
  hub: HubInfo;
  modules: Record<string, ModuleState>;
}

export type ApiErrorKind = "offline" | "http" | "contract";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;

  constructor(message: string, kind: ApiErrorKind, status?: number) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
  }
}

export function describeApiError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return "Unexpected error while talking to the Hub API.";
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const KNOWN_STATUSES: ReadonlySet<string> = new Set<ModuleStatus>([
  "not-installed",
  "not-ready",
  "starting",
  "running",
  "stopping",
  "stopped",
  "error",
]);

function normalizeStatus(value: unknown): ModuleStatus {
  return typeof value === "string" && KNOWN_STATUSES.has(value)
    ? (value as ModuleStatus)
    : "unknown";
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseModule(value: unknown, id: string): ModuleState {
  if (!isObject(value)) {
    throw new ApiError(
      `The Hub API returned an invalid entry for module "${id}".`,
      "contract",
    );
  }

  return {
    status: normalizeStatus(value.status),
    port: numberOrNull(value.port),
    url: stringOrNull(value.url),
    startedAt: stringOrNull(value.startedAt),
    error: stringOrNull(value.error),
  };
}

/** Validate at the boundary so a malformed response becomes a readable error. */
export function parseHubState(value: unknown): HubState {
  if (!isObject(value) || !isObject(value.hub) || !isObject(value.modules)) {
    throw new ApiError(
      "The Hub API returned an unexpected response shape.",
      "contract",
    );
  }

  const version = value.hub.version;
  const port = value.hub.port;
  if (typeof version !== "string" || typeof port !== "number") {
    throw new ApiError(
      "The Hub API did not report its version and port.",
      "contract",
    );
  }

  const modules: Record<string, ModuleState> = {};
  for (const [id, moduleValue] of Object.entries(value.modules)) {
    modules[id] = parseModule(moduleValue, id);
  }

  return {
    hub: { version, port },
    modules,
  };
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  externalSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS,
  );

  const forwardAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", forwardAbort, { once: true });
  }

  try {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        ...init,
        cache: "no-store",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          ...init.headers,
        },
      });
    } catch (error) {
      // The caller aborted (unmount / newer poll): let it handle that quietly.
      if (externalSignal?.aborted) throw error;
      if (controller.signal.aborted) {
        throw new ApiError(
          "The Hub API did not answer within 4 seconds. It may be starting or stuck.",
          "offline",
        );
      }
      throw new ApiError(
        "Could not reach the Hub API. Make sure the Hub process is running.",
        "offline",
      );
    }

    if (!response.ok) {
      // A dev proxy answers 500/502/503/504 when the Hub itself is not up.
      const isGatewayFailure = response.status >= 500;
      throw new ApiError(
        isGatewayFailure
          ? `The Hub API is not reachable right now (HTTP ${response.status}). Start the Hub, then retry.`
          : `The Hub API answered with HTTP ${response.status}.`,
        isGatewayFailure ? "offline" : "http",
        response.status,
      );
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new ApiError(
        "The Hub API returned a response that was not valid JSON.",
        "contract",
      );
    }
  } finally {
    globalThis.clearTimeout(timeoutId);
    externalSignal?.removeEventListener("abort", forwardAbort);
  }
}

export async function getHubState(signal?: AbortSignal): Promise<HubState> {
  const payload = await request<unknown>("/state", {}, signal);
  return parseHubState(payload);
}

async function postLifecycle(
  id: ModuleId,
  action: "start" | "stop",
): Promise<{ status?: string }> {
  return request<{ status?: string }>(
    `/modules/${encodeURIComponent(id)}/${action}`,
    { method: "POST" },
  );
}

export function startModule(id: ModuleId): Promise<{ status?: string }> {
  return postLifecycle(id, "start");
}

export function stopModule(id: ModuleId): Promise<{ status?: string }> {
  return postLifecycle(id, "stop");
}
