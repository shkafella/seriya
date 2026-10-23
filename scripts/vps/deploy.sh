#!/usr/bin/env bash
# Full, rollback-safe Seriya application release. Install as /opt/<project>/deploy.sh.
set -Eeuo pipefail
export PATH="/root/.bun/bin:$PATH"

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
SOURCE_DIR="$PROJECT_ROOT/source"
RELEASES_DIR="$PROJECT_ROOT/releases"
CURRENT_LINK="$PROJECT_ROOT/current"
SHARED_DIR="$PROJECT_ROOT/shared"
SERVICE_NAME="$(basename "$PROJECT_ROOT")-backend"
PROJECT_NAME="$(basename "$PROJECT_ROOT")"
PRODUCTION_ASSET_DIR="$SHARED_DIR/catalog-assets"
PRODUCTION_ASSET_MANIFEST="$PRODUCTION_ASSET_DIR/manifest.production.v1.json"

if [ ! -d "$SOURCE_DIR/.git" ]; then
  echo "ERROR: expected the Git checkout at $SOURCE_DIR" >&2
  exit 1
fi
if [ ! -f "$SHARED_DIR/backend.env" ]; then
  echo "ERROR: missing $SHARED_DIR/backend.env" >&2
  exit 1
fi
if [ ! -f "$SHARED_DIR/website.env" ]; then
  echo "ERROR: missing $SHARED_DIR/website.env" >&2
  exit 1
fi
if [ ! -f "$SHARED_DIR/webapp.env" ]; then
  echo "ERROR: missing $SHARED_DIR/webapp.env" >&2
  exit 1
fi
exec 9>"$SHARED_DIR/release.lock"
if ! flock -n 9; then
  echo "ERROR: another deploy or recovery operation is already running" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
. "$SHARED_DIR/backend.env"
# shellcheck disable=SC1090
. "$SHARED_DIR/website.env"
# shellcheck disable=SC1090
. "$SHARED_DIR/webapp.env"
set +a
BACKEND_PORT="${PORT:-3000}"
if ! [[ "$BACKEND_PORT" =~ ^[0-9]+$ ]] || (( 10#$BACKEND_PORT < 1 || 10#$BACKEND_PORT > 65535 )); then
  echo "ERROR: PORT must be an integer from 1 to 65535" >&2
  exit 1
fi
TARGET_DATABASE="$(bun -e 'console.log(decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1)))')"
if [ -z "$TARGET_DATABASE" ] || [ "${BACKUP_DATABASE_NAME:-seriya}" != "$TARGET_DATABASE" ]; then
  echo "ERROR: BACKUP_DATABASE_NAME must exactly match the database in DATABASE_URL" >&2
  exit 1
fi
if [[ "${PUBLIC_WEBSITE_URL:-}" != https://* ]]; then
  echo "ERROR: PUBLIC_WEBSITE_URL must be the production HTTPS origin" >&2
  exit 1
fi
if [[ "${VITE_API_URL:-}" != https://* ]]; then
  echo "ERROR: VITE_API_URL must be the owner workspace HTTPS origin" >&2
  exit 1
fi
cd "$SOURCE_DIR"
RECOVERY_LOCK_HELD=true bash "$SOURCE_DIR/scripts/vps/recover-release.sh"
if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: source checkout is dirty; refusing deploy" >&2
  exit 1
fi
if [ "$(git branch --show-current)" != "main" ]; then
  echo "ERROR: deploy source must be on main" >&2
  exit 1
fi

git pull --ff-only
git fetch origin main
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  echo "ERROR: local main is not synchronized with origin/main" >&2
  exit 1
fi

mkdir -p "$RELEASES_DIR" "$SHARED_DIR"
GIT_REVISION="$(git rev-parse HEAD)"
RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)-${GIT_REVISION:0:12}"
RELEASE_DIR="$RELEASES_DIR/$RELEASE_ID"
RECEIPT="$SHARED_DIR/backup-$RELEASE_ID.json"
PREVIOUS_RELEASE=""
if [ -L "$CURRENT_LINK" ]; then PREVIOUS_RELEASE="$(readlink -f "$CURRENT_LINK")"; fi

rollback_application() {
  trap - ERR
  local recovery_args=()
  if [ -n "${CANDIDATE_ID:-}" ]; then recovery_args+=("$CANDIDATE_ID"); fi
  if ! RECOVERY_LOCK_HELD=true bash "$SOURCE_DIR/scripts/vps/recover-release.sh" "${recovery_args[@]}"; then
    echo "ERROR: automatic recovery did not finish; catalog remains closed for operator recovery" >&2
  fi
}

wait_for_release_ready() {
  local expected_release="$1"
  local response=""
  for _ in $(seq 1 30); do
    if response="$(curl -fsS --connect-timeout 2 --max-time 3 "http://127.0.0.1:$BACKEND_PORT/health/ready" 2>/dev/null)" \
      && grep -F "$expected_release" <<<"$response" >/dev/null; then
      return 0
    fi
    sleep 1
  done
  echo "ERROR: backend did not become ready for release $expected_release" >&2
  return 1
}
trap 'echo "ERROR: deployment failed; restoring previous complete release" >&2; rollback_application' ERR

echo "==> Verified backup before migration"
(cd "$SOURCE_DIR" && docker compose up -d postgres)
BACKUP_PROJECT_NAME="$PROJECT_NAME" PROJECT_ROOT="$SOURCE_DIR" BACKUP_RECEIPT_PATH="$RECEIPT" "$SOURCE_DIR/scripts/vps/db-backup.sh"
bun "$SOURCE_DIR/scripts/vps/verify-backup-receipt.ts" "$RECEIPT" "/var/backups/$PROJECT_NAME" "$TARGET_DATABASE"

echo "==> Assembling immutable release $RELEASE_ID"
mkdir "$RELEASE_DIR"
git archive HEAD | tar -x -C "$RELEASE_DIR"
install -m 600 "$SHARED_DIR/backend.env" "$RELEASE_DIR/backend/.env"
install -m 600 "$SHARED_DIR/webapp.env" "$RELEASE_DIR/webapp/.env"
install -m 600 "$SHARED_DIR/website.env" "$RELEASE_DIR/website/.env"

cd "$RELEASE_DIR"
bun install --frozen-lockfile
(cd backend && bun run prisma:deploy && bun run prisma:generate)

echo "==> Importing approved catalog package"
(cd backend && bun run catalog:preview && bun run catalog:apply)
if [ ! -f "$PRODUCTION_ASSET_MANIFEST" ]; then
  echo "ERROR: production asset manifest is missing: $PRODUCTION_ASSET_MANIFEST" >&2
  exit 1
fi
bun "$RELEASE_DIR/backend/scripts/catalog-asset-package.ts" \
  "$PRODUCTION_ASSET_MANIFEST" "$PRODUCTION_ASSET_DIR" "$RELEASE_DIR/website/public/catalog"
(cd backend && bun run catalog:assets sync "$RELEASE_DIR/website/public/catalog/manifest.production.v1.json")
(cd backend && bun run catalog:assets check-production "$RELEASE_DIR/website/public/catalog/manifest.production.v1.json")
(cd backend && bun run catalog:release prepare "$RELEASE_DIR/candidate.json")
CANDIDATE_ID="$(sed -n 's/.*"candidateId": "\([^"]*\)".*/\1/p' "$RELEASE_DIR/candidate.json")"
APP_RELEASE_ID="$(sed -n 's/.*"releaseId": "\([^"]*\)".*/\1/p' "$RELEASE_DIR/candidate.json")"
test -n "$CANDIDATE_ID"
test -n "$APP_RELEASE_ID"
printf '\nRELEASE_ID=%s\n' "$APP_RELEASE_ID" >>"$RELEASE_DIR/backend/.env"
(cd backend && bun run catalog:release export "$CANDIDATE_ID" "$RELEASE_DIR/website/src/data/catalog.public.v1.json")

echo "==> Building backend and both frontends"
bun run build:backend
bun run build:webapp
bun run build:website
grep -R -F "$VITE_API_URL" "$RELEASE_DIR/webapp/dist" >/dev/null || {
  echo "ERROR: owner workspace build does not contain VITE_API_URL" >&2
  exit 1
}
find backend webapp/dist website/dist website/public/catalog -type f -print0 | sort -z | xargs -0 sha256sum >"$RELEASE_DIR/release-files.sha256"
printf '{"releaseId":"%s","releaseDirectory":"%s","gitRevision":"%s","candidateId":"%s"}\n' "$APP_RELEASE_ID" "$RELEASE_ID" "$GIT_REVISION" "$CANDIDATE_ID" >"$RELEASE_DIR/release-manifest.json"

echo "==> Persisting activation intent and closing catalog reads"
(cd backend && CATALOG_REQUIRE_PRODUCTION_ASSETS=true bun run catalog:release begin "$CANDIDATE_ID" "$RECEIPT" "$RELEASE_DIR" "$PREVIOUS_RELEASE")

echo "==> Switching complete application release"
ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"
systemctl restart "$SERVICE_NAME"
wait_for_release_ready "$APP_RELEASE_ID"
(cd "$CURRENT_LINK/backend" && bun run catalog:release mark-application "$CANDIDATE_ID" "$RELEASE_DIR")

echo "==> Activating the matching immutable publication"
(cd "$CURRENT_LINK/backend" && CATALOG_REQUIRE_PRODUCTION_ASSETS=true bun run catalog:release activate "$CANDIDATE_ID" "$RECEIPT" "$RELEASE_DIR" "$PREVIOUS_RELEASE")
curl -fsS --proto '=https' "$PUBLIC_WEBSITE_URL/api/catalog/_release-smoke/$CANDIDATE_ID" | grep -F "$APP_RELEASE_ID" >/dev/null
curl -fsS --proto '=https' "$PUBLIC_WEBSITE_URL/" >/dev/null
curl -fsS --proto '=https' "$PUBLIC_WEBSITE_URL/catalog/" | grep -F "$APP_RELEASE_ID" >/dev/null
curl -fsS --proto '=https' "$VITE_API_URL/" >/dev/null
test "$(curl -sS -o /dev/null -w '%{http_code}' --proto '=https' "$VITE_API_URL/api/auth/me")" = "401"
grep -F "$APP_RELEASE_ID" "$CURRENT_LINK/release-manifest.json" >/dev/null
(cd "$CURRENT_LINK/backend" && bun run catalog:release verify "$CANDIDATE_ID" "$RELEASE_DIR")
curl -fsS --proto '=https' "$PUBLIC_WEBSITE_URL/api/catalog" | grep -F "$APP_RELEASE_ID" >/dev/null

trap - ERR
echo "OK: release $APP_RELEASE_ID is active from $RELEASE_DIR"
