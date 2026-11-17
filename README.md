# IELTS Study Hub

Open-source · Modular · Self-hosted · AI-powered IELTS learning platform.

IELTS Study Hub is a **unified entry point** for two independent, local-first IELTS
applications. It does not rewrite them, does not merge their databases, and does not
proxy your AI traffic. It checks your environment, starts each app on loopback, shows
real service status, and opens each app in its own browser tab.

> **Status:** Phase 1 — repository skeleton and upstream submodules. The portal and
> process manager are being built next. Nothing here is a finished release yet.

## Modules

| Module | What it is | Stack | Default URL |
|---|---|---|---|
| **ISTS** | Single-user study workspace: vocabulary SRS, reading/listening drills, writing feedback, mock exams, analytics, AI coach | Next.js 16 + SQLite | `http://127.0.0.1:3000` |
| **BandReady** | Exam training app: speaking examiner, writing, reading, listening, vocabulary, grammar, pronunciation | Electron + React + FastAPI sidecar (browser edition supported) | `http://127.0.0.1:8765` |

The Hub itself is a small React portal plus a Node process manager.

## Architecture

```
Hub (127.0.0.1:8780)
 ├── portal/     React + TypeScript + Vite (built, served by the Hub)
 ├── scripts/    environment checks, start/stop, PID tracking, logs
 ├── apps/ists        git submodule → aimerfeng/ists
 └── apps/bandready   git submodule → Luxshan2000/ielts-prep
```

- Each app keeps its own database and its own AI provider settings.
- The Hub binds to loopback only and never exposes either app to the LAN.
- No iframes: microphone, WebRTC, audio and local-service auth all behave better in
  their own tab.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the audit-derived details.

## Requirements

- Node.js ≥ 20.9 (tested on 24)
- pnpm via corepack (ISTS pins `pnpm@10.30.3`, BandReady pins `pnpm@9.12.0`)
- Python ≥ 3.11 and [uv](https://docs.astral.sh/uv/) (for BandReady's sidecar)
- Windows 10/11 first; macOS/Linux supported by design

## Quick start

```bash
git clone --recurse-submodules https://github.com/kiwik4954-glitch/IELTS-Study-Hub.git
cd IELTS-Study-Hub
node scripts/check-env.mjs     # tells you what is missing
node scripts/setup.mjs         # installs and builds the portal

# one-time upstream dependencies
cd apps/ists && corepack pnpm install && corepack pnpm build && cd ../..

# BandReady browser edition (once; ~800MB with voice)
#   irm https://raw.githubusercontent.com/Luxshan2000/ielts-prep/main/install.ps1 | iex

node scripts/dev.mjs
```

Then open the portal at `http://127.0.0.1:8780`. `scripts/setup.mjs` deliberately does
not install upstream dependencies; `check-env` reports exactly which command is missing.

> ISTS must be started with `-H 127.0.0.1`. Its default `next start` binds `0.0.0.0`,
> which would expose your study data to the local network. The Hub always passes it.

## Privacy

No account, no telemetry, no cloud database. Both apps store data on this computer;
the Hub never uploads study records, recordings, API keys or uploaded PDFs. Details in
[`docs/PRIVACY.md`](docs/PRIVACY.md).

## Upstream projects

- ISTS — <https://github.com/aimerfeng/ists> (MIT)
- BandReady — <https://github.com/Luxshan2000/ielts-prep> (MIT)

Pinned commits and third-party licence notes: [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## Trademark notice

IELTS is a registered trademark of its owners (British Council, IDP: IELTS Australia,
Cambridge University Press & Assessment). This project is independent and not
affiliated with, endorsed by, or connected to them.

## License

MIT — see [`LICENSE`](LICENSE).
