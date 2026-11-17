# Security Policy

## Scope

IELTS Study Hub runs on your own computer and binds only to loopback addresses. It
does not run a public server, does not create accounts and does not upload your study
data anywhere.

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's private
"Report a vulnerability" (Security → Advisories) on this repository, or contact the
maintainer directly if advisories are unavailable.

Include the affected version/commit, the steps to reproduce, and what an attacker
could achieve.

## Design constraints we treat as security requirements

- The Hub and both apps must listen on `127.0.0.1` only. ISTS must be started with
  `-H 127.0.0.1`; `next start` otherwise binds `0.0.0.0`.
- The Hub must never manage processes it did not start. Stopping a module may only
  terminate a PID tree that the Hub itself spawned and recorded.
- API keys, launch secrets (`web.json`) and user data must never be logged, committed
  or sent to any Hub service.
- No iframes and no reverse proxy for application APIs: each app keeps its own origin
  and authentication.

## Out of scope

- Vulnerabilities in the upstream projects (report them upstream).
- Risks introduced by exposing the apps to a LAN or the internet against this
  project's guidance.
