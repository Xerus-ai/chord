# Deploying the Chord Sync Server

A runbook for standing up the Chord cloud sync server for your own small team
(5-10 users). One VPS, no Kubernetes, no horizontal scaling — that's a later
problem. Follow this top to bottom.

## 1. What you're deploying

One Node process (`server/src/index.ts`) that serves REST + WebSocket on
`PORT` (work items, chat, presence, sharing, git-state) and a Hocuspocus/Yjs
server on `HOCUSPOCUS_PORT` (live artifact co-editing), both against one
Neon Postgres database. WorkOS handles authentication. The Electron client
connects to both ports directly — there's no API gateway or BFF layer.

## 2. Prerequisites

- **Node 24.14.0** — pinned in the repo root's `.nvmrc`; `package.json`
  requires `>=24.0.0`. Use `nvm use` from the repo root, or install that
  version directly.
- **pnpm >= 10.28.0** (`pnpm-workspace.yaml` makes `server/` a workspace
  member of this repo, not an independent package — you check out the whole
  repo, not just `server/`). The server also depends on the workspace package
  `@chord/protocol` (the shared cloud wire contract), which resolves through
  the repo-root `node_modules`; `pnpm run build` below compiles it first, so
  there is no extra step, but the whole repo must stay on disk at runtime.
- **A Neon Postgres project.** Copy its pooled connection string for
  `DATABASE_URL` below.
- **A WorkOS project**, AuthKit enabled. From the WorkOS dashboard, copy:
  - API Key → `WORKOS_API_KEY`
  - Client ID → `WORKOS_CLIENT_ID`
  - Add `https://<your-domain>/auth/callback` as a Redirect URI.
- **A VPS with a domain pointed at it** (an A record is enough; the reverse
  proxy in step 6 gets you TLS).

## 3. Environment

Copy `server/.env.example` to `server/.env` and fill in, var by var:

| Var | Notes |
|---|---|
| `DATABASE_URL` | Neon pooled connection string. |
| `WORKOS_API_KEY`, `WORKOS_CLIENT_ID` | From step 2. |
| `PORT` | REST + WS port. Defaults to `1234`. |
| `HOCUSPOCUS_PORT` | Yjs port. Defaults to `1235`. |
| `NODE_ENV` | **Must be `production`.** If `WORKOS_CLIENT_ID` is also missing, the server refuses to start rather than silently disabling auth (`middleware/auth.ts`) — this is intentional, not a bug to work around. |
| `DEV_MODE` | Leave unset. It only takes effect when `NODE_ENV` is NOT `production`, so it's inert here regardless — never set it on a production box. |
| `ALLOWED_ORIGINS` | Leave unset unless you're also running a non-default renderer build (the packaged Electron app's `app://` origin is always allowed). |
| `TRUST_PROXY` | **Set to `1`** — you're terminating TLS at a reverse proxy in step 6, one hop in front of this process. Without it, the IP-keyed rate limiters (auth endpoints) see every caller as the proxy's own address, and legitimate concurrent sign-ins throttle each other. Fails fast on boot if set to anything other than a positive integer or `true`. |
| `SYNC_SERVER_URL` | `https://<your-domain>` — **required.** The public origin of this server: public artifact links (`/p/<token>`) and their OpenGraph `og:url` are built from it. The server refuses to start without it. |
| `SHARE_LINK_SECRET` | **Required.** 32+ random bytes (`openssl rand -base64 48`). Public artifact link tokens are HMACs of the link id under this secret; the database stores only their hashes. Rotating it invalidates every public link. The server refuses to start without it. |

You'll also configure the **Electron client's** build-time env to point at
this deployment — not covered here (client repo root `.env.example`), but
note now for step 6: `VITE_CLOUD_API_URL`/`VITE_CLOUD_WS_URL` point at
`PORT` through the proxy, `VITE_COLLAB_WS_URL` points at `HOCUSPOCUS_PORT`
through the proxy on a **different port**, not a path.

## 4. Database migrations — read this section carefully

`server/src/db/migrations/` is the deployable migration set: **hand-written
SQL, applied in numeric order by `pnpm run migrate`.** `server/drizzle/` is a *different*
thing — `drizzle-kit`'s own snapshot chain, generated so future
`drizzle-kit generate` runs have a consistent history. **Never apply
anything from `server/drizzle/` directly; nothing in this repo's deploy
path reads it.**

Apply them with the runner, from `server/`:

```bash
pnpm run migrate             # apply every file this database is missing
pnpm run migrate --status    # report applied/pending, write nothing
```

`src/db/migrate.ts` reads the directory in numeric order, applies each
pending file **in its own transaction**, and records it in a `_migrations`
ledger table (file name + SHA-256 of the file). "Which files does this
database already have?" is therefore answered by the database, not by
whoever last ran the deploy — which is the whole point, because getting that
answer wrong by hand is how a database ends up mid-set.

It connects over the WebSocket driver (`Client`), not the app's `neon()`
HTTP driver: over HTTP every statement is its own implicit transaction, so a
file that fails halfway would leave its earlier statements committed. Under
the runner a failed file is rolled back whole and the run stops there,
leaving the ledger accurate.

It refuses to apply anything at all — rather than guessing — when:

- a file that the ledger says was applied has since **changed** (migrations
  are immutable; write a new one),
- the ledger names a migration that **isn't in this checkout** (the database
  is ahead of the code you're deploying),
- a **pending file is numbered below** an applied one (it would run against a
  schema that has already moved past it),
- any `.sql` file in the directory is **misnamed** or **duplicates a number**
  (it would be silently skipped, or its order would be ambiguous),
- the database already has application tables but **no ledger** — see
  "Adopting an existing database" below.

**A fresh database starts at `0000_baseline.sql`** — it creates the 18 tables
that predate this directory (`users`, `work_items`, `chat_messages`, and the
rest), which were originally created by a `drizzle-kit push` against a live
database and therefore existed in no file on the deploy path at all.
Standing up a new Neon project without it gives you a server that fails on
its first query, because 0001-0010 only ALTER and reference those tables.
On a fresh database `pnpm run migrate` starts there on its own.

Read each file's own header comment before applying — several document a
pre-check query or a data-repair step that runs as part of the migration,
not just a schema change.

### Adopting an existing database

A database migrated by hand before the runner existed has the full schema
and an empty ledger. The runner detects exactly that (tables present, ledger
empty) and **stops**, because blindly re-applying 0000 onward to it would
fail on the first unguarded statement — and 0003 carries a data migration
that renumbers artifact versions.

Tell it what that database already received, once:

```bash
pnpm run migrate --baseline 0010   # record 0000..0010 as applied, run none of them
pnpm run migrate                   # then apply anything newer, normally
```

`--baseline` only writes ledger rows; it executes no SQL from the migrations.
Name the **last** migration the database actually got — if you name one it
never received, that file is now recorded as applied and will never run.

### What keeps this set honest

`agent_plan_requests` reached production missing not because a file was
skipped, but because **no migration for it was ever written**: the `pgTable`
was added to `src/db/schema.ts`, every route querying it typechecked and
passed review, and nothing compared the schema against this directory. The
table simply did not exist on any deployed database until 0008 was written.

`src/db/migration-coverage.test.ts` now enforces the invariant that would
have caught it: every `pgTable` in `src/db/schema.ts` must have a
`CREATE TABLE` in some file here, and the numeric prefixes must be unique and
contiguous with no gaps. It runs as part of `pnpm run test` at the repo root
and carries no exception list. If you add a table to the schema and no
migration, the suite fails by name before the change can merge.

The guard is **column-level too**. `src/db/migration-schema.ts` replays this
directory's DDL — `CREATE TABLE`, `ADD COLUMN`, `DROP COLUMN`,
`RENAME COLUMN`, including statements inside a `DO $$ ... $$` guard block —
and reconstructs the shape a database ends up in; the test then compares that
against every column in `schema.ts` and names any that no file here creates.
That closes the gap `share_tokens.invited_email` shipped through (the column
was in `schema.ts` and in `server/drizzle/`, no file here created it, and
sign-in broke on every database built from this runbook — 0009 is the fix).
A schema change that never reaches this directory now fails the suite by
`table.column` name instead of needing a by-hand check.

### If sign-in fails with `column "invited_email" does not exist`

You are missing **0009**. Apply it and the error clears:

```
ERROR: column "invited_email" does not exist
```

The column lives in `src/db/schema.ts` and in `server/drizzle/`, but until
0009 no file in *this* directory created it — so every database built from
this runbook lacked it. The failing query is in `sync-profile`
(`src/server.ts`), which runs on **sign-in for every user who has an email**,
so the symptom is total sign-in failure rather than a broken corner of
sharing. Share-by-email to an invitee without an account
(`src/routes/sharing.ts`) fails for the same reason.

0009 is guarded with `IF NOT EXISTS` on both statements, so it is safe to
apply blind: if an environment already got the column from a `drizzle-kit
push`, the file is a no-op there and the loop continues.

## 5. Build & run

From the **repo root** (not `server/` — this is a pnpm workspace, the
lockfile lives at the root):

```bash
pnpm install --ignore-scripts
```

`--ignore-scripts` is required here, not optional: the root `postinstall`
runs an Electron native-module rebuild (`scripts/postinstall.ts`) that has
nothing to do with the server and can fail outright on a machine without
the Electron build toolchain — verified this exact failure mode while
adding a server dependency earlier (an `EPERM` from `electron-rebuild`
trying to touch a locked `.node` file). The server has no native
dependencies of its own; skipping install scripts doesn't cost it anything.

Then build and run:

```bash
cd server
pnpm run build   # tsc -> server/dist/
pnpm run start   # node dist/index.js — reads server/.env via dotenv
```

Confirm it's alive (separate shell): `curl http://localhost:$PORT/health`
should return `{"status":"ok",...}`.

For a real deploy, keep it running with a minimal systemd unit — one
process covers both `PORT` and `HOCUSPOCUS_PORT` (`index.ts` starts both):

```ini
# /etc/systemd/system/chord-sync.service
[Unit]
Description=Chord sync server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/chord/server
EnvironmentFile=/opt/chord/server/.env
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now chord-sync
```

## 6. Reverse proxy

The client connects to **two separate ports on the same domain** — not a
path split, not subdomains. Confirmed by reading the client's own config:
`VITE_CLOUD_WS_URL=wss://<domain>/ws` (path-routed, `PORT`) but
`VITE_COLLAB_WS_URL=wss://<domain>:1235` (`HocuspocusProvider` connects to
this URL directly — `src/renderer/features/artifacts/collaboration-provider.tsx`).
So the proxy needs a listener on 443 *and* one on the Hocuspocus port.

Caddy handles this in one file, including automatic HTTPS on both listeners
(Caddyfile, adjust the domain and ports to match your `.env`):

```
<your-domain>:443 {
  reverse_proxy localhost:1234
}

<your-domain>:1235 {
  reverse_proxy localhost:1235
}
```

Caddy's `reverse_proxy` upgrades WebSocket connections automatically — no
extra directive needed for `/ws` or the Hocuspocus root. If you'd rather use
nginx, you need explicit `Upgrade`/`Connection` header passthrough on both
server blocks; Caddy's default behavior is simpler to get right, which is
why it's the recommendation here for a first deploy.

## 7. Deploy-order rule: server before client

If you ever rebuild the Electron client with a change to git-state pushes
(the delta/`content_hash` protocol — `server/src/routes/git-state.ts`,
`src/main/core/work-items/git-state-capture.ts`), **deploy the updated
server before that client build reaches any user.** An old server doesn't
error on the new field — it silently ignores `content_hash` and applies its
old full-replace logic, which can drop content the new client assumed was
already stored. This is the one hard ordering constraint in this codebase;
everything else degrades gracefully in either direction.

## 8. Upgrades & restarts

Restarting the server process drops every open WebSocket connection.
Clients auto-reconnect and reseed their view on reconnect — this is
automatic (`SERVER_EPOCH`, a fresh random value per process, lets a
reconnecting client tell "the server restarted" apart from "I have a real
gap in this connection's event stream," and both cases already trigger a
resync). No manual client action needed after a restart.

For future schema changes: run `pnpm run migrate` (step 4) **before**
deploying the code that depends on it, never the other way around. It is a
no-op when the database is already current, so running it on every deploy is
the safe habit.

## 9. Verify it works

1. `curl https://<your-domain>/health` → `{"status":"ok",...}`.
2. Sign in from the Electron app pointed at this server (`CHORD_AUTH_SERVER_URL`
   / `VITE_CLOUD_API_URL` set to `https://<your-domain>` in the client build).
3. Share a work item between two accounts and confirm both see live
   updates (presence, chat) — or use this repo's `chord-multiplayer-test`
   skill if you have two test accounts handy.

## 10. Limits to know about

- **Rate limits** (`server/src/middleware/rate-limit.ts`): 300 req/min per
  user generally; 30/min per IP on `/auth/callback`; 60/min per IP on
  `/auth/poll` (sized for its real ~1.5s polling cadence during sign-in);
  30/min per user on `/auth/sync-profile`. WebSocket: 60 messages and 1MB
  per connection per second, connection closed after 3 consecutive
  over-budget seconds.
- **Single process, vertical scaling only.** `ConnectionManager` (rooms,
  presence) lives in one process's memory — there's no Redis fan-out yet,
  so don't run two instances behind a load balancer expecting them to share
  state. Fine for 5-10 users on one box; revisit if that changes.
- **Legacy on-disk Hocuspocus data** (`server/data/hocuspocus/*.yjs`, from
  before migration 0006): the server lazy-imports any such file into
  Postgres the first time that document loads after this deploy, then reads
  from Postgres from then on (`server/src/hocuspocus.ts`). If you're
  migrating an *existing* instance, copy that folder over before first
  boot. A fresh install has no such folder and doesn't need one.
