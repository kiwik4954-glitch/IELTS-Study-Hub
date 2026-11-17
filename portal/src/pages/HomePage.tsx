import { useState } from "react";
import { Link } from "react-router-dom";

import { ModuleCard, type ModuleAction } from "../components/ModuleCard";
import {
  ApiOfflineNotice,
  SectionHeading,
} from "../components/Notices";
import { MODULES } from "../data/modules";
import { useHubState } from "../hooks/useHubState";
import { formatTime } from "../lib/format";
import {
  describeApiError,
  startModule,
  stopModule,
  type ModuleId,
} from "../services/api";

type PendingActions = Partial<Record<ModuleId, ModuleAction>>;

export function HomePage() {
  const {
    state,
    error,
    isInitialLoading,
    isChecking,
    lastCheckedAt,
    refresh,
  } = useHubState();

  const [pending, setPending] = useState<PendingActions>({});
  const [actionError, setActionError] = useState<string | null>(null);

  const runAction = async (id: ModuleId, action: ModuleAction) => {
    setActionError(null);
    setPending((current) => ({ ...current, [id]: action }));

    try {
      if (action === "start") await startModule(id);
      else await stopModule(id);
      // The Hub answers 202 before the app is healthy; re-read state so the
      // card can show "starting" instead of guessing.
      await refresh();
    } catch (caught) {
      setActionError(describeApiError(caught));
    } finally {
      setPending((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    }
  };

  const hubTone = error ? "offline" : state ? "online" : "checking";
  const hubLabel = error ? "Offline" : state ? "Online" : "Checking…";

  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow">Local study console</p>
          <h1 id="hero-title">
            Two focused apps.
            <span className="hero-line">One calm starting point.</span>
          </h1>
          <p className="lede">
            IELTS Study Hub starts ISTS or BandReady when you ask, shows what is
            actually running, and opens each app in its own tab. Everything stays
            on this computer.
          </p>
          <div className="hero-actions">
            <a className="button button--primary" href="#modules">
              Choose a module
            </a>
            <Link className="button button--secondary" to="/help">
              Diagnostics &amp; help
            </Link>
          </div>
        </div>

        <aside className="hub-panel" aria-label="Hub API status">
          <div className="hub-panel-head">
            <p className="eyebrow eyebrow--light">Hub API</p>
            <span
              className={`hub-indicator hub-indicator--${hubTone}`}
              role="status"
              aria-live="polite"
            >
              <span className="status-dot" aria-hidden="true" />
              {hubLabel}
            </span>
          </div>

          <p className="hub-panel-title">
            {error
              ? "The portal cannot read module state."
              : state
                ? "Connected on loopback."
                : "Checking the local Hub…"}
          </p>

          <dl className="hub-facts">
            <div>
              <dt>Hub version</dt>
              <dd>{state?.hub.version ?? "—"}</dd>
            </div>
            <div>
              <dt>Port</dt>
              <dd>{state?.hub.port ?? "—"}</dd>
            </div>
            <div>
              <dt>Last check</dt>
              <dd>{formatTime(lastCheckedAt)}</dd>
            </div>
          </dl>

          <p className="hub-panel-note">
            Status is polled every 5 seconds. Ports and URLs are read from the
            Hub, never hard-coded here.
          </p>
        </aside>
      </section>

      {error ? (
        <ApiOfflineNotice
          message={error}
          onRetry={() => void refresh()}
          isChecking={isChecking}
        />
      ) : null}

      <section className="section" id="modules" aria-labelledby="modules-title">
        <SectionHeading
          eyebrow="Modules"
          title="Your workspace"
          id="modules-title"
          description="Live status from the Hub API. Open launches the real app in a new tab."
          actions={
            <button
              type="button"
              className={`button button--small button--secondary refresh-button${
                isChecking ? " is-checking" : ""
              }`}
              onClick={() => void refresh()}
              disabled={isChecking}
            >
              <span className="refresh-icon" aria-hidden="true">
                ↻
              </span>
              {isChecking ? "Checking…" : "Refresh status"}
            </button>
          }
        />

        <div className="module-grid">
          {MODULES.map((module) => (
            <ModuleCard
              key={module.id}
              id={module.id}
              name={module.name}
              code={module.code}
              tagline={module.tagline}
              description={module.description}
              features={module.features}
              module={state?.modules[module.id]}
              isOnline={Boolean(state) && !error}
              pendingAction={pending[module.id] ?? null}
              onStart={() => void runAction(module.id, "start")}
              onStop={() => void runAction(module.id, "stop")}
            />
          ))}
        </div>

        {isInitialLoading ? (
          <p className="inline-hint" role="status">
            Asking the Hub for the first status snapshot…
          </p>
        ) : null}

        {actionError ? (
          <div className="notice notice--error" role="alert">
            <span className="notice-icon" aria-hidden="true">
              !
            </span>
            <div className="notice-body">
              <strong>The Hub did not accept that request.</strong>
              <p>{actionError}</p>
            </div>
            <button
              type="button"
              className="button button--small button--secondary"
              onClick={() => void refresh()}
            >
              Refresh status
            </button>
          </div>
        ) : null}
      </section>

      <aside className="diagnostics-strip" aria-labelledby="diagnostics-title">
        <div>
          <h2 id="diagnostics-title">Something not starting?</h2>
          <p>
            Check the environment, read the Hub logs, or start a module manually
            from a terminal.
          </p>
        </div>
        <Link className="button button--secondary" to="/help">
          Environment &amp; diagnostics
        </Link>
      </aside>

      <section className="section" aria-labelledby="today-title">
        <SectionHeading
          eyebrow="Overview"
          title="Today"
          id="today-title"
          description="A single view of study activity — only when a verified source exists."
          actions={<span className="badge">No data source connected</span>}
        />

        <div className="today-panel">
          <div className="today-empty">
            <div className="today-orbit" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div>
              <h3>No study activity to show yet</h3>
              <p>
                Unified statistics are not enabled in this phase. The portal will
                not invent minutes, streaks or scores, and it never reads the
                apps&apos; databases directly.
              </p>
              <p className="today-hint">
                Start a module and study inside it. This area remains an honest
                empty state until read-only data access is verified.
              </p>
            </div>
          </div>

          <div className="today-next">
            <p className="eyebrow">Planned for this space</p>
            <ul>
              <li>Time studied in each app</li>
              <li>Cards reviewed and drills completed</li>
              <li>Writing and speaking feedback summaries</li>
            </ul>
            <p className="today-note">
              Scope only — no figures appear until the Hub owns a verified,
              read-only source.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
