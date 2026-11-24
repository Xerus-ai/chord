#!/usr/bin/env bash
# Deploys one release of the sync server from release.yml (devstation-pqub; the box side is
# server/deploy/deploy.sh, devstation-5s42). Run from a checkout that has the tag:
#
#   scripts/release/deploy-server.sh <tag> <sha>
#
# with DEPLOY_HOST, DEPLOY_KEY_FILE (the deploy key) and DEPLOY_KNOWN_HOSTS_FILE (the box's
# pinned host key, from the HETZNER_KNOWN_HOSTS secret). It sends `git archive <tag>` to the
# key's forced command and reads deploy.sh's exit:
#
#   0   the release is live: pass
#   1   the deploy failed and the previous release is live: fail, so the release's update
#       manifests are never published
#   2   deploy.sh refused the request: fail
#   75  another deploy holds the lock: retry DEPLOY_TRIES times, DEPLOY_RETRY_DELAY seconds
#       apart, then fail; never a pass
#
# deploy.sh's progress lines (and deploy.log's, which it echoes) print here as it runs; the
# key opens no shell, so this is the only way to read them.
#
# DEPLOY_SSH replaces the ssh command for scripts/release/deploy-server.test.ts.
set -Eeuo pipefail

if [ $# -ne 2 ]; then
  echo "Usage: deploy-server.sh <tag> <sha>" >&2
  exit 1
fi
tag=$1
sha=$2
tries=${DEPLOY_TRIES:-5}
delay=${DEPLOY_RETRY_DELAY:-60}

fail() {
  echo "::error::$*" >&2
  exit 1
}

[ -n "${DEPLOY_HOST:-}" ] || fail "DEPLOY_HOST (the HETZNER_HOST secret) is empty"
[ -s "${DEPLOY_KEY_FILE:-}" ] || fail "the deploy key (the HETZNER_SSH_KEY secret) is empty"
# Only the pinned key: StrictHostKeyChecking=yes refuses a host that is not in this file, so a
# box answering with another key never receives the release.
[ -s "${DEPLOY_KNOWN_HOSTS_FILE:-}" ] ||
  fail "the pinned host key (the HETZNER_KNOWN_HOSTS secret) is empty; refusing to connect"
git rev-parse -q --verify "refs/tags/$tag" >/dev/null || fail "no tag $tag in this checkout"
[ "$(git rev-parse "$tag^{commit}")" = "$sha" ] || fail "$tag is not at $sha"

ssh_command() {
  if [ -n "${DEPLOY_SSH:-}" ]; then
    eval "$DEPLOY_SSH"' deploy "$tag" "$sha"'
  else
    ssh -i "$DEPLOY_KEY_FILE" \
      -o IdentitiesOnly=yes \
      -o BatchMode=yes \
      -o StrictHostKeyChecking=yes \
      -o UserKnownHostsFile="$DEPLOY_KNOWN_HOSTS_FILE" \
      -o ServerAliveInterval=30 \
      "deploy@$DEPLOY_HOST" deploy "$tag" "$sha"
  fi
}

for ((try = 1; try <= tries; try++)); do
  echo "deploying $tag ($sha) to the sync server, try $try of $tries"
  code=0
  git archive --format=tar "$tag" | ssh_command || code=$?
  case $code in
    0)
      echo "$tag is live on the sync server"
      exit 0
      ;;
    75)
      echo "another deploy holds the box's lock (exit 75)"
      if [ "$try" -lt "$tries" ]; then sleep "$delay"; fi
      ;;
    1)
      fail "deploy.sh failed (exit 1): the previous server release is live; the update manifests stay unpublished. deploy.sh's log is above."
      ;;
    2)
      fail "deploy.sh refused the request 'deploy $tag $sha' (exit 2)"
      ;;
    *)
      fail "the deploy ended with exit $code (255 is ssh itself: the host key, the key or the network); the update manifests stay unpublished"
      ;;
  esac
done
fail "another deploy held the box's lock on all $tries tries; the update manifests stay unpublished"
