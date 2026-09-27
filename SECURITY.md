# Security Policy

## Supported Versions

Backend, frontend, and sidecar are each versioned and released independently (see [CHANGELOG.md](CHANGELOG.md)), and there are no maintained older branches — only the latest released version of each component is supported. Security fixes land on `main` and are reflected in the next version bump of whichever component(s) they touch.

## Reporting a Vulnerability

Please report security vulnerabilities privately using [GitHub's private vulnerability reporting](https://github.com/DomeNinchen/ts6forkmanager/security/advisories/new) (repo **Security** tab → **Report a vulnerability**), rather than opening a public issue or discussion — that keeps details out of view until a fix is available.

Include:
- The affected component (backend, frontend, or sidecar) and version
- Steps to reproduce, or a proof of concept
- The potential impact as you understand it

This is a personal open-source project maintained in spare time, so there's no guaranteed response SLA, but reports are taken seriously and addressed as quickly as possible. You'll get a reply acknowledging the report, and credit in the eventual CHANGELOG entry and advisory unless you'd rather stay anonymous.

If a report turns out to be a misconfiguration or expected behavior rather than a real vulnerability, that's fine too — reporting privately first is the right call either way.
