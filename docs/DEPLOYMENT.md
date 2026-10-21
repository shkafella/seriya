# Deployment: a rented VPS, turnkey

This is the production path for this template: one self-managed VPS (a rented virtual server), set up end to end by the AI agent. There are no cloud app platforms or managed dashboards here — the agent receives server access from the user and does everything itself over SSH.

The runbook is proven: it mirrors a production setup that has been running a real course platform since June 2026.

## What the agent needs from the user

1. **Server access**: IP address, login (usually `root`), password. Recommended baseline: Ubuntu 24.04 LTS, 2+ cores, 2+ GB RAM, 20+ GB disk.
2. **A domain name** (can arrive later): ask the user to register one at any registrar and point an `A` record at the server IP. Until the domain exists, the project can run temporarily by IP over HTTP (degraded mode, see below).

Rules that always apply:

- The server password is used exactly once — to install the SSH key. It is never written to any file, note, or commit. After hardening, password login is disabled.
- All production secrets live only in `.env` files on the server (mode `600`). Never in git.
- Do not skip the hardening steps. A fresh VPS with password auth gets scanned and brute-forced within hours of boot.

## Step 1 — first login and immediate hardening

```bash
# From the user's machine: create a key if none exists, then install it.
ssh-keygen -t ed25519 -f ~/.ssh/<project> -N ""
ssh-copy-id -i ~/.ssh/<project>.pub root@<SERVER_IP>   # the only password use
```

On the server:

```bash
apt update && apt -y upgrade
timedatectl set-timezone <user's timezone>

# SSH: keys only. Install the drop-in, then VERIFY key login from a SECOND
# terminal before closing the current session.
install -m 600 /dev/stdin /etc/ssh/sshd_config.d/99-hardening.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
systemctl reload ssh

# Firewall: only SSH, HTTP, HTTPS are reachable from outside.
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable

# Ban SSH brute-force attempts. Ubuntu 24.04 has no auth.log by default,
# so fail2ban must read the systemd journal.
apt -y install fail2ban
install -m 644 /dev/stdin /etc/fail2ban/jail.local <<'EOF'
[sshd]
enabled = true
backend = systemd
EOF
systemctl enable --now fail2ban

# Automatic security updates.
apt -y install unattended-upgrades

# Swap: protects small servers from out-of-memory kills during builds.
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf && sysctl --system
```

## Step 2 — runtime stack

```bash
apt -y install nginx git unzip certbot python3-certbot-nginx
curl -fsSL https://get.docker.com | sh
curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.14"   # match .bun-version
```

Bun installs to `/root/.bun/bin/bun`; the systemd units below use that absolute path.

## Step 3 — code and secrets

```bash
# Read-only deploy key: the server can pull code but can never push.
ssh-keygen -t ed25519 -f /root/.ssh/github_deploy -N ""
cat /root/.ssh/github_deploy.pub
# -> add this as a Deploy Key (read-only) in the GitHub repo settings.
install -m 600 /dev/stdin /root/.ssh/config <<'EOF'
Host github.com
  IdentityFile /root/.ssh/github_deploy
EOF

mkdir -p /opt/<project>/{shared,releases}
git clone git@github.com:<owner>/<repo>.git /opt/<project>/source
```

Create production env files on the server (never commit them):

- `/opt/<project>/source/docker-compose.override.yml` — **critical security point**:

  ```yaml
  services:
    postgres:
      ports: !override
        - "127.0.0.1:54329:5432"
      environment:
        POSTGRES_PASSWORD: "<strong generated password>"
  ```

  The `!override` tag is mandatory. Without it Docker Compose *merges* port lists and PostgreSQL stays exposed to the whole internet on `0.0.0.0`. Set the strong password **before** the first `docker compose up`, because the database volume keeps the password it was initialized with.

- `/opt/<project>/shared/backend.env` (mode `600`):

  ```bash
  NODE_ENV=production
  COOKIE_SECURE=true
  JWT_SECRET=<output of: openssl rand -hex 32>
  CORS_ORIGINS=https://<domain>,https://<app-domain>
  DATABASE_URL=postgresql://superuser:<strong password>@localhost:54329/seriya?schema=public
  BACKUP_DATABASE_NAME=seriya
  BACKUP_DATABASE_USER=superuser
  TRUST_PROXY=true
  TRUSTED_PROXY_CLIENT_IP_HEADER=X-Real-IP
  AUTH_REGISTRATION_ENABLED=false
  ```

- `/opt/<project>/shared/webapp.env`: `VITE_API_URL=https://<app-domain>` (required and baked in at build time). Deployment stops before migration if this file or HTTPS origin is missing, confirms that the origin is present in the built bundle, and smoke-tests the owner host plus its authenticated API route before verifying the release.
- `/opt/<project>/shared/website.env`: `PUBLIC_WEBSITE_URL=https://<domain>`.
- `/opt/<project>/shared/catalog-assets/manifest.production.v1.json` plus every content-hashed file referenced by it. The deployment verifies file checksums, source provenance, rights approval, full family coverage, and the matching database records. Development schematics are never synchronized over approved production assets.

Bootstrap the only owner from the server environment after the first migration. Do not put these values in a file or shell history:

```bash
set -a
. /opt/<project>/shared/backend.env
set +a
cd /opt/<project>/current/backend
OWNER_EMAIL='<owner email>' OWNER_PASSWORD='<temporary strong password>' bun run catalog:owner -- bootstrap
```

The recovery form of this command rotates the password and revokes every owner session.

## Step 4 — domain and HTTPS

1. Ask the user to register a domain and create an `A` record pointing at the server IP. Explain where to click at their registrar in plain words.
2. Wait until `dig +short <domain>` returns the server IP (propagation can take minutes to hours).
3. Install the nginx site (below) for the domain, then obtain the certificate:

   ```bash
   certbot --nginx -d <domain>
   certbot renew --dry-run   # verify auto-renewal; certbot.timer handles the rest
   ```

**No domain yet?** Run temporarily by IP: nginx serves plain HTTP, and `backend/.env` uses `NODE_ENV=development`, `COOKIE_SECURE=false`, `CORS_ORIGINS=http://<SERVER_IP>`. This is a degraded, temporary mode — auth cookies are not secure without HTTPS. Switch to the production values the moment the domain works, then rebuild the webapp (its API URL is baked at build time).

## Step 5 — nginx

`/etc/nginx/sites-available/<domain>` (symlink into `sites-enabled`, remove `default`; a ready-made template is in `scripts/vps/nginx-site.conf.example`):

```nginx
server {
    listen 80;
    server_name <domain>;

    root /opt/<project>/current/website/dist;
    index index.html;
    client_max_body_size 10m;

    location / {
        try_files $uri /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Certbot rewrites this block for HTTPS and adds the HTTP→HTTPS redirect itself.

The checked-in nginx template also serves the owner webapp from a separate protected subdomain such as `admin.<domain>`. For this project the public host is `seriya.raspilok.ru`; add the owner subdomain only when the owner workspace is released. Obtain certificates for every enabled hostname.
The exact owner origin must also be present in `CORS_ORIGINS`; otherwise cookie login and refresh are intentionally rejected.

## Step 6 — backend as a systemd service

Copy `scripts/vps/myapp-backend.service` and `scripts/vps/myapp-release-recovery.service` to `/etc/systemd/system/<project>-backend.service` and `/etc/systemd/system/<project>-release-recovery.service` (rename `myapp` to the project name inside both). Recovery runs once on boot before backend/nginx and restores both the prior application symlink and prior publication when a machine stopped mid-switch. The backend runs `/opt/<project>/current/backend` and reads `/opt/<project>/shared/backend.env`, so it switches with both frontends. Then:

```bash
systemctl daemon-reload
systemctl enable <project>-release-recovery <project>-backend
systemctl start <project>-release-recovery <project>-backend
```

The service starts on boot and restarts automatically after crashes.

## Step 7 — one-command deploy

Copy `scripts/vps/deploy.sh` to `/opt/<project>/deploy.sh` and make it executable. The Git checkout must be `/opt/<project>/source`. From then on a deploy is:

```bash
ssh <server> /opt/<project>/deploy.sh
```

The script refuses a dirty/out-of-sync checkout, resolves any earlier interrupted switch through Bash even when a fresh Git clone does not preserve a local executable bit, requires all three production env files, creates and verifies a database backup receipt from the source Compose project before migration, assembles a timestamped full release outside `current`, installs locked dependencies, generates Prisma, previews/applies the approved catalog, copies and verifies the shared production asset package, prepares/exports the exact candidate, builds backend plus both frontends, verifies the owner API origin embedded in its bundle, writes a release checksum manifest, switches the complete application symlink, verifies backend readiness, activates and verifies the matching database publication, and smoke-tests the public site, owner workspace, and APIs. Any failure after switching restores the previous application and publication together.

Production activation intentionally fails until every published catalog family has a rights-approved production asset whose source and derived checksums match the shared manifest and files. The six supplied Basis packages and 25 neutral schematics are enough for development and converter validation, not for bypassing that launch gate. Supply the remaining confirmed Basis exports, approve provenance/rights, run the same batch converter, and place the complete package in `shared/catalog-assets` before the first live catalog activation.

The deploy pulls `main` from GitHub on the server — **unpushed local commits never reach production**. Push first, then deploy. Before deploying, verify the release source (`git remote -v`, `git status --short --branch`); if the worktree is dirty or the branch is not pushed/synced, stop and report the blocker instead of forcing it.

## Step 8 — scheduled tasks (systemd timers)

Exactly three timers belong to the baseline setup:

1. **Certificate renewal** — `certbot.timer`, installed automatically with certbot. Just verify it is active.
2. **Auth session cleanup** — the template ships the `auth:sessions:cleanup` cron task; wire it to a nightly timer with `scripts/vps/myapp-sessions-cleanup.service` + `.timer` (03:00).
3. **Database backup** — nightly `pg_dump` at 03:30 via `scripts/vps/myapp-db-backup.service` + `.timer` running `scripts/vps/db-backup.sh`: dump → gzip → `/var/backups/<project>/` with 30-day rotation, plus an optional off-server copy to S3-compatible storage (`scripts/vps/db-backup-upload.ts`, activates automatically when `SPACES_*` is configured in `backend/.env`). The script validates the dump's completion marker before keeping it — a truncated dump must never silently replace a good one.

Install pattern for each: copy to `/etc/systemd/system/`, rename `myapp` to the project name, `systemctl daemon-reload && systemctl enable --now <unit>.timer`.

This is also the pattern for future product background jobs (scheduled notifications, syncs, polls): add a task to `backend/src/cron.ts`, then wire a `.service` + `.timer` pair the same way. Do not install ad-hoc crontabs.

**After setting up backups, verify restore once**: run the backup manually, restore it into a throwaway database, compare table counts, drop the throwaway. A backup that has never been restored is a hope, not a backup. Restore modes:

- Test restore: `gunzip -c dump.sql.gz | docker exec -i <postgres container> psql -U superuser -d restore_test`
- Live restore (disaster only): stop backend → `dropdb`/`createdb` → `gunzip -c dump.sql.gz | psql --single-transaction -v ON_ERROR_STOP=1` → start backend. Always `gzip -t` the file first.

## Step 9 — post-install checklist

- [ ] SSH: key login works, password login refused.
- [ ] `ufw status` active; only OpenSSH/80/443 allowed. `fail2ban-client status sshd` shows the jail.
- [ ] `https://<domain>` → 200; `http://` → 301 redirect; `certbot renew --dry-run` succeeds.
- [ ] `curl https://<domain>/api/auth/me` → 401 (backend alive behind the proxy).
- [ ] Both registration endpoints return `403`; the bootstrapped owner can log in and a normal authenticated user receives `403` on `/api/owner/catalog`.
- [ ] `/api/catalog`, `/catalog/`, backend runtime, and release manifest expose the same publication/release pair.
- [ ] Production asset coverage check reports zero missing families.
- [ ] `docker ps` shows PostgreSQL bound to `127.0.0.1:54329` only.
- [ ] `systemctl list-timers` shows certbot, sessions-cleanup, and db-backup timers active.
- [ ] Manual backup run produced a file; test restore matched; the server password is stored nowhere.

## Operational notes

- If the site suddenly gets slow **for everyone**, check the hosting provider's network first (`ping`/`mtr` from the server to `1.1.1.1`, external check services) before blaming the code. Packet loss at the provider looks exactly like a broken app.
- Server replacement runbook: rent a new VPS → run this document on it → restore the latest DB backup → flip the domain's `A` record. Keep the old server untouched until the new one is verified, then decommission it.
- Do not run `git reset`, `git checkout --`, `git clean`, or `git stash` on the server to force a deploy through. If the server worktree is dirty, something is wrong — report it.
