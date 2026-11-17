import { formatStartedAt } from "../lib/format";
import { describeStatus } from "../lib/status";
import type {
  ModuleId,
  ModuleState,
  ModuleStatus,
} from "../services/api";
import { StatusPill } from "./StatusPill";

export type ModuleAction = "start" | "stop";

interface ModuleCardProps {
  id: ModuleId;
  name: string;
  code: string;
  tagline: string;
  description: string;
  features: readonly string[];
  module: ModuleState | undefined;
  isOnline: boolean;
  pendingAction: ModuleAction | null;
  onStart: () => void;
  onStop: () => void;
}

function disabledStartReason(
  isOnline: boolean,
  status: ModuleStatus,
  busy: boolean,
): string | null {
  if (!isOnline) return "The Hub API is offline.";
  if (busy) return "Waiting for the current change to finish.";
  if (status === "running") return "Already running.";
  if (status === "not-installed") return "Install this module before starting it.";
  if (status === "not-ready") return "Finish setup for this module first.";
  if (status === "unknown") return "Waiting for a status from the Hub.";
  return null;
}

export function ModuleCard({
  id,
  name,
  code,
  tagline,
  description,
  features,
  module,
  isOnline,
  pendingAction,
  onStart,
  onStop,
}: ModuleCardProps) {
  const status: ModuleStatus = module?.status ?? "unknown";
  const statusInfo = describeStatus(status);
  const busy =
    pendingAction !== null ||
    status === "starting" ||
    status === "stopping";

  const canStart =
    isOnline && !busy && (status === "stopped" || status === "error");
  const canStop = isOnline && !busy && status === "running";
  const canOpen = status === "running" && Boolean(module?.url);

  const startReason = canStart
    ? null
    : disabledStartReason(isOnline, status, busy);
  const stopReason = canStop
    ? null
    : !isOnline
      ? "The Hub API is offline."
      : busy
        ? "Waiting for the current change to finish."
        : "The module is not running.";

  const startedLabel = formatStartedAt(module?.startedAt ?? null);
  const portLabel =
    module?.port != null ? `Port ${module.port}` : "Port not assigned";

  const startLabel = pendingAction === "start" ? "Starting…" : "Start";
  const stopLabel = pendingAction === "stop" ? "Stopping…" : "Stop";

  return (
    <article
      className="module-card"
      data-module={id}
      aria-busy={busy || undefined}
    >
      <div className="module-card-top">
        <div className="module-identity">
          <span className="module-mark" aria-hidden="true">
            {code}
          </span>
          <div>
            <h3>{name}</h3>
            <p className="module-tagline">{tagline}</p>
          </div>
        </div>
        <StatusPill status={status} />
      </div>

      <p className="module-description">{description}</p>

      <ul className="feature-chips" aria-label={`${name} features`}>
        {features.map((feature) => (
          <li key={feature} className="chip">
            {feature}
          </li>
        ))}
      </ul>

      <div className="module-live">
        <p className="module-status-copy">{statusInfo.description}</p>
        <div className="module-meta">
          <span>{portLabel}</span>
          <span aria-hidden="true" className="meta-separator">
            ·
          </span>
          <span>{startedLabel ?? "Not started"}</span>
        </div>
      </div>

      {module?.error ? (
        <p className="module-error">
          <span aria-hidden="true">Hub note:</span> {module.error}
        </p>
      ) : null}

      <div className="module-actions">
        {canOpen && module?.url ? (
          <a
            className="button button--primary"
            href={module.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open <span aria-hidden="true">↗</span>
          </a>
        ) : (
          <span
            className="button button--primary button--disabled"
            aria-disabled="true"
            title={
              status === "running"
                ? "The Hub has not reported a URL yet."
                : "Available once the module is running."
            }
          >
            Open <span aria-hidden="true">↗</span>
          </span>
        )}

        <div className="module-lifecycle">
          <button
            type="button"
            className="button button--secondary"
            onClick={onStart}
            disabled={!canStart}
            title={startReason ?? undefined}
          >
            {startLabel}
          </button>
          <button
            type="button"
            className="button button--quiet"
            onClick={onStop}
            disabled={!canStop}
            title={stopReason ?? undefined}
          >
            {stopLabel}
          </button>
        </div>
      </div>
    </article>
  );
}
