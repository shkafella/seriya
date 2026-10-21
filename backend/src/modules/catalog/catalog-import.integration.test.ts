import { afterAll, describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { createPrisma, type DbClient } from '../../db'
import { createApp } from '../../app'
import type { AppEnv } from '../../env'
import { applyCatalogImport, CatalogImportError, CatalogService, loadCatalogSeed, previewCatalogImport } from './index'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe.serial : describe.skip
const seedPath = resolve(import.meta.dir, '../../../../catalog/seed/catalog.v1.json')
const sourceMapPath = resolve(import.meta.dir, '../../../../catalog/source-map.v1.json')

maybeDescribe('catalog import integration', () => {
  const clients: DbClient[] = []
  const freshDb = () => {
    const client = createPrisma(databaseUrl!)
    clients.push(client)
    return client
  }
  const env: AppEnv = {
    PORT: 3000, DATABASE_URL: databaseUrl!, JWT_SECRET: '12345678901234567890123456789012',
    CORS_ORIGINS: ['http://localhost:5173'], ACCESS_TOKEN_TTL_SECONDS: 60,
    REFRESH_TOKEN_TTL_DAYS: 30, REFRESH_REUSE_GRACE_SECONDS: 10, SESSION_ABSOLUTE_TTL_DAYS: 90,
    SESSION_RETENTION_DAYS: 7, AUTH_BODY_LIMIT_BYTES: 64 * 1024, AUTH_RATE_LIMIT_MAX: 60,
    AUTH_RATE_LIMIT_WINDOW_SECONDS: 60, AUTH_REGISTRATION_ENABLED: true, SHUTDOWN_GRACE_SECONDS: 20,
    TRUST_PROXY: false, COOKIE_SECURE: false, SPACES_UPLOAD_MAX_BYTES: 10 * 1024 * 1024,
    SPACES_UPLOAD_URL_TTL_SECONDS: 900, SPACES_DOWNLOAD_URL_TTL_SECONDS: 300,
    SPACES_PUBLIC_CACHE_CONTROL: 'public, max-age=31536000, immutable',
  }

  async function resetCatalog(prisma: DbClient) {
    await prisma.catalogActivationAttempt.deleteMany()
    await prisma.catalogState.updateMany({ data: { activePublicationId: null } })
    await prisma.catalogPublication.deleteMany()
    await prisma.catalogEditHistory.deleteMany()
    await prisma.catalogVariant.deleteMany()
    await prisma.catalogFamily.deleteMany()
    await prisma.catalogAsset.deleteMany()
    await prisma.catalogSourceRecord.deleteMany()
    await prisma.catalogImportHistory.deleteMany()
    await prisma.priceVersion.deleteMany()
    await prisma.catalogState.deleteMany()
    await prisma.ownerIdentity.deleteMany()
    await prisma.authSession.deleteMany()
    await prisma.user.deleteMany()
  }

  async function loadSeed(raw?: string, sourcePath = 'catalog/seed/catalog.v1.json') {
    return loadCatalogSeed(
      raw ?? await readFile(seedPath, 'utf8'),
      sourcePath,
      await readFile(sourceMapPath, 'utf8'),
    )
  }

  async function seedDevelopmentAssets(prisma: DbClient) {
    const families = await prisma.catalogFamily.findMany()
    for (const family of families) {
      const asset = await prisma.catalogAsset.create({
        data: {
          key: `test:${family.key}`,
          publicPath: `/catalog/${family.key}-test.svg`,
          derivedChecksum: 'a'.repeat(64),
          status: 'DEVELOPMENT', rightsApproved: true, productionApproved: false,
          provenance: { kind: 'integration-test' }, geometry: {}, masks: {},
        },
      })
      await prisma.catalogFamily.update({ where: { id: family.id }, data: { assetId: asset.id } })
    }
  }

  afterAll(async () => {
    const cleanup = freshDb()
    await resetCatalog(cleanup)
    await Promise.allSettled(clients.map((client) => client.$disconnect()))
  }, 30_000)

  test('imports 225 stable variants and repeats without duplicate identities', async () => {
    const prisma = freshDb()
    await resetCatalog(prisma)
    const loaded = await loadSeed()
    const firstPreview = await previewCatalogImport(prisma, loaded)
    expect(firstPreview.counts.created).toBe(225)
    await applyCatalogImport(prisma, loaded, firstPreview)
    const firstIds = await prisma.catalogVariant.findMany({ orderBy: { sku: 'asc' }, select: { id: true, sku: true } })

    const secondPreview = await previewCatalogImport(prisma, loaded)
    expect(secondPreview.counts).toMatchObject({ created: 0, updated: 0, unchanged: 225, duplicate: 0, invalid: 0, conflicts: 0 })
    await applyCatalogImport(prisma, loaded, secondPreview)
    const secondIds = await prisma.catalogVariant.findMany({ orderBy: { sku: 'asc' }, select: { id: true, sku: true } })

    expect(secondIds).toEqual(firstIds)
    expect(await prisma.catalogFamily.count()).toBe(25)
    expect(await prisma.priceVersion.count()).toBe(1)
  }, 30_000)

  test('records a source-row move even when commercial fields are unchanged', async () => {
    const prisma = freshDb()
    await resetCatalog(prisma)
    const initial = await loadSeed()
    await applyCatalogImport(prisma, initial, await previewCatalogImport(prisma, initial))
    const moved = JSON.parse(initial.raw)
    moved.modules[0].source = { ...moved.modules[0].source, row: Number(moved.modules[0].source.row) + 1 }
    const changed = await loadSeed(JSON.stringify(moved), 'source-row-move.json')

    const preview = await previewCatalogImport(prisma, changed)
    expect(preview.updated[0]?.fields).toContain('sourceTrace')
    const result = await applyCatalogImport(prisma, changed, preview)

    expect(result.resultingRevision).toBe(2)
    const source = await prisma.catalogSourceRecord.findUniqueOrThrow({
      where: { sourceRecordId: moved.modules[0].sourceRecordId },
    })
    expect(source.sourceData).toEqual(moved.modules[0].source)
  }, 30_000)

  test('rejects an imported SKU that collides with a preserved owner rename', async () => {
    const prisma = freshDb()
    await resetCatalog(prisma)
    const initial = await loadSeed()
    await applyCatalogImport(prisma, initial, await previewCatalogImport(prisma, initial))
    const [incomingTarget, ownerRenamed] = await prisma.catalogVariant.findMany({
      orderBy: { sku: 'asc' }, take: 2, include: { sourceRecord: true },
    })
    await prisma.catalogVariant.update({
      where: { id: ownerRenamed.id },
      data: { sku: 'OWNER-RENAME', ownerEditedFields: ['sku'] },
    })
    const changedSeed = JSON.parse(initial.raw)
    changedSeed.modules.find((item: { sourceRecordId: string }) => (
      item.sourceRecordId === incomingTarget.sourceRecord!.sourceRecordId
    )).sku = 'OWNER-RENAME'
    const changed = await loadSeed(JSON.stringify(changedSeed), 'owner-sku-conflict.json')

    const preview = await previewCatalogImport(prisma, changed)

    expect(preview.valid).toBe(false)
    expect(preview.invalid.some((item) => item.reason?.includes('resulting SKU'))).toBe(true)
    await expect(applyCatalogImport(prisma, changed, preview)).rejects.toBeInstanceOf(CatalogImportError)
  }, 30_000)

  test('applies a collision-free imported SKU swap transactionally', async () => {
    const prisma = freshDb()
    await resetCatalog(prisma)
    const initial = await loadSeed()
    await applyCatalogImport(prisma, initial, await previewCatalogImport(prisma, initial))
    const [left, right] = await prisma.catalogVariant.findMany({
      orderBy: { sku: 'asc' }, take: 2, include: { sourceRecord: true },
    })
    const changedSeed = JSON.parse(initial.raw)
    changedSeed.modules.find((item: { sourceRecordId: string }) => (
      item.sourceRecordId === left.sourceRecord!.sourceRecordId
    )).sku = right.sku
    changedSeed.modules.find((item: { sourceRecordId: string }) => (
      item.sourceRecordId === right.sourceRecord!.sourceRecordId
    )).sku = left.sku
    const changed = await loadSeed(JSON.stringify(changedSeed), 'sku-swap.json')

    const preview = await previewCatalogImport(prisma, changed)
    expect(preview.valid).toBe(true)
    await applyCatalogImport(prisma, changed, preview)

    expect((await prisma.catalogVariant.findUniqueOrThrow({ where: { id: left.id } })).sku).toBe(right.sku)
    expect((await prisma.catalogVariant.findUniqueOrThrow({ where: { id: right.id } })).sku).toBe(left.sku)
  }, 30_000)

  test('lets a new mapped identity take a SKU released in the same import', async () => {
    const prisma = freshDb()
    await resetCatalog(prisma)
    const fullSeed = JSON.parse(await readFile(seedPath, 'utf8'))
    const addedLater = fullSeed.modules.pop()
    const initial = await loadSeed(JSON.stringify(fullSeed), 'without-later-identity.json')
    await applyCatalogImport(prisma, initial, await previewCatalogImport(prisma, initial))
    const existing = await prisma.catalogVariant.findFirstOrThrow({
      orderBy: { sku: 'asc' }, include: { sourceRecord: true },
    })
    const changedSeed = JSON.parse(await readFile(seedPath, 'utf8'))
    const existingInput = changedSeed.modules.find((item: { sourceRecordId: string }) => (
      item.sourceRecordId === existing.sourceRecord!.sourceRecordId
    ))
    const addedInput = changedSeed.modules.find((item: { sourceRecordId: string }) => (
      item.sourceRecordId === addedLater.sourceRecordId
    ))
    existingInput.sku = 'RELEASED-SKU-OWNER'
    addedInput.sku = existing.sku
    const changed = await loadSeed(JSON.stringify(changedSeed), 'reuse-released-sku.json')

    const preview = await previewCatalogImport(prisma, changed)
    expect(preview.valid).toBe(true)
    expect(preview.counts).toMatchObject({ created: 1, updated: 1, invalid: 0, conflicts: 0 })
    await applyCatalogImport(prisma, changed, preview)

    expect((await prisma.catalogVariant.findUniqueOrThrow({ where: { id: existing.id } })).sku)
      .toBe('RELEASED-SKU-OWNER')
    expect((await prisma.catalogVariant.findUniqueOrThrow({
      where: { sku: addedInput.sku },
    })).sourceManaged).toBe(true)
  }, 30_000)

  test('rejects incomplete launch rates before any catalog write', async () => {
    const prisma = freshDb()
    await resetCatalog(prisma)
    const malformed = JSON.parse(await readFile(seedPath, 'utf8'))
    delete malformed.commercialRules.rates.customer_price_multiplier

    await expect(loadSeed(JSON.stringify(malformed), 'missing-launch-rate.json')).rejects.toThrow()
    expect(await prisma.catalogState.count()).toBe(0)
    expect(await prisma.catalogVariant.count()).toBe(0)
    expect(await prisma.priceVersion.count()).toBe(0)
    expect(await prisma.catalogImportHistory.count()).toBe(0)
  })

  test('rejects a stale preview without catalog mutation', async () => {
    const prisma = freshDb()
    await resetCatalog(prisma)
    const loaded = await loadSeed()
    const preview = await previewCatalogImport(prisma, loaded)
    await applyCatalogImport(prisma, loaded, preview)
    const count = await prisma.catalogVariant.count()

    const staleDb = freshDb()
    await expect(applyCatalogImport(staleDb, loaded, preview)).rejects.toBeInstanceOf(CatalogImportError)
    expect(await staleDb.catalogVariant.count()).toBe(count)
  }, 30_000)

  test('allows exactly one concurrent apply to win the catalog revision', async () => {
    const left = freshDb()
    await resetCatalog(left)
    const right = freshDb()
    const loaded = await loadSeed()
    const [leftPreview, rightPreview] = await Promise.all([
      previewCatalogImport(left, loaded), previewCatalogImport(right, loaded),
    ])
    const results = await Promise.allSettled([
      applyCatalogImport(left, loaded, leftPreview),
      applyCatalogImport(right, loaded, rightPreview),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(await right.catalogVariant.count()).toBe(225)
    expect((await right.catalogState.findUniqueOrThrow({ where: { singletonKey: 'catalog' } })).revision).toBe(1)
  }, 30_000)

  test('reports an owner conflict and preserves the owner value', async () => {
    const prisma = freshDb()
    await resetCatalog(prisma)
    const initial = await loadSeed()
    await applyCatalogImport(prisma, initial, await previewCatalogImport(prisma, initial))
    const ownerDb = freshDb()
    const current = await ownerDb.catalogVariant.findFirstOrThrow({ orderBy: { sku: 'asc' } })
    await ownerDb.catalogVariant.update({
      where: { id: current.id },
      data: { publicName: 'Название владельца', ownerEditedFields: ['publicName'] },
    })

    const parsed = JSON.parse(initial.raw)
    const sourceId = (await ownerDb.catalogVariant.findUniqueOrThrow({ where: { id: current.id }, include: { sourceRecord: true } })).sourceRecord!.sourceRecordId
    parsed.modules.find((item: { sourceRecordId: string }) => item.sourceRecordId === sourceId).publicName = 'Новое название источника'
    const changed = await loadSeed(JSON.stringify(parsed), 'changed.json')
    const conflictDb = freshDb()
    const preview = await previewCatalogImport(conflictDb, changed)

    expect(preview.counts.conflicts).toBe(1)
    await expect(applyCatalogImport(conflictDb, changed, preview)).rejects.toBeInstanceOf(CatalogImportError)
    expect((await conflictDb.catalogVariant.findUniqueOrThrow({ where: { id: current.id } })).publicName).toBe('Название владельца')
  }, 30_000)

  test('deactivates a removed source record but never an owner-created record', async () => {
    const prisma = freshDb()
    await resetCatalog(prisma)
    const initial = await loadSeed()
    await applyCatalogImport(prisma, initial, await previewCatalogImport(prisma, initial))
    const family = await prisma.catalogFamily.findFirstOrThrow()
    const ownerVariant = await prisma.catalogVariant.create({
      data: {
        familyId: family.id, sku: 'OWNER-1', importedData: {}, publicName: 'Владелец',
        heightMm: 100, widthMm: 100, depthMm: 100, bodyM2: 1, facadeM2: 0, hdfM2: 0,
        fastenerChargeRub: 0, cutPolicy: 'allowed', variantData: {}, fastenersData: {}, sourceManaged: false,
      },
    })
    const parsed = JSON.parse(initial.raw)
    const removed = parsed.modules.pop()
    const changed = await loadSeed(JSON.stringify(parsed), 'removed.json')
    const applyDb = freshDb()
    const preview = await previewCatalogImport(applyDb, changed)
    expect(preview.counts.deactivated).toBe(1)
    await applyCatalogImport(applyDb, changed, preview)

    const removedSource = await prisma.catalogSourceRecord.findUniqueOrThrow({ where: { sourceRecordId: removed.sourceRecordId } })
    expect((await prisma.catalogVariant.findUniqueOrThrow({ where: { sourceRecordId: removedSource.id } })).isActive).toBe(false)
    expect((await prisma.catalogVariant.findUniqueOrThrow({ where: { id: ownerVariant.id } })).isActive).toBe(true)
  }, 30_000)

  test('preserves owner visibility, restores source visibility, and reports granular dimension conflicts', async () => {
    const prisma = freshDb()
    await resetCatalog(prisma)
    const initial = await loadSeed()
    await applyCatalogImport(prisma, initial, await previewCatalogImport(prisma, initial))
    const [ownerHidden, sourceHidden] = await prisma.catalogVariant.findMany({ orderBy: { sku: 'asc' }, take: 2, include: { sourceRecord: true } })
    await prisma.catalogVariant.update({
      where: { id: ownerHidden.id },
      data: { isActive: false, widthMm: { increment: 1 }, ownerEditedFields: ['isActive', 'widthMm'], revision: { increment: 1 } },
    })
    await prisma.catalogState.update({ where: { singletonKey: 'catalog' }, data: { revision: { increment: 1 } } })

    const changedSource = JSON.parse(initial.raw)
    changedSource.modules.find((item: { sourceRecordId: string }) => item.sourceRecordId === ownerHidden.sourceRecord!.sourceRecordId).dimensionsMm.width += 5
    changedSource.modules.find((item: { sourceRecordId: string }) => item.sourceRecordId === sourceHidden.sourceRecord!.sourceRecordId).publicName += ' обновлено'
    const conflicting = await loadSeed(JSON.stringify(changedSource), 'dimension-change.json')
    const conflictPreview = await previewCatalogImport(prisma, conflicting)
    expect(conflictPreview.conflicts.find((item) => item.sourceRecordId === ownerHidden.sourceRecord!.sourceRecordId)?.fields).toContain('widthMm')

    changedSource.modules.find((item: { sourceRecordId: string }) => item.sourceRecordId === ownerHidden.sourceRecord!.sourceRecordId).dimensionsMm.width -= 5
    const safeChange = await loadSeed(JSON.stringify(changedSource), 'safe-change.json')
    await applyCatalogImport(prisma, safeChange, await previewCatalogImport(prisma, safeChange))
    expect((await prisma.catalogVariant.findUniqueOrThrow({ where: { id: ownerHidden.id } })).isActive).toBe(false)

    const removed = JSON.parse(safeChange.raw)
    removed.modules = removed.modules.filter((item: { sourceRecordId: string }) => item.sourceRecordId !== sourceHidden.sourceRecord!.sourceRecordId)
    const withoutSource = await loadSeed(JSON.stringify(removed), 'removed.json')
    await applyCatalogImport(prisma, withoutSource, await previewCatalogImport(prisma, withoutSource))
    expect((await prisma.catalogVariant.findUniqueOrThrow({ where: { id: sourceHidden.id } })).isActive).toBe(false)

    const returnedPreview = await previewCatalogImport(prisma, safeChange)
    expect(returnedPreview.updated.find((item) => item.sourceRecordId === sourceHidden.sourceRecord!.sourceRecordId)?.fields).toContain('sourcePresence')
    await applyCatalogImport(prisma, safeChange, returnedPreview)
    expect((await prisma.catalogVariant.findUniqueOrThrow({ where: { id: sourceHidden.id } })).isActive).toBe(true)

    const spanned = await prisma.catalogVariant.findFirstOrThrow({ where: { layoutSpanMm: { not: null } }, include: { sourceRecord: true } })
    const withoutSpanJson = JSON.parse(safeChange.raw)
    delete withoutSpanJson.modules.find((item: { sourceRecordId: string }) => item.sourceRecordId === spanned.sourceRecord!.sourceRecordId).layoutSpanMm
    const withoutSpan = await loadSeed(JSON.stringify(withoutSpanJson), 'removed-layout-span.json')
    await applyCatalogImport(prisma, withoutSpan, await previewCatalogImport(prisma, withoutSpan))
    const cleared = await prisma.catalogVariant.findUniqueOrThrow({ where: { id: spanned.id } })
    expect(cleared.layoutSpanMm).toBeNull()
    expect((cleared.importedData as { layoutSpanMm: null }).layoutSpanMm).toBeNull()
  }, 30_000)

  test('rejects unknown source identities and concurrent owner edits', async () => {
    const prisma = freshDb()
    await resetCatalog(prisma)
    const initial = await loadSeed()
    await applyCatalogImport(prisma, initial, await previewCatalogImport(prisma, initial))

    const unknown = JSON.parse(initial.raw)
    unknown.modules[0].sourceRecordId = 'catalog-source-999999'
    const unknownPreview = await previewCatalogImport(prisma, await loadSeed(JSON.stringify(unknown), 'unknown-source.json'))
    expect(unknownPreview.valid).toBe(false)
    expect(unknownPreview.invalid.some((item) => item.reason?.includes('source-map'))).toBe(true)

    const changedRates = JSON.parse(initial.raw)
    changedRates.commercialRules.rates.body_rub_m2 += 1
    const ratePreview = await previewCatalogImport(prisma, await loadSeed(JSON.stringify(changedRates), 'changed-rates.json'))
    expect(ratePreview.valid).toBe(false)
    expect(ratePreview.invalid.some((item) => item.sourceRecordId === 'price-version:1')).toBe(true)

    const variant = await prisma.catalogVariant.findFirstOrThrow({ orderBy: { sku: 'asc' } })
    const left = new CatalogService(freshDb())
    const right = new CatalogService(freshDb())
    const results = await Promise.allSettled([
      left.editVariant(crypto.randomUUID(), variant.id, { revision: variant.revision, changes: { publicName: 'Первый редактор' } }),
      right.editVariant(crypto.randomUUID(), variant.id, { revision: variant.revision, changes: { publicName: 'Второй редактор' } }),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
  }, 30_000)

  test('owner bootstrap revokes sessions that existed before privilege elevation', async () => {
    const prisma = freshDb()
    await resetCatalog(prisma)
    const app = createApp({ env, prisma })
    const registered = await app.request('/api/auth/token/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'existing-owner@example.com', password: 'old-password-123' }),
    })
    const body = await registered.json()
    expect((await app.request('/api/owner/catalog', { headers: { Authorization: `Bearer ${body.accessToken}` } })).status).toBe(403)

    const process = Bun.spawn(['bun', 'run', 'catalog:owner', '--', 'bootstrap'], {
      cwd: resolve(import.meta.dir, '../../..'),
      env: {
        ...globalThis.process.env,
        DATABASE_URL: databaseUrl!, OWNER_EMAIL: 'existing-owner@example.com', OWNER_PASSWORD: 'new-password-456',
      },
      stdout: 'pipe', stderr: 'pipe',
    })
    expect(await process.exited).toBe(0)
    expect(await prisma.authSession.count({ where: { userId: body.user.id, revokedAt: null } })).toBe(0)
    expect((await app.request('/api/owner/catalog', { headers: { Authorization: `Bearer ${body.accessToken}` } })).status).toBe(401)
  }, 30_000)

  test('enforces the single owner and publishes one coherent snapshot', async () => {
    const prisma = freshDb()
    await resetCatalog(prisma)
    const loaded = await loadSeed()
    await applyCatalogImport(prisma, loaded, await previewCatalogImport(prisma, loaded))
    await seedDevelopmentAssets(prisma)
    const appDb = freshDb()
    const app = createApp({ env, prisma: appDb })
    const register = async (email: string) => {
      const response = await app.request('/api/auth/token/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'password123' }),
      })
      return response.json()
    }
    const owner = await register('owner@example.com')
    const other = await register('other@example.com')
    await appDb.ownerIdentity.create({ data: { userId: owner.user.id } })

    const denied = await app.request('/api/owner/catalog', { headers: { Authorization: `Bearer ${other.accessToken}` } })
    expect(denied.status).toBe(403)
    const ownerCatalog = await app.request('/api/owner/catalog', { headers: { Authorization: `Bearer ${owner.accessToken}` } })
    expect(ownerCatalog.status).toBe(200)
    const body = await ownerCatalog.json()
    expect(body.variants).toHaveLength(225)
    expect(body.assets).toHaveLength(25)
    expect(body.publicationStatus).toBe('UNPREPARED')

    const target = body.variants[0]
    const familyAsset = await appDb.catalogFamily.findUniqueOrThrow({ where: { id: target.familyId }, select: { assetId: true } })
    const assetSaved = await new CatalogService(appDb).editVariant(owner.user.id, target.id, {
      revision: target.revision, changes: { assetId: familyAsset.assetId },
    })
    expect(assetSaved.assetId).toBe(familyAsset.assetId)
    target.revision = assetSaved.revision
    const stale = await app.request(`/api/owner/catalog/variants/${target.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${owner.accessToken}` },
      body: JSON.stringify({ revision: target.revision + 1, changes: { publicName: 'Новое имя' } }),
    })
    expect(stale.status).toBe(409)
    const saved = await app.request(`/api/owner/catalog/variants/${target.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${owner.accessToken}` },
      body: JSON.stringify({ revision: target.revision, changes: { publicName: 'Новое имя' } }),
    })
    expect(saved.status).toBe(200)
    const savedVariant = await saved.json()
    const otherSku = body.variants.find((variant: { id: string }) => variant.id !== target.id)!.sku
    const duplicateSku = await app.request(`/api/owner/catalog/variants/${target.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${owner.accessToken}` },
      body: JSON.stringify({ revision: savedVariant.revision, changes: { sku: otherSku } }),
    })
    expect(duplicateSku.status).toBe(409)
    expect((await duplicateSku.json()).error).toMatchObject({ code: 'CONFLICT', details: { field: 'sku' } })
    const missingAsset = await app.request(`/api/owner/catalog/variants/${target.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${owner.accessToken}` },
      body: JSON.stringify({ revision: savedVariant.revision, changes: { assetId: crypto.randomUUID() } }),
    })
    expect(missingAsset.status).toBe(400)
    expect((await missingAsset.json()).error).toMatchObject({ code: 'VALIDATION_ERROR', details: { field: 'assetId' } })

    const candidateResponse = await app.request('/api/owner/catalog/candidate', {
      method: 'POST', headers: { Authorization: `Bearer ${owner.accessToken}` },
    })
    expect(candidateResponse.status).toBe(201)
    const candidate = await candidateResponse.json()
    const awaitingRelease = await app.request('/api/owner/catalog', { headers: { Authorization: `Bearer ${owner.accessToken}` } })
    expect((await awaitingRelease.json()).publicationStatus).toBe('AWAITING_RELEASE')
    expect((await app.request('/api/catalog')).status).toBe(404)

    const activationInput = {
      candidateId: candidate.candidateId,
      releaseId: `candidate-${candidate.candidateId}`,
      releasePath: `/opt/seriya/releases/${candidate.candidateId}`,
      backupReceipt: { backupId: 'test-backup', completedAt: new Date().toISOString(), database: 'seriya_test', integrity: `sha256:${'a'.repeat(64)}` },
      expectedDatabase: 'seriya_test',
      requireProductionAssets: false,
    }
    await expect(new CatalogService(freshDb()).beginActivation({
      ...activationInput,
      expectedDatabase: 'wrong_database',
    })).rejects.toMatchObject({ code: 'INVALID_BACKUP_RECEIPT' })
    await expect(new CatalogService(freshDb()).beginActivation({
      ...activationInput,
      backupReceipt: { ...activationInput.backupReceipt, completedAt: '2099-01-01T00:00:00.000Z' },
    })).rejects.toMatchObject({ code: 'INVALID_BACKUP_RECEIPT' })
    await prisma.catalogAsset.updateMany({ data: { status: 'REJECTED', rightsApproved: false, productionApproved: true, sourceChecksum: null } })
    const productionGateDb = freshDb()
    await expect(new CatalogService(productionGateDb).beginActivation({
      ...activationInput,
      releasePath: `${activationInput.releasePath}-production`,
      requireProductionAssets: true,
    })).rejects.toMatchObject({ code: 'PRODUCTION_ASSETS_INCOMPLETE' })
    expect((await productionGateDb.catalogState.findUniqueOrThrow({ where: { singletonKey: 'catalog' } })).activationState).toBe('IDLE')
    const beginDb = freshDb()
    await new CatalogService(beginDb).beginActivation(activationInput)
    expect((await app.request('/api/catalog')).status).toBe(503)
    await new CatalogService(appDb).markApplicationSwitched(activationInput.candidateId, activationInput.releasePath)
    await new CatalogService(appDb).activateCandidate(activationInput)
    expect((await app.request('/api/catalog')).status).toBe(503)
    const releaseSmoke = await app.request(`/api/catalog/_release-smoke/${candidate.candidateId}`)
    expect(releaseSmoke.status).toBe(200)
    expect((await releaseSmoke.json()).releaseId).toBe(activationInput.releaseId)
    expect((await app.request('/api/catalog/_release-smoke/019a0000-0000-7000-8000-000000000001')).status).toBe(404)
    await new CatalogService(appDb).verifyActivation(activationInput.candidateId, activationInput.releasePath)
    expect((await app.request(`/api/catalog/_release-smoke/${candidate.candidateId}`)).status).toBe(404)
    const publishedOwnerCatalog = await app.request('/api/owner/catalog', { headers: { Authorization: `Bearer ${owner.accessToken}` } })
    const publishedOwnerBody = await publishedOwnerCatalog.json()
    expect(publishedOwnerBody.publicationStatus).toBe('PUBLISHED')
    expect(publishedOwnerBody.hasUnpreparedChanges).toBe(false)
    const published = await app.request('/api/catalog')
    expect(published.status).toBe(200)
    const publicBody = await published.json()
    expect(publicBody.publicationId).toBe(candidate.candidateId)
    expect(publicBody.families).toHaveLength(25)
    expect(publicBody.families.every((family: { priceRange: { maxRub: number } }) => family.priceRange.maxRub > 0)).toBe(true)
    for (const key of ['wall-aventos', 'wall-klok', 'wall-drying-aventos']) {
      const family = publicBody.families.find((item: { key: string }) => item.key === key)
      expect(family?.functions).toContain('подъёмник')
      expect(family?.functions).not.toContain('распашной')
    }
    const recovery = new CatalogService(freshDb())
    await recovery.startRecovery(candidate.candidateId)
    expect((await app.request('/api/catalog')).status).toBe(503)
    expect((await appDb.catalogActivationAttempt.findFirstOrThrow({ where: { nextPublicationId: candidate.candidateId } })).status).toBe('FAILED')
    await recovery.startRecovery(candidate.candidateId)
    const recovered = await recovery.recoverActivation(candidate.candidateId)
    expect(recovered?.status).toBe('FAILED')
    expect((await appDb.catalogActivationAttempt.findFirstOrThrow({ where: { nextPublicationId: candidate.candidateId } })).status).toBe('ROLLED_BACK')
    expect((await app.request('/api/catalog')).status).toBe(404)
  }, 30_000)
})
