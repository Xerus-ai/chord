# Chord

A multiplayer desktop workspace where dev teams align and AI agents build.

## What is Chord?

Chord is a desktop app (Electron) where teams plan, build, and review together with any coding agent. It wraps around tools like Claude Code, Codex, and Gemini — providing the collaboration layer that solo agent terminals lack.

**Core concepts:**
- **Work Items** — the unit of work, backed by a git branch, with linked tickets, sessions, artifacts, and PRs
- **Agent Sessions** — run multiple coding agents in parallel, each in its own git worktree
- **Artifacts** — collaborative planning docs produced inline during work
- **Team Pulse** — AI-summarized view of what everyone is working on

## Setup

```bash
pnpm install
pnpm run dev
```

Requires Node.js 24+ and pnpm 10+.

## Scripts

| Command | What it does |
|---------|-------------|
| `pnpm run d` | Install + dev (one command) |
| `pnpm run dev` | Start Electron + sync server |
| `pnpm run build` | Build for production |
| `pnpm run package` | Build + package with electron-builder |
| `pnpm run test` | Run tests |
| `pnpm run format` | Format code |
| `pnpm run lint` | Lint |
| `pnpm run typecheck` | TypeScript check |
| `pnpm run db:reset` | Delete local SQLite DB |

## Architecture

```
src/
  main/           Electron main process (Node.js)
    core/         Domain modules (work-items, chat, pty, git, github, etc.)
    db/           SQLite via Drizzle ORM
    app/          Window management, menus
  renderer/       Electron renderer (React 19 + Zustand + TanStack Query + Tailwind 4)
    features/     Feature modules (dashboard, work-list, settings, etc.)
    lib/          Shared components, hooks, stores
  shared/         Types and utilities shared between main and renderer
server/           Cloud sync server (WebSocket + HocusPocus)
packages/protocol Wire types shared by the app and the server
```

## Environment

Copy `.env.example` to `.env` and fill in values. See the example file for required variables.

## Part of Xerus

Chord is the desktop client in the [Xerus](https://xerus.ai) ecosystem.
