#!/usr/bin/env bash
# Runs ON the crystals VM (installed by deploy/setup-autodeploy.sh, fired by a
# systemd timer). Polls GitHub main; when the SHA moves, pulls and syncs into
# /srv/site — Caddy picks the new files up at once. No build step: the repo IS
# the site (orbital-volume is vendored in-tree).
set -euo pipefail

REPO_URL="https://github.com/anselm/sound-crystals.git"
BRANCH="main"
BASE="/srv/autodeploy"
REPO="$BASE/repo"
STATE="$BASE/deployed-sha"
DEST="/srv/site"

remote_sha="$(git ls-remote "$REPO_URL" "refs/heads/$BRANCH" | cut -f1)"
[ -n "$remote_sha" ] || { echo "could not read $BRANCH from $REPO_URL"; exit 1; }
deployed="$(cat "$STATE" 2>/dev/null || echo none)"
[ "$remote_sha" = "$deployed" ] && exit 0   # nothing new — the common case

echo "› main moved: $deployed -> $remote_sha"

if [ ! -d "$REPO/.git" ]; then
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$REPO"
fi
git -C "$REPO" fetch --depth 1 origin "$BRANCH"
git -C "$REPO" reset --hard FETCH_HEAD
git -C "$REPO" clean -fd

echo "› sync -> $DEST"
rsync -a --delete \
  --exclude '.git' --exclude 'node_modules' --exclude 'deploy' --exclude 'scripts' \
  "$REPO/" "$DEST"/

printf '{"sha":"%s","at":"%s"}\n' "$remote_sha" "$(date -u +%Y-%m-%dT%H:%MZ)" > "$DEST/version.json"

echo "$remote_sha" > "$STATE"
echo "✓ deployed $remote_sha"
