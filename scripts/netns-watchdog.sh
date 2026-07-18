#!/bin/sh
# Watches the tailscale sidecar for restarts and restarts `app` in response.
#
# `app` joins tailscale's network namespace via `network_mode: service:tailscale`,
# but that join only happens once, at app's own container start. If tailscale
# restarts in place (crash, OOM, `restart: always`), it gets a fresh network
# namespace and app is left bound to the old, orphaned one — silently unreachable
# even though both containers report "running". Restarting app re-joins whatever
# namespace tailscale currently has.
set -eu

# PROJECT must be pinned (via the PROJECT_NAME env var) rather than discovered
# from running containers — the docker.sock this reads from is host-wide, and
# other compose projects on the same host may run their own service also
# labeled "tailscale", which a label-only lookup would match by mistake.
: "${PROJECT_NAME:?PROJECT_NAME env var must be set}"
PROJECT="$PROJECT_NAME"

echo "netns-watchdog: watching for tailscale restarts (project=$PROJECT)"

docker events --filter 'event=restart' \
  --filter "label=com.docker.compose.service=tailscale" \
  --filter "label=com.docker.compose.project=$PROJECT" \
  --format '{{.Actor.Attributes.name}}' |
while read -r _; do
  APP_CID=$(docker ps -q --filter "label=com.docker.compose.service=app" --filter "label=com.docker.compose.project=$PROJECT")
  if [ -n "$APP_CID" ]; then
    echo "netns-watchdog: tailscale restarted, restarting app ($APP_CID) to rejoin its network namespace"
    docker restart "$APP_CID"
  else
    echo "netns-watchdog: tailscale restarted but no app container found to restart"
  fi
done
