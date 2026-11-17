# Troubleshooting

## ISTS is reachable from other devices on my network

`next start` binds `0.0.0.0` by default. Always start it with:

```bash
corepack pnpm start -- -H 127.0.0.1 -p 3000
```

Check with `netstat -ano | findstr :3000`: it must show `127.0.0.1:3000`.

## `next build` fails with "Failed to fetch Geist from Google Fonts"

ISTS uses `next/font/google`, which downloads fonts at build time. Build on a machine
with access to Google Fonts (or via a proxy) once; the build cache does not survive a
clean `.next`, so CI needs network access for this step. This is an upstream behaviour,
not a Hub bug.

## `better-sqlite3` fails to install ("prebuild-install" / "node-gyp")

The native module needs either a prebuilt binary (network) or a local C++ toolchain on
Windows: Visual Studio Build Tools with the "Desktop development with C++" workload
(MSVC + Windows SDK) and Python. Re-run `corepack pnpm rebuild better-sqlite3` after
installing them.

## BandReady's port 8765 is already in use

BandReady automatically picks the next free port and records it in
`%APPDATA%\BandReady\web.json`. The Hub reads that file; never hard-code 8765 in your
own scripts.

## BandReady shows "It answered, but with an error" / HTTP 502

The sidecar is running but its configured LLM provider is unreachable. Check
Settings → Providers:
- "On this computer" expects Ollama on `127.0.0.1:11434`.
- "Through OpenRouter" expects a valid key and outbound access.
The voice and speech-recognition models download on first use and can be started from
the same screen.

## Microphone does not work in the browser edition

- Use Chrome/Edge on `http://127.0.0.1:8765` (localhost is a secure context, so
  `getUserMedia` is allowed).
- Check Windows Settings → Privacy → Microphone and allow the browser.
- Close other apps that hold the microphone, then reload.

## `git submodule` folders are empty after cloning

```bash
git submodule update --init --recursive
```

## A module was killed but the port stays occupied

The Hub only stops processes it started. If an app was started manually, close that
process yourself; the Hub will refuse to kill an untracked PID.

## Hub logs

Windows: `%APPDATA%\IELTS-Study-Hub\hub\logs\ists.log` and `bandready.log`.

## pnpm version conflicts

Use corepack (`corepack pnpm …`) inside each app. ISTS pins pnpm 10.30.3, BandReady
pins 9.12.0; a single global pnpm will break one of them.
