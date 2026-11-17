import type { ReactNode } from "react";

import { useHubState } from "../hooks/useHubState";
import { formatTime } from "../lib/format";

interface CommandBlockProps {
  label: string;
  note?: string;
  children: ReactNode;
}

function CommandBlock({ label, note, children }: CommandBlockProps) {
  return (
    <div className="command-block">
      <div className="command-label">{label}</div>
      <pre>
        <code>{children}</code>
      </pre>
      {note ? <p className="command-note">{note}</p> : null}
    </div>
  );
}

interface SymptomProps {
  title: string;
  children: ReactNode;
}

function Symptom({ title, children }: SymptomProps) {
  return (
    <details className="symptom">
      <summary>
        <span>{title}</span>
        <span className="symptom-chevron" aria-hidden="true">
          +
        </span>
      </summary>
      <div className="symptom-body">{children}</div>
    </details>
  );
}

const DOC_LINKS = [
  {
    path: "docs/ARCHITECTURE.md",
    description:
      "Lifecycle, ports, probes, process rules and why there are no iframes.",
  },
  {
    path: "docs/TROUBLESHOOTING.md",
    description: "The full troubleshooting reference for the Hub and both apps.",
  },
  {
    path: "docs/INSTALLATION.md",
    description: "Prerequisites and first-time setup for Windows.",
  },
  {
    path: "docs/DEVELOPMENT.md",
    description: "How to run the portal, the Hub and each app manually.",
  },
  {
    path: "docs/PRIVACY.md",
    description: "What stays on this computer and what the Hub never uploads.",
  },
  {
    path: "portal/README.md",
    description: "This portal's API contract, design rules and commands.",
  },
];

export function HelpPage() {
  const {
    state,
    error,
    isInitialLoading,
    isChecking,
    lastCheckedAt,
    refresh,
  } = useHubState();

  const statusLabel = error
    ? "Offline"
    : state
      ? "Online"
      : isInitialLoading
        ? "Checking…"
        : "Waiting…";
  const statusTone = error ? "offline" : state ? "online" : "checking";

  return (
    <>
      <header className="page-header">
        <p className="eyebrow">Help</p>
        <h1>Diagnostics &amp; troubleshooting</h1>
        <p className="page-lede">
          Most problems are one of three things: the Hub is not running, a module
          has not finished setup, or a first start is still doing real work. Work
          through the checks in order before changing anything.
        </p>
      </header>

      <section className="panel diagnostics-panel" aria-labelledby="diag-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Live diagnostic</p>
            <h2 id="diag-title">Hub API connection</h2>
          </div>
          <span className={`diagnostic-badge diagnostic-badge--${statusTone}`}>
            <span className="status-dot" aria-hidden="true" />
            {statusLabel}
          </span>
        </div>

        <p className="diagnostic-copy">
          {error
            ? error
            : state
              ? `Hub v${state.hub.version} is answering on 127.0.0.1:${state.hub.port}. Module state is readable.`
              : "Waiting for the first response from the Hub API…"}
        </p>

        <dl className="diagnostic-facts">
          <div>
            <dt>Expected endpoint</dt>
            <dd>
              <code>
                {state
                  ? `http://127.0.0.1:${state.hub.port}/api`
                  : "http://127.0.0.1:8780/api (default)"}
              </code>
            </dd>
          </div>
          <div>
            <dt>Last check</dt>
            <dd>{formatTime(lastCheckedAt)}</dd>
          </div>
          <div>
            <dt>Poll interval</dt>
            <dd>5 seconds</dd>
          </div>
        </dl>

        <button
          type="button"
          className="button button--secondary"
          onClick={() => void refresh()}
          disabled={isChecking}
        >
          {isChecking ? "Checking…" : "Re-check connection"}
        </button>
      </section>

      <section className="section" aria-labelledby="checks-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Start here</p>
            <h2 id="checks-title">Three quick checks</h2>
          </div>
        </div>

        <ol className="check-list">
          <li>
            <span className="check-number" aria-hidden="true">
              1
            </span>
            <div>
              <h3>Is the Hub process running?</h3>
              <p>
                The portal is only a front end. Without the Hub,{" "}
                <code>GET /api/state</code> cannot answer and the page shows
                &ldquo;Hub API offline&rdquo;. Start the Hub, then press{" "}
                <strong>Re-check connection</strong>.
              </p>
            </div>
          </li>
          <li>
            <span className="check-number" aria-hidden="true">
              2
            </span>
            <div>
              <h3>Has the module finished setup?</h3>
              <p>
                <strong>Not installed</strong> and <strong>Needs setup</strong>{" "}
                are setup problems, not launch problems. Run the environment
                check and setup scripts before pressing Start.
              </p>
            </div>
          </li>
          <li>
            <span className="check-number" aria-hidden="true">
              3
            </span>
            <div>
              <h3>Did the first start simply take longer?</h3>
              <p>
                A first run can be slow: the architecture allows up to 60 seconds
                for ISTS and 180 seconds for BandReady, because migrations and
                seed content run on first start. Leave the card on{" "}
                <strong>Starting…</strong> and watch the Hub log.
              </p>
            </div>
          </li>
        </ol>
      </section>

      <section className="section" aria-labelledby="commands-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Terminal</p>
            <h2 id="commands-title">How to start manually</h2>
            <p className="section-copy">
              Run these from the repository root unless the block says otherwise.
              Use <code>corepack</code> so each package gets its pinned pnpm.
            </p>
          </div>
        </div>

        <div className="command-grid">
          <CommandBlock
            label="Environment check"
            note="Prints PASS/FAIL for Node, pnpm, Python, uv, git, submodules and ports. Exit code 1 means something needs fixing."
          >
            {`node scripts/check-env.mjs`}
          </CommandBlock>

          <CommandBlock
            label="Hub + both apps"
            note="The documented one-command development entry point. It serves this portal and owns start/stop; once started, open the Hub URL rather than the Vite dev server."
          >
            {`node scripts/dev.mjs`}
          </CommandBlock>

          <CommandBlock
            label="Portal only (hot reload)"
            note="Useful while working on this UI. Vite runs on 127.0.0.1:5175 and proxies /api to the Hub on 127.0.0.1:8780."
          >
            {`cd portal
corepack pnpm install
corepack pnpm dev -- --port 5175`}
          </CommandBlock>

          <CommandBlock
            label="Build the portal"
            note="Typecheck first, then produce portal/dist. The Hub serves that folder in production."
          >
            {`cd portal
corepack pnpm build`}
          </CommandBlock>

          <CommandBlock
            label="ISTS on loopback (manual)"
            note="Never run a bare next start: it binds 0.0.0.0. Pin the host to 127.0.0.1 as shown."
          >
            {`cd apps/ists
corepack pnpm start -- -H 127.0.0.1 -p 3000`}
          </CommandBlock>

          <CommandBlock
            label="BandReady, browser edition (manual)"
            note="See docs/DEVELOPMENT.md for the full sequence, including the uv sync step for the sidecar. --no-mock matters."
          >
            {`cd apps/bandready
node scripts/dev.mjs --browser --no-mock --port 5273 --sidecar-port 8710`}
          </CommandBlock>
        </div>
      </section>

      <section className="section" aria-labelledby="symptoms-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Common symptoms</p>
            <h2 id="symptoms-title">What to try next</h2>
          </div>
        </div>

        <div className="symptom-list">
          <Symptom title="The page says “Hub API offline”">
            <p>
              The Hub is not answering <code>GET /api/state</code> on{" "}
              <code>127.0.0.1:8780</code>. Check that the Hub process is running
              and that nothing else has taken port 8780. Restart the Hub and
              retry from this page.
            </p>
          </Symptom>

          <Symptom title="A module stays on “Starting…”">
            <p>
              The Hub requires both process liveness and a successful HTTP probe
              before it reports <strong>Running</strong>. ISTS is probed at{" "}
              <code>GET /</code>, BandReady at <code>GET /health</code>. First
              starts can take up to 60 s and 180 s respectively. If it exceeds
              that, read the module log in{" "}
              <code>%APPDATA%\IELTS-Study-Hub\hub\logs\</code>.
            </p>
          </Symptom>

          <Symptom title="A card says “Not installed” or “Needs setup”">
            <p>
              Start is disabled on purpose. Run <code>node scripts/check-env.mjs</code>{" "}
              and the setup script, then refresh. BandReady also needs Python
              3.11+ and uv for its sidecar; ISTS needs its own pnpm-managed
              dependencies built.
            </p>
          </Symptom>

          <Symptom title="A port is already in use">
            <p>
              The Hub checks ports before launching and reports an actionable
              error on the card. Close the process that owns the port yourself —
              the Hub refuses to kill a process it did not start. BandReady may
              choose a different free port; always trust the port reported in{" "}
              <code>/api/state</code>.
            </p>
          </Symptom>

          <Symptom title="“Open” is disabled even though the app is up">
            <p>
              Open requires the Hub to report <strong>running</strong> and to
              provide a non-empty URL. A manually started app is outside the
              Hub&apos;s process tracking. Stop it, then start it from this
              portal so the Hub can probe it and publish the URL.
            </p>
          </Symptom>

          <Symptom title="The microphone does not work in BandReady">
            <p>
              Use Chrome or Edge on the app&apos;s loopback URL, allow microphone
              access in Windows privacy settings, close other apps that hold the
              microphone, then reload. Open BandReady in its own tab — this portal
              never embeds it in an iframe.
            </p>
          </Symptom>

          <Symptom title="pnpm reports a version conflict">
            <p>
              Always invoke pnpm through corepack inside each package. ISTS pins
              pnpm 10.30.3 and BandReady pins 9.12.0; one global pnpm will break
              one of them.
            </p>
          </Symptom>
        </div>
      </section>

      <section className="section" aria-labelledby="docs-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Reference</p>
            <h2 id="docs-title">Documentation</h2>
            <p className="section-copy">
              These paths are relative to the repository root.
            </p>
          </div>
        </div>

        <ul className="doc-list">
          {DOC_LINKS.map((doc) => (
            <li key={doc.path}>
              <code>{doc.path}</code>
              <span>{doc.description}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="privacy-strip" aria-labelledby="privacy-title">
        <p className="eyebrow eyebrow--light">Privacy</p>
        <h2 id="privacy-title">Nothing leaves this computer.</h2>
        <p>
          No account, no telemetry, no cloud database. The portal holds no API
          keys and sends no study data. Each app keeps its own data and talks to
          its own AI provider, if you configure one.
        </p>
      </section>
    </>
  );
}
