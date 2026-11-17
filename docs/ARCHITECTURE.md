# Architecture

This document records the Phase 0 audit conclusions and the architecture the Hub is
built on. Anything marked **待验证 (unverified)** must be confirmed on a real Windows
machine with a real microphone before release.

## 1. Shape

```
Hub (Node, 127.0.0.1:8780)
 ├── serves portal/dist (React SPA)
 ├── /api/state, /api/start, /api/stop
 └── spawns and tracks two independent apps

ISTS          Next.js 16 + SQLite         127.0.0.1:3000
BandReady     browser edition (FastAPI)   127.0.0.1:8765 (or next free port)
```

The Hub does **not** proxy application APIs, does **not** embed the apps in iframes,
and does **not** share their databases. Each app keeps its own origin, auth and data.

## 2. Upstream facts

| | ISTS | BandReady |
|---|---|---|
| Entry | `next start` | `bandready` (launch.py) |
| Node | ≥ 20.9 (Next 16) | ≥ 20 |
| Package manager | `pnpm@10.30.3` | `pnpm@9.12.0` |
| Python | not required | ≥ 3.11 (uv-managed 3.11) |
| Health | none; use `GET /` 200 | `GET /health` (unauthenticated) |
| Data | `apps/ists/data/*.db` (default) | `%APPDATA%\BandReady` |
| Bind | `next start` defaults to `0.0.0.0` — must pass `-H 127.0.0.1` | loopback by design |

## 3. Ports and configuration

| Service | Default | Env / flag |
|---|---|---|
| Hub | 8780 | `HUB_PORT` |
| Portal dev (Vite) | 5175 | `PORTAL_DEV_PORT` |
| ISTS | 3000 | `ISTS_PORT`, `next start -p` |
| BandReady | 8765, falls back to a free port | chosen by BandReady; read `web.json` |

The Hub must read BandReady's actual port from `%APPDATA%\BandReady\web.json`
(`port`, `launch` secret) instead of assuming 8765.

## 4. Lifecycle and state

```
not-installed → not-ready → starting → running → stopped
                                   ↘ error
```

- `running` requires **both** process liveness and an HTTP probe.
- ISTS probe: `GET /` → 200 with the app's HTML.
- BandReady probe: `GET /health` → 200 (and the port must match `web.json`).
- Startup timeouts: ISTS 60 s, BandReady 180 s (first start runs migrations and seeds
  content).

## 5. Process management rules

- `spawn(command, args[], { shell: false, windowsHide: true, cwd, env })`.
- Track PID + start time + port in `%APPDATA%\IELTS-Study-Hub\hub\state.json`.
- Stop: graceful `kill()` first; after 3 s use `taskkill /PID <pid> /T /F`.
- **Never** kill a process by port or by image name; only stop tracked PID trees.
- Port pre-check with a bind attempt; `EADDRINUSE` produces an actionable message.
- Windows paths with spaces or CJK characters must work (pass argument arrays).

## 6. Data ownership

- ISTS data is configured out of the repo: `DATABASE_URL` and `UPLOAD_DIR` point into
  `%APPDATA%\IELTS-Study-Hub\ists\`.
- BandReady keeps its own `%APPDATA%\BandReady` directory; the Hub does not read its
  database in v1.
- `web.json` (BandReady launch secret) is never logged or committed.

## 7. Portal ↔ apps

- Cards show feature lists and live status.
- "Open" launches the app's URL in the default browser (a new tab), never an iframe.
- Status comes from the Hub API; the browser never talks to the apps' private APIs.

## 8. Deferred to later phases

- Unified statistics (requires verified read-only data access).
- Shared vocabulary/mistake bank.
- Unified AI coach and provider management.
- Installers, auto-update, mobile remote access (explicit opt-in + auth only).
