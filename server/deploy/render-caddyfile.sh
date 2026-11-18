#!/usr/bin/env bash
# Writes the Caddyfile template ($1) to $2 with the API host from CHORD_API_HOST
# (design C5, devstation-mg6u.9): the repo names no host. bootstrap.sh renders
# through this, then validates and installs the result.
set -Eeuo pipefail
[ $# -eq 2 ] || { echo "render-caddyfile: usage: render-caddyfile.sh <template> <out>" >&2; exit 2; }
host=${CHORD_API_HOST:-}
[ -n "$host" ] || { echo "render-caddyfile: CHORD_API_HOST is not set (the API host, e.g. api.<domain>)" >&2; exit 2; }
[[ $host =~ ^[A-Za-z0-9.-]+$ ]] || { echo "render-caddyfile: CHORD_API_HOST is not a host name: $host" >&2; exit 2; }
sed "s/CHORD_API_HOST/$host/g" "$1" >"$2"
