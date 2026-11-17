# Changelog

All notable changes to this project are documented here, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Phase 0 architecture audit of ISTS and BandReady (ports, data, health checks,
  licensing, Windows specifics).
- Git submodule skeleton pinned to:
  - ISTS `1088fe0f11391ec0106d5225c40ae310c57a37ba`
  - BandReady `b2d67d409e69be60962ca2d123733be0d572761e`
- Root licence, third-party notices, security policy and contribution guide.

### Planned (Phase 1)

- React + TypeScript portal with module cards, real status and settings.
- Node process manager (spawn, PID tracking, health probes, logs, graceful stop).
- `check-env`, `setup`, `dev`, `stop` scripts.
- Installation, architecture, privacy and troubleshooting docs.
- GitHub Actions: portal typecheck/lint/build, script tests, submodule check.
