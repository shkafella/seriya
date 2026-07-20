#!/usr/bin/env bash
# One-command production deploy. Install as /opt/<project>/deploy.sh on the
# server (chmod +x). The systemd backend service must be named
# "<project>-backend" where <project> is the folder name under /opt.
set -euo pipefail
export PATH="/root/.bun/bin:$PATH"

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_DIR"

echo "==> Pulling main"
git pull --ff-only

echo "==> Installing dependencies"
bun install --frozen-lockfile

echo "==> Starting PostgreSQL"
docker compose up -d postgres

echo "==> Applying database migrations"
(cd backend && bun run prisma:deploy && bun run prisma:generate)

echo "==> Building webapp"
bun run build:webapp

# Uncomment when the public website surface is active:
# echo "==> Building website"
# bun run build:website

echo "==> Restarting backend"
systemctl restart "$(basename "$APP_DIR")-backend"

echo "==> Health check"
sleep 2
curl -fsS http://127.0.0.1:3000/health/ready >/dev/null
echo "OK: backend is ready"
