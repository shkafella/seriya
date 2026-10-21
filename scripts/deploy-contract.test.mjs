import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const deploy = await readFile(new URL('./vps/deploy.sh', import.meta.url), 'utf8')
const backup = await readFile(new URL('./vps/db-backup.sh', import.meta.url), 'utf8')
const service = await readFile(new URL('./vps/myapp-backend.service', import.meta.url), 'utf8')
const backupService = await readFile(new URL('./vps/myapp-db-backup.service', import.meta.url), 'utf8')
const recovery = await readFile(new URL('./vps/recover-release.sh', import.meta.url), 'utf8')
const recoveryService = await readFile(new URL('./vps/myapp-release-recovery.service', import.meta.url), 'utf8')
const deploymentDocs = await readFile(new URL('../docs/DEPLOYMENT.md', import.meta.url), 'utf8')
const gitignore = await readFile(new URL('../.gitignore', import.meta.url), 'utf8')
const assetSync = await readFile(new URL('../backend/scripts/catalog-assets.ts', import.meta.url), 'utf8')
const assetPackage = await readFile(new URL('../backend/scripts/catalog-asset-package.ts', import.meta.url), 'utf8')
const receiptVerifier = fileURLToPath(new URL('./vps/verify-backup-receipt.ts', import.meta.url))

describe('production release contract', () => {
  test('backs up before migration and requires the receipt for activation', () => {
    expect(deploy.indexOf('db-backup.sh')).toBeLessThan(deploy.indexOf('prisma:deploy'))
    expect(deploy.indexOf('verify-backup-receipt.ts')).toBeLessThan(deploy.indexOf('prisma:deploy'))
    expect(deploy).toContain('BACKUP_PROJECT_NAME="$PROJECT_NAME" PROJECT_ROOT="$SOURCE_DIR"')
    expect(deploy).toContain('BACKUP_DATABASE_NAME must exactly match')
    expect(deploy).toContain('catalog:release activate')
    expect(backup).toContain('integrity')
  })

  test('builds a full immutable release and restores the prior symlink on failure', () => {
    expect(deploy).toContain('bun install --frozen-lockfile')
    expect(deploy).toContain('build:webapp')
    expect(deploy).toContain('build:website')
    expect(deploy).toContain('rollback_application')
    expect(deploy).toContain('RECOVERY_LOCK_HELD=true bash "$SOURCE_DIR/scripts/vps/recover-release.sh"')
    expect(deploy).toContain('recovery_args+=("$CANDIDATE_ID")')
    expect(deploy.indexOf('catalog:release begin')).toBeLessThan(deploy.indexOf('ln -sfn "$RELEASE_DIR"'))
    expect(deploy.indexOf('catalog:release mark-application')).toBeLessThan(deploy.indexOf('catalog:release activate'))
    expect(deploy.indexOf('catalog:release activate')).toBeLessThan(deploy.indexOf('catalog:release verify'))
    expect(deploy.indexOf('/api/catalog/_release-smoke/')).toBeLessThan(deploy.indexOf('catalog:release verify'))
    expect(deploy.indexOf('$PUBLIC_WEBSITE_URL/catalog/')).toBeLessThan(deploy.indexOf('catalog:release verify'))
    expect(deploy).toContain('RELEASE_ID=%s')
    expect(deploy).toContain('wait_for_release_ready "$APP_RELEASE_ID"')
    expect(deploy).toContain('$PUBLIC_WEBSITE_URL/api/catalog')
    expect(deploy).toContain('$PUBLIC_WEBSITE_URL/catalog/')
    expect(service).toContain('/current/backend')
    expect(backupService).toContain('PROJECT_ROOT=/opt/myapp/source')
    expect(recovery).toContain('catalog:release recovery-plan')
    expect(recovery).toContain('recovery-plan "$REQUESTED_CANDIDATE_ID"')
    expect(recovery.indexOf('catalog:release start-recovery')).toBeLessThan(recovery.indexOf('ln -sfn "$PREVIOUS_RELEASE"'))
    expect(recovery.indexOf('health/ready')).toBeLessThan(recovery.indexOf('catalog:release recover "$CANDIDATE_ID"'))
    expect(recovery).toContain('RUNTIME_RELEASE/backend')
    expect(recovery).toContain('release-manifest.json')
    expect(recovery).toContain('backend/src/generated/prisma/client.ts')
    expect(recovery).toContain('No complete release exists yet')
    expect(recovery).not.toContain('SOURCE_DIR/backend" && bun run catalog:release')
    expect(recovery).toContain('systemctl stop "$SERVICE_NAME"')
    expect(recovery).toContain('systemctl start "$SERVICE_NAME"')
    expect(recovery).toContain('health/ready')
    expect(deploy).toContain('for _ in $(seq 1 30)')
    expect(recovery).toContain('for _ in $(seq 1 30)')
    expect(recovery).toContain('ln -sfn "$PREVIOUS_RELEASE" "$CURRENT_LINK"')
    expect(recoveryService).toContain('After=network-online.target docker.service myapp-backend.service')
    expect(recoveryService).toContain('Before=nginx.service')
    expect(deploy).toContain('flock -n 9')
    expect(recovery).toContain('flock -n 9')
    expect(deploy.indexOf('flock -n 9')).toBeLessThan(deploy.indexOf('recover-release.sh'))
    expect(recovery).toContain('"$SHARED_DIR/release.lock"')
    expect(deploymentDocs).toContain('. /opt/<project>/shared/backend.env')
    expect(deploymentDocs).toContain('cd /opt/<project>/current/backend')
    expect(gitignore.split(/\r?\n/)).toContain('docker-compose.override.yml')
  })

  test('requires, embeds, and smoke-tests the owner workspace production origin', () => {
    expect(deploy).toContain('missing $SHARED_DIR/webapp.env')
    expect(deploy).toContain('VITE_API_URL must be the owner workspace HTTPS origin')
    expect(deploy).toContain('install -m 600 "$SHARED_DIR/webapp.env"')
    expect(deploy).toContain('grep -R -F "$VITE_API_URL" "$RELEASE_DIR/webapp/dist"')
    expect(deploy).toContain('curl -fsS --proto \'=https\' "$VITE_API_URL/"')
    expect(deploy).toContain('"$VITE_API_URL/api/auth/me"')
  })

  test('verifies the actual backup bytes and rejects tampering before migration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'seriya-backup-'))
    try {
      const backupId = 'seriya_test-20261021-120000.sql.gz'
      const backupPath = join(root, backupId)
      const receiptPath = join(root, 'receipt.json')
      const bytes = Buffer.from('verified-database-dump')
      const checksum = createHash('sha256').update(bytes).digest('hex')
      await writeFile(backupPath, bytes)
      await writeFile(receiptPath, JSON.stringify({
        backupId,
        completedAt: new Date().toISOString(),
        database: 'seriya_test',
        integrity: `sha256:${checksum}`,
      }))
      const valid = Bun.spawn([process.execPath, receiptVerifier, receiptPath, root, 'seriya_test'], { stderr: 'pipe' })
      expect(await valid.exited).toBe(0)

      await writeFile(backupPath, 'tampered')
      const tampered = Bun.spawn([process.execPath, receiptVerifier, receiptPath, root, 'seriya_test'], { stderr: 'pipe' })
      expect(await tampered.exited).not.toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('uses a complete shared production asset package without regenerating development assets', () => {
    expect(deploy).toContain('manifest.production.v1.json')
    expect(deploy).toContain('catalog:assets check-production')
    expect(deploy).not.toContain('bun run catalog:assets\n')
    expect(assetSync).toContain('Refusing to replace approved production asset')
    expect(assetSync).toContain('revision: { increment: 1 }')
    expect(assetSync).toContain('assertLightweightPublicAsset')
    expect(deploy).toContain('catalog-asset-package.ts')
    expect(deploy).not.toContain('cp -a "$PRODUCTION_ASSET_DIR/."')
    expect(assetPackage).toContain("filename.endsWith('.svg')")
    expect(assetPackage).toContain('copyFile(source')
  })

  test('publishes 25 content-hashed schematics and no raw Basis files', async () => {
    const catalogDir = new URL('../website/public/catalog/', import.meta.url)
    const manifest = JSON.parse(await readFile(new URL('manifest.v1.json', catalogDir), 'utf8'))
    const files = await readdir(catalogDir)
    expect(manifest.assets).toHaveLength(25)
    expect(files.some((file) => /\.(obj|mtl|b3d|xml|pdf)$/i.test(file))).toBe(false)
    for (const asset of manifest.assets) {
      const filename = asset.publicPath.split('/').at(-1)
      const bytes = await readFile(new URL(filename, catalogDir))
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.derivedChecksum)
      expect(filename).toContain(asset.derivedChecksum.slice(0, 12))
    }
  })
})
