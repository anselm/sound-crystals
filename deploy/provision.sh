#!/usr/bin/env bash
# One-time provisioning for the Sound Crystals VM on exe.dev. Idempotent — safe
# to re-run; it just (re)starts Caddy. Creating the VM and making it PUBLIC are
# separate steps (gateway SSH from this box):
#   ssh -o ServerAliveInterval=5 exe.dev new --name crystals
#   deploy/provision.sh crystals
#   ssh -o ServerAliveInterval=5 exe.dev share port crystals 8000
#   ssh -o ServerAliveInterval=5 exe.dev share set-public crystals
# Usage: deploy/provision.sh [vm-name]      (default: crystals)
set -euo pipefail

VM="${1:-${VM:-crystals}}"
HOST="$VM.exe.xyz"
DEST="exedev@$HOST"
HERE="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-8000}"

SSH="ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ServerAliveInterval=5 -o ServerAliveCountMax=3"

echo "› ensuring /srv on $HOST"
$SSH "$DEST" 'sudo mkdir -p /srv/site && sudo chown -R "$(id -un)":"$(id -gn)" /srv'

echo "› uploading Caddyfile"
rsync -e "$SSH" "$HERE/Caddyfile" "$DEST:/srv/Caddyfile"

echo "› enabling docker at boot + (re)starting Caddy on :$PORT"
$SSH "$DEST" "sudo systemctl enable --now docker >/dev/null 2>&1; \
  docker rm -f crystals 2>/dev/null || true; \
  docker run -d --name crystals --restart unless-stopped \
    -p $PORT:80 \
    -v /srv/site:/srv/site:ro \
    -v /srv/Caddyfile:/etc/caddy/Caddyfile:ro \
    caddy:2"

echo "✓ provisioned ($HOST). Make it public (see header), then deploy/deploy.sh $VM."
