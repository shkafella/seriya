#!/usr/bin/env bash
# Restore a persisted, interrupted catalog/application switch. Safe to run when no recovery is pending.
set -Eeuo pipefail
export PATH="/root/.bun/bin:$PATH"

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
if [ "$(basename "$PROJECT_ROOT")" = "source" ]; then PROJECT_ROOT="$(dirname "$PROJECT_ROOT")"; fi
SOURCE_DIR="$PROJECT_ROOT/source"
CURRENT_LINK="$PROJECT_ROOT/current"
SHARED_DIR="$PROJECT_ROOT/shared"
RELEASES_DIR="$PROJECT_ROOT/releases"
SERVICE_NAME="$(basename "$PROJECT_ROOT")-backend"
REQUESTED_CANDIDATE_ID="${1:-}"

if [ ! -f "$SHARED_DIR/backend.env" ] || [ ! -d "$RELEASES_DIR" ]; then exit 0; fi
if [ "${RECOVERY_LOCK_HELD:-false}" != "true" ]; then
  exec 9>"$SHARED_DIR/release.lock"
  if ! flock -n 9; then
    echo "ERROR: another deploy or recovery operation is already running" >&2
    exit 1
  fi
fi
set -a
# shellcheck disable=SC1090
. "$SHARED_DIR/backend.env"
set +a

# Recovery must run from an immutable release: source/ never receives the locked
# dependencies or generated Prisma client. The newest assembled release always
# exists before an activation attempt is persisted.
RUNTIME_RELEASE=""
while IFS= read -r candidate; do
  if [ -d "$candidate/node_modules" ] \
    && [ -f "$candidate/release-manifest.json" ] \
    && [ -f "$candidate/backend/src/generated/prisma/client.ts" ] \
    && [ -f "$candidate/webapp/dist/index.html" ] \
    && [ -f "$candidate/website/dist/index.html" ]; then
    RUNTIME_RELEASE="$candidate"
    break
  fi
done < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -print | sort -r)
if [ -z "$RUNTIME_RELEASE" ]; then
  if [ ! -L "$CURRENT_LINK" ]; then
    echo "No complete release exists yet; there is no interrupted activation to recover."
    exit 0
  fi
  echo "ERROR: no prepared immutable runtime is available for release recovery" >&2
  exit 1
fi

PLAN=""
for _ in $(seq 1 30); do
  if [ -n "$REQUESTED_CANDIDATE_ID" ]; then
    PLAN="$(cd "$RUNTIME_RELEASE/backend" && bun run catalog:release recovery-plan "$REQUESTED_CANDIDATE_ID" 2>/dev/null)" && break
  elif PLAN="$(cd "$RUNTIME_RELEASE/backend" && bun run catalog:release recovery-plan 2>/dev/null)"; then
    break
  fi
  sleep 2
done
if [ -z "$PLAN" ]; then
  echo "ERROR: could not read persisted release recovery state" >&2
  exit 1
fi
CANDIDATE_ID="$(printf '%s\n' "$PLAN" | sed -n 's/.*"candidateId":"\([^"]*\)".*/\1/p')"
PREVIOUS_RELEASE="$(printf '%s\n' "$PLAN" | sed -n 's/.*"previousReleasePath":"\([^"]*\)".*/\1/p')"
if [ -z "$CANDIDATE_ID" ]; then exit 0; fi

(cd "$RUNTIME_RELEASE/backend" && bun run catalog:release start-recovery "$CANDIDATE_ID")
systemctl stop "$SERVICE_NAME" || true
if [ -n "$PREVIOUS_RELEASE" ] && [ -d "$PREVIOUS_RELEASE" ]; then
  ln -sfn "$PREVIOUS_RELEASE" "$CURRENT_LINK"
elif [ -L "$CURRENT_LINK" ]; then
  unlink "$CURRENT_LINK"
fi
if [ -n "$PREVIOUS_RELEASE" ] && [ -d "$PREVIOUS_RELEASE" ]; then
  systemctl start "$SERVICE_NAME"
  PREVIOUS_RELEASE_ID="$(sed -n 's/.*"releaseId":"\([^"]*\)".*/\1/p' "$PREVIOUS_RELEASE/release-manifest.json")"
  test -n "$PREVIOUS_RELEASE_ID"
  RESPONSE=""
  READY="false"
  for _ in $(seq 1 30); do
    if RESPONSE="$(curl -fsS --connect-timeout 2 --max-time 3 http://127.0.0.1:3000/health/ready 2>/dev/null)" \
      && grep -F "$PREVIOUS_RELEASE_ID" <<<"$RESPONSE" >/dev/null; then
      READY="true"
      break
    fi
    sleep 1
  done
  if [ "$READY" != "true" ]; then
    echo "ERROR: restored backend did not become ready for release $PREVIOUS_RELEASE_ID" >&2
    exit 1
  fi
fi
(cd "$RUNTIME_RELEASE/backend" && bun run catalog:release recover "$CANDIDATE_ID")
echo "Recovered interrupted release for candidate $CANDIDATE_ID"
