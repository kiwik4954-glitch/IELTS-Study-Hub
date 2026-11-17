# Installation

> Phase 1 status: the repository skeleton and submodules exist; `scripts/check-env.mjs`
> and `scripts/setup.mjs` are being implemented. Until they land, the manual steps
> below are the source of truth.

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | ≥ 20.9 | tested on 24 |
| corepack | bundled with Node | switches pnpm per project |
| pnpm | per project | ISTS pins 10.30.3, BandReady pins 9.12.0 — do not force one global version |
| Python | 3.11 for BandReady | `uv` can download its own 3.11 |
| uv | latest | required by BandReady |
| Git | latest | needed for submodules |

Windows 10/11 is the first-class target; macOS/Linux are kept working by design.

## 1. Clone with submodules

```bash
git clone --recurse-submodules <hub-repo-url>
cd IELTS-Study-Hub
```

Already cloned without them?

```bash
git submodule update --init --recursive
```

Pinned commits: ISTS `1088fe0…`, BandReady `b2d67d4…`.

## 2. ISTS

```bash
cd apps/ists
corepack pnpm install
corepack pnpm build
corepack pnpm start -- -H 127.0.0.1 -p 3000
```

- `-H 127.0.0.1` is mandatory: `next start` otherwise listens on `0.0.0.0`.
- To keep data outside the repository, set absolute paths before building/starting:
  ```powershell
  $env:DATABASE_URL = "file:$env:APPDATA\IELTS-Study-Hub\ists\ists.db"
  $env:UPLOAD_DIR  = "$env:APPDATA\IELTS-Study-Hub\ists\uploads"
  ```
- First build needs network access for `next/font` (Google Fonts). See troubleshooting.

## 3. BandReady (browser edition)

```powershell
irm https://raw.githubusercontent.com/Luxshan2000/ielts-prep/main/install.ps1 | iex
```

This installs with `uv` into your user folder (about 800 MB with the voice extra),
adds a Start-menu shortcut, and starts the app. The app prefers port 8765 and writes
its actual port and launch secret to `%APPDATA%\BandReady\web.json`.

Source-only alternative (no voice):

```bash
cd apps/bandready/sidecar
uv sync --extra dev          # add --extra voice for TTS/STT
uv run bandready-sidecar --help
```

## 4. Start everything

Once Phase 1 lands:

```bash
node scripts/check-env.mjs
node scripts/setup.mjs
node scripts/dev.mjs
```

Then open `http://127.0.0.1:8780`.

## Manual verification

- ISTS: `http://127.0.0.1:3000` loads; `netstat -ano | findstr :3000` shows
  `127.0.0.1:3000`, not `0.0.0.0`.
- BandReady: `http://127.0.0.1:8765` (or the port in `web.json`) loads and
  `/health` returns 200.
- The Hub must never bind to a non-loopback address.

## Updates

```bash
git pull
git submodule update --init --recursive
```

Re-run `node scripts/setup.mjs` after an upstream bump.
