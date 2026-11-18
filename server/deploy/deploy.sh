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
# Steps: unpack to releases/<tag> -> install, build, link the shared .env and
# Hocuspocus data -> migrate --status, migrate -> write release.env -> flip
# `current` -> restart -> /health must name the tag 5 times running. An
# unhealthy release flips back to the previous one; when migrate ran, the log
# says `schema_ahead: true` (the database is ahead of the live code, which
# expand/contract keeps compatible; it is not rolled back). Keeps the newest 3
# releases. Rerunning the live tag succeeds without changing anything.
#
# Exit: 0 live, 1 failed (current is the previous release), 2 refused request,
# 75 another deploy holds the lock.
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

ROOT=${DEPLOY_ROOT:-/opt/chord}
RESTART=${DEPLOY_RESTART:-sudo -n /usr/bin/systemctl restart chord-sync.service}
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
  echo "deploy: $*"
}

# One deploy at a time; a lock left by a deploy that died is taken over.
if ! mkdir "$lock" 2>/dev/null; then
  holder=$(cat "$lock/pid" 2>/dev/null || true)
  if [ -n "$holder" ] && kill -0 "$holder" 2>/dev/null; then
    echo "deploy.sh: deploy $holder is in progress" >&2
    exit 75
  fi
  rm -rf "$lock"
  mkdir "$lock"
fi
echo $$ >"$lock/pid"
trap 'rm -rf "$lock"' EXIT

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
  printf 'CHORD_RELEASE_TAG=%s\nCHORD_RELEASE_COMMIT=%s\n' "$1" "$2" >"$shared/release.env.tmp"
  mv -f "$shared/release.env.tmp" "$shared/release.env"
}

prepare_release() {
  ln -sfn "$shared/.env" server/.env
  mkdir -p server/data
  ln -sfn "$shared/hocuspocus" server/data/hocuspocus
  pnpm install --frozen-lockfile --ignore-scripts
  pnpm --filter @chord/sync-server run build
}

migrate_release() {
  # --status stops before any change when the database is ahead of this
  # release, a shipped migration was edited, or one is out of order.
  (cd server && pnpm run migrate --status && pnpm run migrate)
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
  for d in $(ls -1t "$releases"); do
    n=$((n + 1))
    if [ "$n" -gt "$KEEP" ] && [ "$d" != "$live" ]; then
      rm -rf "${releases:?}/$d"
    fi
  done
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

if ! run_step "${DEPLOY_PREPARE-}" prepare_release; then
  rm -rf "$dest"
  log "install or build failed; nothing changed"
  exit 1
fi
if ! run_step "${DEPLOY_MIGRATE-}" migrate_release; then
  rm -rf "$dest"
  log "migrate failed; current is unchanged (check migrate --status: a file that failed was rolled back)"
  exit 1
fi
log "migrated"

prev_env=$(cat "$shared/release.env" 2>/dev/null || true)
write_release_env "$tag" "$sha"
flip "$dest"
if restart && wait_healthy "$tag"; then
  log "live"
  prune
  exit 0
fi

log "unhealthy: /health did not name $tag; flipping back to ${prev_tag:-nothing}"
if [ -n "$prev" ]; then
  printf '%s\n' "$prev_env" >"$shared/release.env.tmp"
  mv -f "$shared/release.env.tmp" "$shared/release.env"
  flip "$prev"
  if restart && wait_healthy "$prev_tag"; then
    log "flipped back; $prev_tag is live"
  else
    log "flipped back, but $prev_tag is not healthy either"
  fi
fi
log "schema_ahead: true (migrations of $tag are applied; the live release runs on them)"
exit 1
