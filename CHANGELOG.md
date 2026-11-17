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

### Phase 1 implementation

- React + TypeScript portal: home with module cards and live status, settings, help.
- Node process manager: config, state store, port checks, spawn/kill by tracked PID,
  health probes, log rotation, Hub API (/api/state, /api/modules/:id/start|stop),
  SPA static serving.
- `check-env`, `setup`, `dev`, `stop` scripts.
- Documentation and GitHub Actions CI.
- Verified end-to-end: Hub + portal + ISTS on loopback, stop cleans up tracked PIDs.

