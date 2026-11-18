#!/usr/bin/env bash
# Makes an Ubuntu 24.04 box ready to run the sync server (design C5,
# devstation-5s42). Run as root, from a checkout or an archive that has this
# folder and the repo's .nvmrc:
#
#   git archive HEAD .nvmrc server/deploy | ssh root@<host> \
#     'rm -rf /tmp/chord-bootstrap && mkdir /tmp/chord-bootstrap && tar -x -C /tmp/chord-bootstrap \
#      && bash /tmp/chord-bootstrap/server/deploy/bootstrap.sh "<deploy public key>"'
#
# Idempotent: every step checks before it acts, and the last line counts what
# changed ("bootstrap: changed 0" on a box that is already right). The deploy
# public key is needed once; later runs reuse the one installed.
#
# What it sets up:
#   - Caddy from its signed apt repo, with ./Caddyfile
#   - Node at .nvmrc's version from nodejs.org (SHA-256 checked) in
#     /opt/node-v<ver>, linked at /opt/node; corepack's pnpm shim beside it
#   - users: chord (runs the server, no login) and deploy (its key may only run
#     /opt/chord/bin/deploy.sh: forced command + restrict)
#   - /opt/chord (root:deploy, sticky: deploy flips `current` but cannot replace
#     bin/), releases/, shared/ (.env, release.env, deploy.log), shared/hocuspocus
#   - ./deploy.sh at /opt/chord/bin/deploy.sh, ./chord-sync.service, and the
#     sudoers line letting deploy restart that one unit
# The server starts once /opt/chord/shared/.env exists and a release is live
# (deploy.sh). .env is provided by the operator (design F19), never by a repo.
set -Eeuo pipefail
trap 'echo "bootstrap: failed at line $LINENO" >&2' ERR

[ "$(id -u)" = 0 ] || { echo "bootstrap: run as root" >&2; exit 2; }
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
nvmrc=$here/../../.nvmrc
[ -f "$nvmrc" ] || { echo "bootstrap: $nvmrc missing; archive .nvmrc with server/deploy" >&2; exit 2; }
node_version=$(tr -d ' \r\n' <"$nvmrc")
[[ $node_version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "bootstrap: .nvmrc is not X.Y.Z" >&2; exit 2; }

changed=0
note() { echo "bootstrap: $*"; changed=$((changed + 1)); }

# Installs $1 at $2 with mode $3 and owner $4 when the content or metadata differ.
install_file() {
  local src=$1 dst=$2 mode=$3 owner=$4
  if [ -f "$dst" ] && cmp -s "$src" "$dst" &&
    [ "$(stat -c '%a %U:%G' "$dst")" = "$mode $owner" ]; then
    return 1
  fi
  install -D -m "$mode" -o "${owner%%:*}" -g "${owner##*:}" "$src" "$dst"
  note "installed $dst"
}

ensure_dir() {
  local dir=$1 mode=$2 owner=$3
  if [ -d "$dir" ] && [ "$(stat -c '%a %U:%G' "$dir")" = "$mode $owner" ]; then return 0; fi
  install -d -m "$mode" -o "${owner%%:*}" -g "${owner##*:}" "$dir"
  note "directory $dir"
}

# --- packages ---------------------------------------------------------------
export DEBIAN_FRONTEND=noninteractive
caddy_keyring=/usr/share/keyrings/caddy-stable-archive-keyring.gpg
caddy_list=/etc/apt/sources.list.d/caddy-stable.list
if [ ! -f "$caddy_keyring" ] || [ ! -f "$caddy_list" ]; then
  apt-get update -q
  apt-get install -y -q debian-keyring debian-archive-keyring apt-transport-https curl gnupg xz-utils
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --batch --yes --dearmor -o "$caddy_keyring"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' >"$caddy_list"
  chmod o+r "$caddy_keyring" "$caddy_list"
  note "caddy apt repo"
fi
if ! dpkg -s caddy >/dev/null 2>&1; then
  apt-get update -q
  apt-get install -y -q caddy
  note "caddy installed"
fi

# --- node and pnpm ----------------------------------------------------------
node_dir=/opt/node-v$node_version
if [ ! -x "$node_dir/bin/node" ]; then
  arch=linux-x64
  tarball=node-v$node_version-$arch.tar.xz
  work=$(mktemp -d)
  curl -fsSL "https://nodejs.org/dist/v$node_version/$tarball" -o "$work/$tarball"
  curl -fsSL "https://nodejs.org/dist/v$node_version/SHASUMS256.txt" -o "$work/SHASUMS256.txt"
  (cd "$work" && grep " $tarball\$" SHASUMS256.txt | sha256sum -c -)
  mkdir -p "$node_dir"
  tar -xJf "$work/$tarball" -C "$node_dir" --strip-components=1
  rm -rf "$work"
  note "node $node_version in $node_dir"
fi
if [ "$(readlink /opt/node 2>/dev/null || true)" != "$node_dir" ]; then
  ln -sfn "$node_dir" /opt/node.tmp
  mv -T /opt/node.tmp /opt/node
  note "/opt/node -> $node_dir"
fi
if [ ! -e "$node_dir/bin/pnpm" ]; then
  "$node_dir/bin/corepack" enable --install-directory "$node_dir/bin" pnpm
  note "corepack pnpm shim"
fi

# --- users ------------------------------------------------------------------
if ! id -u chord >/dev/null 2>&1; then
  useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin chord
  note "user chord"
fi
if ! id -u deploy >/dev/null 2>&1; then
  # A real shell: sshd runs the forced command through it.
  useradd --system --create-home --shell /bin/bash deploy
  note "user deploy"
fi
# deploy reads shared/.env (group chord) to migrate.
if ! id -nG deploy | tr ' ' '\n' | grep -qx chord; then
  usermod -aG chord deploy
  note "deploy in group chord"
fi

# --- layout -----------------------------------------------------------------
ensure_dir /opt/chord 1775 root:deploy
ensure_dir /opt/chord/bin 755 root:root
ensure_dir /opt/chord/releases 755 deploy:deploy
ensure_dir /opt/chord/shared 2750 deploy:chord
ensure_dir /opt/chord/shared/hocuspocus 2770 chord:chord
if [ -f /opt/chord/shared/.env ]; then
  if [ "$(stat -c '%a %U:%G' /opt/chord/shared/.env)" != "640 root:chord" ]; then
    chown root:chord /opt/chord/shared/.env
    chmod 640 /opt/chord/shared/.env
    note "/opt/chord/shared/.env is root:chord 640"
  fi
  # The unit sets these: Caddy owns 1235 and the process listens behind it.
  if grep -Eq '^(PORT|HOCUSPOCUS_PORT|NODE_ENV)=' /opt/chord/shared/.env; then
    echo "bootstrap: remove PORT, HOCUSPOCUS_PORT and NODE_ENV from /opt/chord/shared/.env; the unit sets them" >&2
    exit 1
  fi
fi

# --- files from this folder -------------------------------------------------
install_file "$here/deploy.sh" /opt/chord/bin/deploy.sh 755 root:root || true

sudoers_tmp=$(mktemp)
cp "$here/sudoers-chord-deploy" "$sudoers_tmp"
visudo -cqf "$sudoers_tmp"
install_file "$sudoers_tmp" /etc/sudoers.d/chord-deploy 440 root:root || true
rm -f "$sudoers_tmp"

key=${1:-}
keys=/home/deploy/.ssh/authorized_keys
if [ -n "$key" ]; then
  [[ $key =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+(\ [^\"]*)?$ ]] || { echo "bootstrap: the deploy key must be one ssh-ed25519 public key" >&2; exit 2; }
  keys_tmp=$(mktemp)
  printf 'command="/opt/chord/bin/deploy.sh",restrict %s\n' "$key" >"$keys_tmp"
  install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
  install_file "$keys_tmp" "$keys" 600 deploy:deploy || true
  rm -f "$keys_tmp"
elif [ ! -s "$keys" ]; then
  echo "bootstrap: pass the deploy public key on the first run" >&2
  exit 2
fi

if install_file "$here/chord-sync.service" /etc/systemd/system/chord-sync.service 644 root:root; then
  systemctl daemon-reload
fi
if ! systemctl is-enabled --quiet chord-sync.service 2>/dev/null; then
  systemctl enable chord-sync.service
  note "chord-sync enabled"
fi

caddy_new=$(mktemp)
cp "$here/Caddyfile" "$caddy_new"
caddy validate --adapter caddyfile --config "$caddy_new" >/dev/null 2>&1 ||
  { caddy validate --adapter caddyfile --config "$caddy_new"; exit 1; }
if install_file "$caddy_new" /etc/caddy/Caddyfile 644 root:root; then
  systemctl reload-or-restart caddy
fi
rm -f "$caddy_new"
if ! systemctl is-active --quiet caddy; then
  systemctl enable --now caddy
  note "caddy started"
fi

if [ ! -f /opt/chord/shared/.env ]; then
  echo "bootstrap: waiting for /opt/chord/shared/.env (operator) before the first deploy"
elif [ ! -L /opt/chord/current ]; then
  echo "bootstrap: ready for the first deploy (deploy.sh)"
fi
echo "bootstrap: changed $changed"
