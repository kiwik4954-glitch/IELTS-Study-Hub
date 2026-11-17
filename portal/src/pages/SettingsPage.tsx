import { Link } from "react-router-dom";

import {
  ApiOfflineNotice,
  LoadingPanel,
} from "../components/Notices";
import { StatusPill } from "../components/StatusPill";
import { MODULES } from "../data/modules";
import { useHubState } from "../hooks/useHubState";
import { formatStartedAt, formatTime } from "../lib/format";

export function SettingsPage() {
  const {
    state,
    error,
    isInitialLoading,
    isChecking,
    lastCheckedAt,
    refresh,
  } = useHubState();

  return (
    <>
      <header className="page-header">
        <p className="eyebrow">Settings</p>
        <h1>Configuration, read-only</h1>
        <p className="page-lede">
          Everything on this page is reported by the Hub. The portal never writes
          configuration, never reads an app database, and never asks for an API
          key.
        </p>
      </header>

      <div className="notice notice--info" role="note">
        <span className="notice-icon" aria-hidden="true">
          i
        </span>
        <div className="notice-body">
          <strong>Read-only in this phase.</strong>
          <p>
            The Hub process owns ports, paths and launch settings. Editing them
            from the browser is intentionally not implemented; a clearly marked
            placeholder at the bottom of this page shows where that will live.
          </p>
        </div>
        <Link className="button button--small button--secondary" to="/help">
          Troubleshooting
        </Link>
      </div>

      {error ? (
        <ApiOfflineNotice
          message={error}
          onRetry={() => void refresh()}
          isChecking={isChecking}
        />
      ) : null}

      {isInitialLoading ? (
        <LoadingPanel label="Reading the current Hub state…" />
      ) : null}

      <section className="panel" aria-labelledby="connection-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Connection</p>
            <h2 id="connection-title">Hub API</h2>
          </div>
          <span className="muted-small">
            Last check: {formatTime(lastCheckedAt)}
          </span>
        </div>

        <dl className="fact-grid">
          <div className="fact">
            <dt>Status</dt>
            <dd>
              {error ? (
                <span className="inline-status inline-status--offline">
                  Offline
                </span>
              ) : state ? (
                <span className="inline-status inline-status--online">
                  Online
                </span>
              ) : (
                <span className="muted-value">Checking…</span>
              )}
            </dd>
          </div>
          <div className="fact">
            <dt>Hub version</dt>
            <dd>{state?.hub.version ?? "—"}</dd>
          </div>
          <div className="fact">
            <dt>Hub port</dt>
            <dd>{state?.hub.port ?? "—"}</dd>
          </div>
          <div className="fact">
            <dt>API base</dt>
            <dd>
              <code>/api</code>
            </dd>
          </div>
          <div className="fact">
            <dt>State source</dt>
            <dd>
              <code>GET /api/state</code>
            </dd>
          </div>
          <div className="fact">
            <dt>Poll interval</dt>
            <dd>5 seconds</dd>
          </div>
        </dl>
      </section>

      <section className="panel" aria-labelledby="modules-settings-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Modules</p>
            <h2 id="modules-settings-title">Ports &amp; endpoints</h2>
          </div>
          <span className="muted-small">
            Values come only from <code>/api/state</code>
          </span>
        </div>

        <div className="table-wrap">
          <table className="settings-table">
            <thead>
              <tr>
                <th scope="col">Module</th>
                <th scope="col">Status</th>
                <th scope="col">Port</th>
                <th scope="col">Local URL</th>
                <th scope="col">Started</th>
              </tr>
            </thead>
            <tbody>
              {MODULES.map((module) => {
                const moduleState = state?.modules[module.id];
                return (
                  <tr key={module.id}>
                    <th scope="row">
                      <span className="table-module-name">{module.name}</span>
                      <code className="table-module-id">{module.id}</code>
                    </th>
                    <td>
                      <StatusPill
                        status={moduleState?.status ?? "unknown"}
                        compact
                      />
                    </td>
                    <td>{moduleState?.port ?? "—"}</td>
                    <td>
                      {moduleState?.url ? (
                        <code className="url-cell">{moduleState.url}</code>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {formatStartedAt(moduleState?.startedAt ?? null) ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="table-hint">
          Scroll sideways to see the full local URL and start time.
        </p>

        <p className="panel-footnote">
          A port is shown only after the Hub assigns one. BandReady may pick a
          free port instead of its usual default; the Hub reports the real value
          and this page follows it.
        </p>
      </section>

      <section className="panel" aria-labelledby="paths-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Storage</p>
            <h2 id="paths-title">Data &amp; log locations</h2>
          </div>
          <span className="badge">Reference only</span>
        </div>

        <p className="panel-copy">
          The current <code>/api/state</code> contract does not expose filesystem
          paths, so this page cannot live-render them. The locations below are
          stable references from the architecture docs. The portal never opens,
          lists or edits these folders.
        </p>

        <dl className="path-list">
          <div>
            <dt>Hub state file</dt>
            <dd>
              <code>%APPDATA%\IELTS-Study-Hub\hub\state.json</code>
            </dd>
          </div>
          <div>
            <dt>Hub logs</dt>
            <dd>
              <code>%APPDATA%\IELTS-Study-Hub\hub\logs\</code>
            </dd>
          </div>
          <div>
            <dt>ISTS data</dt>
            <dd>
              <code>%APPDATA%\IELTS-Study-Hub\ists\</code>
            </dd>
          </div>
          <div>
            <dt>BandReady data</dt>
            <dd>
              <code>%APPDATA%\BandReady\</code>
            </dd>
          </div>
        </dl>
      </section>

      <section
        className="panel placeholder-card"
        aria-labelledby="config-placeholder-title"
      >
        <div className="placeholder-head">
          <p className="eyebrow">Placeholder</p>
          <span className="badge badge--accent">Not implemented</span>
        </div>
        <h2 id="config-placeholder-title">Configuration editor</h2>
        <p>
          A future release will let you change launch preferences here — for
          example default ports, whether the Hub opens the browser on start, and
          where each app keeps its data. It will still write through the Hub, not
          directly from the browser.
        </p>
        <ul className="placeholder-list">
          <li>Default ports and port-conflict handling</li>
          <li>Launch at login and auto-start preferences</li>
          <li>Log verbosity and retention</li>
        </ul>
        <p className="placeholder-foot">
          Until then, edit the Hub&apos;s configuration on disk and restart the
          Hub. This page will reflect the new values on its next poll.
        </p>
      </section>
    </>
  );
}
