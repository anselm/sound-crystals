#!/usr/bin/env bash
# Push Sound Crystals to its exe.dev VM. Manual override — normally autodeploy
# (push to GitHub main) does this for you. No build step: the repo IS the site;
# we rsync the working tree minus dev cruft.
# Usage: deploy/deploy.sh [vm-name]         (default: crystals)
set -euo pipefail

VM="${1:-${VM:-crystals}}"
HOST="$VM.exe.xyz"
DEST="exedev@$HOST"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

SSH="ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ServerAliveInterval=5 -o ServerAliveCountMax=3"

echo "› syncing → $HOST:/srv/site"
rsync -avh --delete -e "$SSH" \
  --exclude '.git' --exclude 'node_modules' --exclude 'deploy' --exclude 'scripts' \
  "$ROOT/" "$DEST:/srv/site/"

echo "✓ deployed → https://$HOST"
