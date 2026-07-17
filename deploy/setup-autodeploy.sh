#!/usr/bin/env bash
# One-time installer for on-VM continuous deployment. Run from the repo root:
#   deploy/setup-autodeploy.sh [vm-name]      (default: crystals)
# After this, the VM polls GitHub main every ~2 minutes; pushing to main IS the
# deploy. deploy/deploy.sh remains a manual override.
set -euo pipefail

VM="${1:-${VM:-crystals}}"
HOST="$VM.exe.xyz"
DEST="exedev@$HOST"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ServerAliveInterval=5 -o ServerAliveCountMax=3)
SSH() { ssh "${SSH_OPTS[@]}" "$DEST" "$@"; }

echo "› installing git + rsync on $HOST"
SSH 'sudo apt-get install -y -q git rsync'

echo "› creating /srv/autodeploy and uploading the deployer"
SSH 'sudo mkdir -p /srv/autodeploy && sudo chown exedev:exedev /srv/autodeploy'
rsync -e "ssh ${SSH_OPTS[*]}" -avh "$ROOT/deploy/autodeploy.sh" "$DEST:/srv/autodeploy/autodeploy.sh"
SSH 'chmod +x /srv/autodeploy/autodeploy.sh'

echo "› installing systemd service + timer"
SSH 'sudo tee /etc/systemd/system/crystals-autodeploy.service >/dev/null' <<'UNIT'
[Unit]
Description=Sound Crystals — redeploy when GitHub main changes
After=network-online.target

[Service]
Type=oneshot
User=exedev
ExecStart=/srv/autodeploy/autodeploy.sh
UNIT

SSH 'sudo tee /etc/systemd/system/crystals-autodeploy.timer >/dev/null' <<'UNIT'
[Unit]
Description=Poll GitHub main for Sound Crystals deploys

[Timer]
OnBootSec=1min
OnUnitInactiveSec=2min

[Install]
WantedBy=timers.target
UNIT

SSH 'sudo systemctl daemon-reload && sudo systemctl enable --now crystals-autodeploy.timer'

echo "› first run (deploys current main now)"
SSH 'sudo systemctl start crystals-autodeploy.service'

echo "✓ auto-deploy installed. Watch: ssh $DEST journalctl -u crystals-autodeploy -f"
