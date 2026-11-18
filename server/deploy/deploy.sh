#!/usr/bin/env bash
# Installs one release of the sync server and makes it live (design C5,
# devstation-5s42). It is the deploy key's forced command on the box
# (authorized_keys: command="/opt/chord/bin/deploy.sh",restrict), so the
# request in SSH_ORIGINAL_COMMAND is untrusted: it must be exactly
#
#   deploy <vX.Y.Z[-pre]> <40-hex commit>
#
# and the release arrives as a tar on stdin, so the box needs no access to the
# repository:
#
#   git archive --format=tar <tag> | ssh deploy@<host> deploy <tag> <sha>
#
# The key gets no shell, but it deploys code: the release's build runs as
# deploy and the server runs it as chord, with the production .env. Treat the
# key as the right to ship code to production.
#
# Steps: unpack to releases/<tag> -> link the shared .env and Hocuspocus data ->
# install, build -> migrate --status, migrate (on MIGRATE_DATABASE_URL, the
# direct database URL: session advisory locks do not hold through a pooler) ->
# write release.env -> flip `current` -> restart -> /health must name the tag 5
# times running. An unhealthy release flips back to the previous one and is
# removed; when migrations were applied, the log says `schema_ahead: true` (the
# database is ahead of the live code, which the migration lint keeps
# compatible; it is not rolled back). Keeps the newest 3 releases. Rerunning
# the live tag succeeds without changing anything.
#
# Exit: 0 live, 1 failed (the previous release is live; on a first deploy there
# is none), 2 refused request, 75 another deploy holds the lock.
#
# DEPLOY_ROOT, DEPLOY_PREPARE, DEPLOY_MIGRATE, DEPLOY_RESTART, DEPLOY_HEALTH_URL
# and DEPLOY_HEALTH_INTERVAL exist for scripts/release/deploy-sh.test.ts; sshd
# passes no environment through a restrict key, so the forced command always
# runs with the defaults.
set -Eeuo pipefail
umask 022

request=${SSH_ORIGINAL_COMMAND-"$*"}
re='^deploy (v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?) ([0-9a-f]{40})$'
if [[ ! $request =~ $re ]]; then
  echo "deploy.sh: refused; the only request is: deploy <vX.Y.Z[-pre]> <40-hex commit>" >&2
  exit 2
fi
tag=${BASH_REMATCH[1]}
sha=${BASH_REMATCH[3]}

# A dropped SSH connection must not stop the script between the flip and the
# flip-back: writes to the gone stdout fail quietly instead.
trap '' PIPE

ROOT=${DEPLOY_ROOT:-/opt/chord}
RESTART=${DEPLOY_RESTART:-sudo -n /usr/bin/systemctl restart chord-sync.service}
# The unit's PORT (chord-sync.service); Caddy proxies the same port.
HEALTH_URL=${DEPLOY_HEALTH_URL:-http://127.0.0.1:1234/health}
INTERVAL=${DEPLOY_HEALTH_INTERVAL:-2}
HEALTH_TRIES=30
HEALTH_STREAK=5
KEEP=3
export PATH="/opt/node/bin:$PATH" COREPACK_ENABLE_DOWNLOAD_PROMPT=0

releases=$ROOT/releases
shared=$ROOT/shared
dest=$releases/$tag
lock=$ROOT/deploy.lock
mkdir -p "$releases" "$shared/hocuspocus"

log() {
  printf '%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$tag" "$*" >>"$shared/deploy.log"
  echo "deploy: $*" 2>/dev/null || true
}

# One deploy at a time. The lock is a directory holding its owner's pid, put in
# place by one rename, so it never exists without a pid. A dead owner's lock is
# moved aside by a rename too, so of two deploys that find it only one takes it.
take_lock() {
  local mine=$ROOT/.deploy.lock.$$ holder
  mkdir "$mine"
  echo $$ >"$mine/pid"
  mv -T "$mine" "$lock" 2>/dev/null && return 0
  holder=$(cat "$lock/pid" 2>/dev/null || true)
  if ! { [ -n "$holder" ] && kill -0 "$holder" 2>/dev/null; }; then
    mv -T "$lock" "$ROOT/.deploy.lock.stale.$$" 2>/dev/null && rm -rf "$ROOT/.deploy.lock.stale.$$"
    mv -T "$mine" "$lock" 2>/dev/null && return 0
  fi
  rm -rf "$mine"
  echo "deploy.sh: deploy ${holder:-?} is in progress" >&2
  exit 75
}
take_lock
trap '[ "$(cat "$lock/pid" 2>/dev/null)" = $$ ] && rm -rf "$lock"' EXIT

live_path() {
  local p
  p=$(readlink "$ROOT/current" 2>/dev/null || true)
  printf '%s' "${p%/}"
}

health_version() {
  curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null | sed -n 's/.*"version":"\([^"]*\)".*/\1/p' || true
}

# /health must name $1 on HEALTH_STREAK consecutive polls within HEALTH_TRIES.
wait_healthy() {
  local want=$1 i streak=0
  for ((i = 0; i < HEALTH_TRIES; i++)); do
    if [ "$(health_version)" = "$want" ]; then
      streak=$((streak + 1))
      [ "$streak" -ge "$HEALTH_STREAK" ] && return 0
    else
      streak=0
    fi
    sleep "$INTERVAL"
  done
  return 1
}

# Atomic: a new link renamed over the old one, so `current` always exists.
flip() {
  ln -sfn "$1" "$ROOT/current.tmp"
  mv -T "$ROOT/current.tmp" "$ROOT/current"
}

restart() { bash -c "$RESTART"; }

write_release_env() {
  printf '%s\n' "$1" >"$shared/release.env.tmp"
  mv -f "$shared/release.env.tmp" "$shared/release.env"
}

# The release's server reads the operator's .env and keeps Yjs files in the
# shared folder, so a deploy never loses them.
link_shared() {
  if [ ! -f "$shared/.env" ]; then
    echo "deploy.sh: $shared/.env is missing; the operator provides it (server/DEPLOYMENT.md)" >&2
    return 1
  fi
  ln -sfn "$shared/.env" "$dest/server/.env"
  mkdir -p "$dest/server/data"
  ln -sfn "$shared/hocuspocus" "$dest/server/data/hocuspocus"
}

# shellcheck disable=SC2329 # called through run_step
prepare_release() {
  # Chained: run_step is called inside `if`, where bash ignores errexit.
  pnpm install --frozen-lockfile --ignore-scripts &&
    pnpm --filter @chord/sync-server run build
}

# shellcheck disable=SC2329 # called by migrate_release, through run_step
pending_count() {
  local out
  out=$(DATABASE_URL=$1 timeout 300 pnpm -s run migrate --status) || return 1
  printf '%s\n' "$out" | grep -c '^\[migrate\] pending:' || true
}

# shellcheck disable=SC2329 # called through run_step
migrate_release() {
  local url before after
  url=$(sed -n 's/^MIGRATE_DATABASE_URL=//p' "$shared/.env" | sed 's/^"\(.*\)"$/\1/')
  if [ -z "$url" ]; then
    echo "deploy.sh: MIGRATE_DATABASE_URL (the direct database URL, not the pooler) is missing from $shared/.env" >&2
    return 1
  fi
  cd server
  # --status stops before any change when the database is ahead of this
  # release, a shipped migration was edited, or one is out of order.
  before=$(pending_count "$url") || return 1
  # The tag is what lets migrate write: dev and prod share the database, and
  # only a release deploy applies migrations to it.
  DATABASE_URL=$url CHORD_RELEASE_TAG=$tag timeout 900 pnpm -s run migrate && return 0
  # Each file commits on its own: a failure after the first leaves some applied.
  # A status that fails too (the database is likely down) cannot say nothing
  # was applied: count it as applied, so the log errs towards schema_ahead.
  if ! after=$(pending_count "$url") || [ "$after" -lt "$before" ]; then
    touch "$dest/.migrated-partly"
  fi
  return 1
}

# Runs a step in the release: the DEPLOY_* override when set, else the function.
run_step() {
  local override=$1 fn=$2
  if [ -n "$override" ]; then
    (cd "$dest" && bash -c "$override")
  else
    (cd "$dest" && "$fn")
  fi
}

prune() {
  local live d n=0
  live=$(basename "$(live_path)")
  # Newest first by the time deploy.sh touched each release; skips .<tag>.tmp.
  while IFS= read -r d; do
    n=$((n + 1))
    if [ "$n" -gt "$KEEP" ] && [ "$d" != "$live" ]; then
      rm -rf "${releases:?}/$d"
    fi
  done < <(find "$releases" -mindepth 1 -maxdepth 1 -type d ! -name '.*' -printf '%T@ %f\n' |
    sort -rn | cut -d' ' -f2-)
}

prev=$(live_path)
prev_tag=${prev##*/}

if [ "$prev_tag" = "$tag" ]; then
  if wait_healthy "$tag"; then
    log "already live and healthy; nothing to do"
    exit 0
  fi
  log "is live but unhealthy; redeploying the live release in place is refused"
  exit 1
fi

# Unpack.
rm -rf "$releases/.$tag.tmp"
mkdir "$releases/.$tag.tmp"
if ! tar -x -C "$releases/.$tag.tmp"; then
  rm -rf "$releases/.$tag.tmp"
  log "stdin was not a release tar; nothing changed"
  exit 1
fi
rm -rf "$dest"
mv "$releases/.$tag.tmp" "$dest"
touch "$dest"
log "unpacked $sha"

if ! link_shared || ! run_step "${DEPLOY_PREPARE-}" prepare_release; then
  rm -rf "$dest"
  log "install or build failed; nothing changed"
  exit 1
fi
if ! run_step "${DEPLOY_MIGRATE-}" migrate_release; then
  if [ -e "$dest/.migrated-partly" ]; then
    log "migrate failed partway; current is unchanged"
    log "schema_ahead: true (some migrations of $tag are applied; the live release runs on them)"
  else
    log "migrate failed before applying anything; current is unchanged"
  fi
  rm -rf "$dest"
  exit 1
fi
log "migrated"

prev_env=$(cat "$shared/release.env" 2>/dev/null || true)
write_release_env "$(printf 'CHORD_RELEASE_TAG=%s\nCHORD_RELEASE_COMMIT=%s' "$tag" "$sha")"
flip "$dest"
if restart && wait_healthy "$tag"; then
  log "live"
  prune
  exit 0
fi

log "unhealthy: /health did not name $tag"
if [ -n "$prev" ]; then
  write_release_env "$prev_env"
  flip "$prev"
  rm -rf "$dest"
  if restart && wait_healthy "$prev_tag"; then
    log "flipped back; $prev_tag is live"
  else
    log "flipped back, but $prev_tag is not healthy either"
  fi
else
  log "no previous release to flip back to; current stays on $tag, which is unhealthy"
fi
log "schema_ahead: true (migrations of $tag are applied; the live release runs on them)"
exit 1
