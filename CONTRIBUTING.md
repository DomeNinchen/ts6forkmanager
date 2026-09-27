# Contributing to TS6 Manager

Thanks for taking the time to contribute! This covers code changes — for bug reports and feature requests, use the [issue templates](.github/ISSUE_TEMPLATE); for questions or discussing an idea first, use [Discussions](https://github.com/DomeNinchen/ts6forkmanager/discussions). Found a security vulnerability? See [SECURITY.md](SECURITY.md) instead of opening a public issue.

Want to help translate the WebGui instead of writing code? That happens on [Crowdin](https://crowdin.com/project/ts6forkmanager), not here — no repo setup needed.

## Project layout

This is a pnpm workspace with four packages under `packages/*`:

- **`backend`** — Node/Express API + WebSocket server, Prisma over SQLite. TypeScript, ESM.
- **`frontend`** — React + Vite + Tailwind SPA.
- **`sidecar`** — a standalone Go service (WebRTC video streaming), not part of the pnpm workspace.
- **`common`** — shared TypeScript types/constants used by both backend and frontend.

## Setting up a dev environment

```bash
pnpm install
cp .env.example .env   # then set JWT_SECRET at minimum
pnpm db:generate
pnpm db:push
pnpm db:seed
pnpm dev                # runs backend + frontend together
```

`common` needs to be built (or run via `pnpm dev`, which watches it) before backend/frontend pick up changes to it — they import its compiled output, not its source.

For the sidecar, work in `packages/sidecar` directly with the normal Go toolchain (`go build`, `go test ./...`) — it isn't wired into the pnpm scripts.

## Before opening a PR

- `pnpm typecheck` (from the repo root) is the main automated check for backend/frontend/common — there's no JS/TS test suite yet. The Go sidecar does have tests: `cd packages/sidecar && go test ./...`.
- If you can, actually run the feature you changed against a real TeamSpeak server rather than relying on typecheck alone — a surprising number of bugs here only show up against the real protocol.
- Keep PRs focused on one change. A bug fix doesn't need to bring along an unrelated refactor.
- Update [CHANGELOG.md](CHANGELOG.md) with a short entry describing what changed and why, in the same style as the existing entries near the bottom of the "Individual Changes" section. If you're not sure how to phrase it, a rough description is still helpful — it can be tightened up in review.
- If your change is user-visible, mention in the PR description whether backend, frontend, and/or sidecar need a version bump (each is versioned independently) — again, doesn't have to be exact, just flag it.

## Code style

- TypeScript throughout backend/frontend/common; relative imports in the backend need explicit `.js` extensions (ESM requirement).
- No enforced linter currently (`pnpm lint` is a no-op) — match the style of the surrounding code.
- Frontend UI is built from the existing Radix-based primitives in `packages/frontend/src/components/ui` rather than raw HTML elements or a new component library.

## Questions about a specific area

The [Development wiki page](https://github.com/DomeNinchen/ts6forkmanager/wiki/Development) goes deeper into the architecture (how the app talks to TeamSpeak, the bot flow engine, the music/voice bot internals) than this file does.
