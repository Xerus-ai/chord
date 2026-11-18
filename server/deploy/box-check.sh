#!/usr/bin/env bash
# The live check of the sync server box (design C5, devstation-5s42), run from
# an operator's machine after bootstrap and a deploy. Prints one line per check
# and exits non-zero when any fails; its output is the deploy's receipt.
#
#   box-check.sh <host> <domain> <tag> <root-key> <deploy-key>
#
# Checks:
#   1. https://<domain>/health answers with version == <tag> (Caddy, cert, the
#      service and the release all at once).
#   2. chord-sync and caddy are active.
#   3. bootstrap.sh run again changes nothing (it is idempotent).
#   4. The deploy key gets no shell: `bash`, an interactive login and a command
#      smuggled after a valid request are all refused by the forced command.
set -Eeuo pipefail

if [ "$#" -ne 5 ]; then
  echo "usage: box-check.sh <host> <domain> <tag> <root-key> <deploy-key>" >&2
  exit 2
fi
host=$1 domain=$2 tag=$3 root_key=$4 deploy_key=$5
ssh_opts=(-o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15)
failures=0

check() {
  local name=$1 ok=$2 detail=$3
  if [ "$ok" = yes ]; then
    echo "PASS $name: $detail"
  else
    echo "FAIL $name: $detail"
    failures=$((failures + 1))
  fi
}

# 1. Health over the public name.
body=$(curl -fsS --max-time 15 "https://$domain/health" 2>&1) || body="unreachable: $body"
version=$(printf '%s' "$body" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')
[ "$version" = "$tag" ] && ok=yes || ok=no
check health "$ok" "$body"

# 2. Services.
states=$(ssh "${ssh_opts[@]}" -i "$root_key" "root@$host" 'systemctl is-active chord-sync caddy' 2>&1 | tr '\n' ' ') || true
[ "$states" = "active active " ] && ok=yes || ok=no
check services "$ok" "chord-sync caddy: $states"

# 3. Bootstrap is idempotent: a second run reports nothing changed.
summary=$(ssh "${ssh_opts[@]}" -i "$root_key" "root@$host" \
  "CHORD_API_HOST=$(printf %q "$domain") bash /opt/chord/current/server/deploy/bootstrap.sh 2>&1 | tail -1") || summary="bootstrap failed: $summary"
[ "$summary" = "bootstrap: changed 0" ] && ok=yes || ok=no
check bootstrap-idempotent "$ok" "$summary"

# 4. The deploy key cannot get a shell.
for request in bash "" "deploy $tag $(printf 'c%.0s' {1..40}); id"; do
  set +e
  out=$(ssh "${ssh_opts[@]}" -T -i "$deploy_key" "deploy@$host" "$request" </dev/null 2>&1)
  code=$?
  set -e
  [ "$code" = 2 ] && ok=yes || ok=no
  check "deploy-key-refuses '${request:-<login>}'" "$ok" "exit $code: $(printf '%s' "$out" | tail -1)"
done

echo "box-check: $failures failed"
[ "$failures" = 0 ]
