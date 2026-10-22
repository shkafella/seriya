import { catalogImportPreviewSchema, catalogSeedSchema, pricingRatesSchema, type CatalogImportPreview, type CatalogSeed, type CatalogSeedModule } from '@seriya/contracts'
import type { Prisma } from '../../../generated/prisma/client'

import type { DbClient } from '../../../db'
import { canonicalJson, sha256 } from '../application/canonical-json'
import { configurationDefaultsForFamily } from '../application/configuration-defaults'

export type LoadedCatalogSeed = {
  sourcePath: string
  raw: string
  checksum: string
  seed: CatalogSeed
  sourceMap: { schemaVersion: number; records: Array<{ sourceRecordId: string }> }
  sourceMapChecksum: string
}

export function loadCatalogSeed(raw: string, sourcePath: string, sourceMapRaw: string): LoadedCatalogSeed {
  const seed = catalogSeedSchema.parse(JSON.parse(raw))
  const sourceMap = JSON.parse(sourceMapRaw) as LoadedCatalogSeed['sourceMap']
  if (sourceMap.schemaVersion !== 1 || !Array.isArray(sourceMap.records)) {
    throw new CatalogImportError('INVALID_SOURCE_MAP', 'Unsupported or malformed source map')
  }
  return {
    sourcePath,
    raw,
    checksum: sha256(raw),
    seed,
    sourceMap,
    sourceMapChecksum: sha256(canonicalJson(sourceMap)),
  }
}

export async function previewCatalogImport(
  db: DbClient,
  loaded: LoadedCatalogSeed,
): Promise<CatalogImportPreview> {
  const state = await db.catalogState.findUnique({ where: { singletonKey: 'catalog' } })
  const existing = await db.catalogVariant.findMany({
    include: { sourceRecord: true },
  })
  const [existingFamilies, launchPrice] = await Promise.all([
    db.catalogFamily.findMany(),
    db.priceVersion.findUnique({ where: { version: 1 } }),
  ])
  const sourceManaged = existing.filter((item) => item.sourceManaged)
  const families = new Set(loaded.seed.families.map((family) => family.id))
  const sourceIds = new Set<string>()
  const skus = new Set<string>()
  const duplicate: CatalogImportPreview['duplicate'] = []
  const invalid: CatalogImportPreview['invalid'] = []
  const mappedSourceIds = new Set(loaded.sourceMap.records.map((record) => record.sourceRecordId))

  if (loaded.sourceMapChecksum !== loaded.seed.source.sourceMap.sha256) {
    invalid.push({ sourceRecordId: 'source-map', sku: 'source-map', reason: 'source-map checksum mismatch' })
  }
  if (loaded.sourceMap.records.length !== loaded.seed.source.sourceMap.recordCount) {
    invalid.push({ sourceRecordId: 'source-map', sku: 'source-map', reason: 'source-map record count mismatch' })
  }

  for (const item of loaded.seed.modules) {
    if (sourceIds.has(item.sourceRecordId)) duplicate.push(record(item, 'duplicate sourceRecordId'))
    if (skus.has(item.sku)) duplicate.push(record(item, 'duplicate SKU'))
    if (!families.has(item.familyId)) invalid.push(record(item, 'unknown family'))
    if (!mappedSourceIds.has(item.sourceRecordId)) invalid.push(record(item, 'sourceRecordId is absent from approved source-map'))
    sourceIds.add(item.sourceRecordId)
    skus.add(item.sku)
  }

  const bySource = new Map(sourceManaged.filter((item) => item.sourceRecord).map((item) => [item.sourceRecord!.sourceRecordId, item]))
  const created: CatalogImportPreview['created'] = []
  const updated: CatalogImportPreview['updated'] = []
  const unchanged: CatalogImportPreview['unchanged'] = []
  const conflicts: CatalogImportPreview['conflicts'] = []
  const conflictingSkuSources = resultingSkuConflictSourceIds(existing, loaded.seed.modules)
  for (const item of loaded.seed.modules) {
    if (conflictingSkuSources.has(item.sourceRecordId)) {
      invalid.push(record(item, 'resulting SKU collides with another catalog identity'))
    }
  }

  for (const item of loaded.seed.modules) {
    const current = bySource.get(item.sourceRecordId)
    if (!current) {
      created.push(record(item))
      continue
    }
    const fields = changedImportedFields(current.importedData, importedData(item))
    if (sourceTraceChanged(current.sourceRecord?.sourceData, item.source)) fields.push('sourceTrace')
    if (current.sourceRecord?.isActive === false) fields.push('sourcePresence')
    if (fields.length === 0) {
      unchanged.push(record(item))
      continue
    }
    const overridden = stringArray(current.ownerEditedFields)
    const conflictFields = fields.filter((field) => overridden.includes(field))
    if (conflictFields.length > 0) conflicts.push({ ...record(item, 'owner override conflict'), fields: conflictFields })
    else updated.push({ ...record(item), fields })
  }

  for (const family of loaded.seed.families) {
    const current = existingFamilies.find((item) => item.key === family.id)
    if (current && (current.importedPublicName !== family.publicName || current.row !== family.row)) {
      updated.push({ sourceRecordId: `family:${family.id}`, sku: family.id, fields: ['family'] })
    }
  }
  const launchRateChecksum = sha256(canonicalJson(launchRates(loaded.seed)))
  const legacyRateChecksum = sha256(canonicalJson(legacyLaunchRates(loaded.seed)))
  if (launchPrice && ![launchRateChecksum, legacyRateChecksum].includes(launchPrice.checksum)) {
    invalid.push({ sourceRecordId: 'price-version:1', sku: 'price-version:1', reason: 'approved launch rates differ from immutable price version 1' })
  }

  const deactivated = sourceManaged
    .filter((item) => item.sourceRecord?.isActive !== false && item.sourceRecord && !sourceIds.has(item.sourceRecord.sourceRecordId))
    .map((item) => ({ sourceRecordId: item.sourceRecord!.sourceRecordId, sku: item.sku, reason: 'removed from source' }))

  const preview = {
    schemaVersion: 1 as const,
    sourcePath: loaded.sourcePath,
    sourceChecksum: loaded.checksum,
    sourceMapChecksum: loaded.sourceMapChecksum,
    baseCatalogRevision: state?.revision ?? 0,
    generatedAt: new Date().toISOString(),
    valid: duplicate.length === 0 && invalid.length === 0 && conflicts.length === 0,
    counts: {
      created: created.length,
      updated: updated.length,
      unchanged: unchanged.length,
      deactivated: deactivated.length,
      duplicate: duplicate.length,
      invalid: invalid.length,
      conflicts: conflicts.length,
    },
    created, updated, unchanged, deactivated, duplicate, invalid, conflicts,
  }
  return catalogImportPreviewSchema.parse(preview)
}

export async function applyCatalogImport(
  db: DbClient,
  loaded: LoadedCatalogSeed,
  expected: Pick<CatalogImportPreview, 'sourceChecksum' | 'sourceMapChecksum' | 'baseCatalogRevision'> & { valid?: boolean },
) {
  if (expected.valid === false) {
    throw new CatalogImportError('UNSAFE_IMPORT', 'The reviewed preview is not valid')
  }
  if (loaded.checksum !== expected.sourceChecksum || loaded.sourceMapChecksum !== expected.sourceMapChecksum) {
    throw new CatalogImportError('STALE_PREVIEW', 'The source package changed after preview')
  }
  let observedState = await db.catalogState.findUnique({ where: { singletonKey: 'catalog' } })
  if (!observedState) {
    try {
      observedState = await db.catalogState.create({ data: { singletonKey: 'catalog' } })
    } catch {
      observedState = await db.catalogState.findUnique({ where: { singletonKey: 'catalog' } })
    }
  }
  if (!observedState) throw new CatalogImportError('CATALOG_STATE_UNAVAILABLE', 'Could not initialize catalog state')
  if (observedState.revision !== expected.baseCatalogRevision) {
    throw new CatalogImportError('STALE_PREVIEW', 'Catalog revision changed after preview')
  }
  const observedPreview = await previewCatalogImport(db, loaded)
  if (!observedPreview.valid) {
    throw new CatalogImportError('UNSAFE_IMPORT', 'Import has duplicates, invalid rows, or owner conflicts', observedPreview)
  }
  if (
    observedPreview.counts.created === 0
    && observedPreview.counts.updated === 0
    && observedPreview.counts.deactivated === 0
  ) {
    await db.$transaction(async (tx) => { await ensurePricingBootstrap(tx, loaded.seed) })
    return { ...observedPreview, resultingRevision: observedState.revision }
  }

  return db.$transaction(async (tx) => {
    const claimed = await tx.catalogState.updateMany({
      where: { singletonKey: 'catalog', revision: expected.baseCatalogRevision },
      data: { revision: { increment: 1 } },
    })
    if (claimed.count !== 1) {
      throw new CatalogImportError('STALE_PREVIEW', 'Another import won the catalog revision')
    }
    const state = await tx.catalogState.findUniqueOrThrow({ where: { singletonKey: 'catalog' } })

    const preview = await previewWithTransaction(tx, loaded, expected.baseCatalogRevision)
    if (!preview.valid) throw new CatalogImportError('UNSAFE_IMPORT', 'Import has duplicates, invalid rows, or owner conflicts', preview)

    const familyIds = new Map<string, string>()
    for (const family of loaded.seed.families) {
      const saved = await tx.catalogFamily.upsert({
        where: { key: family.id },
        create: {
          key: family.id,
          slug: family.id,
          importedPublicName: family.publicName,
          publicName: family.publicName,
          description: familyDescription(family.publicName),
          row: family.row,
          purposes: purposesForFamily(family.id),
          functions: functionsForFamily(family.id),
        },
        update: {
          importedPublicName: family.publicName,
          publicName: family.publicName,
          row: family.row,
          isActive: true,
        },
      })
      familyIds.set(family.id, saved.id)
    }

    const incomingBySource = new Map(loaded.seed.modules.map((item) => [item.sourceRecordId, item]))
    const variantsBeforeSkuUpdate = await tx.catalogVariant.findMany({
      where: { sourceManaged: true },
      include: { sourceRecord: true },
    })
    for (const current of variantsBeforeSkuUpdate) {
      const sourceRecordId = current.sourceRecord?.sourceRecordId
      const incoming = sourceRecordId ? incomingBySource.get(sourceRecordId) : undefined
      if (incoming && current.sku !== incoming.sku && !stringArray(current.ownerEditedFields).includes('sku')) {
        await tx.catalogVariant.update({
          where: { id: current.id },
          data: { sku: `__catalog_import_${state.revision}_${current.id}` },
        })
      }
    }

    for (const item of loaded.seed.modules) {
      const data = importedData(item)
      const existingSource = await tx.catalogSourceRecord.findUnique({ where: { sourceRecordId: item.sourceRecordId } })
      const source = existingSource
        ? await tx.catalogSourceRecord.update({
          where: { id: existingSource.id },
          data: {
            sourceChecksum: sha256(canonicalJson(data)),
            sourceData: item.source as Prisma.InputJsonValue,
            isActive: true,
          },
        })
        : await tx.catalogSourceRecord.create({
          data: {
          sourceRecordId: item.sourceRecordId,
          sourceChecksum: sha256(canonicalJson(data)),
          sourceData: item.source as Prisma.InputJsonValue,
          },
        })
      const familyId = familyIds.get(item.familyId)
      if (!familyId) throw new CatalogImportError('INVALID_FAMILY', item.familyId)
      const currentVariant = await tx.catalogVariant.findUnique({ where: { sourceRecordId: source.id } })
      if (currentVariant) {
        const importedFields = changedImportedFields(currentVariant.importedData, data)
        const returnedToSource = existingSource?.isActive === false
        if (importedFields.length > 0 || returnedToSource) {
          await tx.catalogVariant.update({
            where: { id: currentVariant.id },
            data: {
              ...variantUpdate(item, data, familyId, stringArray(currentVariant.ownerEditedFields), returnedToSource),
              revision: { increment: 1 },
            },
          })
        }
      } else {
        await tx.catalogVariant.create({ data: variantCreate(item, data, source.id, familyId) })
      }
    }

    const importedSourceIds = loaded.seed.modules.map((item) => item.sourceRecordId)
    await tx.catalogVariant.updateMany({
      where: {
        sourceManaged: true,
        sourceRecord: { is: { isActive: true, sourceRecordId: { notIn: importedSourceIds } } },
      },
      data: { isActive: false, revision: { increment: 1 } },
    })
    await tx.catalogSourceRecord.updateMany({
      where: { isActive: true, sourceRecordId: { notIn: importedSourceIds } },
      data: { isActive: false },
    })

    const rates = launchRates(loaded.seed)
    const priceChecksum = sha256(canonicalJson(rates))
    await tx.priceVersion.upsert({
      where: { version: 1 },
      create: { version: 1, currency: 'RUB', rates, checksum: priceChecksum },
      update: {},
    })
    await ensurePricingBootstrap(tx, loaded.seed)

    const resultingRevision = state.revision
    await tx.catalogImportHistory.create({
      data: {
        sourceChecksum: loaded.checksum,
        sourceMapChecksum: loaded.sourceMapChecksum,
        baseRevision: expected.baseCatalogRevision,
        resultingRevision,
        reconciliation: preview as unknown as Prisma.InputJsonValue,
      },
    })
    return { ...preview, resultingRevision }
  }, { maxWait: 10_000, timeout: 30_000 })
}

async function previewWithTransaction(tx: Prisma.TransactionClient, loaded: LoadedCatalogSeed, revision: number) {
  const existing = await tx.catalogVariant.findMany({ include: { sourceRecord: true } })
  const families = await tx.catalogFamily.findMany()
  const price = await tx.priceVersion.findUnique({ where: { version: 1 } })
  const pseudoDb = {
    catalogState: { findUnique: async () => ({ revision }) },
    catalogVariant: { findMany: async () => existing },
    catalogFamily: { findMany: async () => families },
    priceVersion: { findUnique: async () => price },
  } as unknown as DbClient
  return previewCatalogImport(pseudoDb, loaded)
}

function importedData(item: CatalogSeedModule) {
  return {
    sku: item.sku,
    familyId: item.familyId,
    publicName: item.publicName,
    dimensionsMm: item.dimensionsMm,
    layoutSpanMm: item.layoutSpanMm ?? null,
    consumptionM2: item.consumptionM2,
    fastenerChargeRub: item.fasteners.chargeRub,
    cutPolicy: item.cutToWidth.policy,
    configuration: configurationDefaultsForFamily(item.familyId),
    variant: item.variant,
    fasteners: item.fasteners,
  }
}

function variantCreate(item: CatalogSeedModule, data: ReturnType<typeof importedData>, sourceRecordId: string, familyId: string) {
  return {
    sourceRecordId, familyId, sku: item.sku, importedData: data as Prisma.InputJsonValue,
    publicName: item.publicName, heightMm: item.dimensionsMm.height, widthMm: item.dimensionsMm.width,
    depthMm: item.dimensionsMm.depth, layoutSpanMm: item.layoutSpanMm,
    bodyM2: item.consumptionM2.body, facadeM2: item.consumptionM2.facade, hdfM2: item.consumptionM2.hdf,
    fastenerChargeRub: item.fasteners.chargeRub, cutPolicy: item.cutToWidth.policy,
    configurationData: data.configuration as Prisma.InputJsonValue,
    variantData: item.variant as Prisma.InputJsonValue, fastenersData: item.fasteners as Prisma.InputJsonValue,
  }
}

function variantUpdate(
  item: CatalogSeedModule,
  data: ReturnType<typeof importedData>,
  familyId: string,
  overrides: string[],
  returnedToSource: boolean,
) {
  const update: Prisma.CatalogVariantUpdateInput = {
    family: { connect: { id: familyId } },
    importedData: data as Prisma.InputJsonValue,
    ...(!overrides.includes('consumptionM2') ? {
      bodyM2: item.consumptionM2.body,
      facadeM2: item.consumptionM2.facade,
      hdfM2: item.consumptionM2.hdf,
    } : {}),
    ...(!overrides.includes('fastenerChargeRub') ? { fastenerChargeRub: item.fasteners.chargeRub } : {}),
    variantData: item.variant as Prisma.InputJsonValue,
    fastenersData: item.fasteners as Prisma.InputJsonValue,
  }
  if (returnedToSource && !overrides.includes('isActive')) update.isActive = true
  if (!overrides.includes('sku')) update.sku = item.sku
  if (!overrides.includes('publicName')) update.publicName = item.publicName
  if (!overrides.includes('heightMm')) update.heightMm = item.dimensionsMm.height
  if (!overrides.includes('widthMm')) update.widthMm = item.dimensionsMm.width
  if (!overrides.includes('depthMm')) update.depthMm = item.dimensionsMm.depth
  if (!overrides.includes('layoutSpanMm')) update.layoutSpanMm = item.layoutSpanMm ?? null
  if (!overrides.includes('cutPolicy')) update.cutPolicy = item.cutToWidth.policy
  if (!overrides.includes('configuration')) update.configurationData = data.configuration as Prisma.InputJsonValue
  return update
}

function changedImportedFields(current: unknown, next: ReturnType<typeof importedData>) {
  const before = (current ?? {}) as Record<string, unknown>
  const changed: string[] = []
  for (const key of Object.keys(next) as Array<keyof typeof next>) {
    if (key === 'dimensionsMm') {
      const prior = (before.dimensionsMm ?? {}) as Record<string, unknown>
      if (prior.height !== next.dimensionsMm.height) changed.push('heightMm')
      if (prior.width !== next.dimensionsMm.width) changed.push('widthMm')
      if (prior.depth !== next.dimensionsMm.depth) changed.push('depthMm')
    } else if (canonicalJson(before[key]) !== canonicalJson(next[key])) {
      changed.push(key)
    }
  }
  return changed
}

export function sourceTraceChanged(current: unknown, next: unknown) {
  return canonicalJson(current ?? null) !== canonicalJson(next ?? null)
}

type ExistingVariantForSku = {
  id: string
  sku: string
  sourceManaged: boolean
  ownerEditedFields: unknown
  sourceRecord: { sourceRecordId: string } | null
}

export function resultingSkuConflictSourceIds(
  existing: ExistingVariantForSku[],
  modules: CatalogSeedModule[],
) {
  const incomingBySource = new Map(modules.map((item) => [item.sourceRecordId, item]))
  const existingSourceIds = new Set(
    existing.flatMap((item) => item.sourceRecord ? [item.sourceRecord.sourceRecordId] : []),
  )
  const occupants = new Map<string, Array<{ identity: string; incomingSourceId: string | null }>>()
  const add = (sku: string, identity: string, incomingSourceId: string | null) => {
    const entries = occupants.get(sku) ?? []
    entries.push({ identity, incomingSourceId })
    occupants.set(sku, entries)
  }

  for (const current of existing) {
    const sourceRecordId = current.sourceRecord?.sourceRecordId ?? null
    const incoming = sourceRecordId ? incomingBySource.get(sourceRecordId) : undefined
    const keepsOwnerSku = stringArray(current.ownerEditedFields).includes('sku')
    const resultingSku = current.sourceManaged && incoming && !keepsOwnerSku ? incoming.sku : current.sku
    add(resultingSku, `variant:${current.id}`, incoming?.sourceRecordId ?? null)
  }
  for (const item of modules) {
    if (!existingSourceIds.has(item.sourceRecordId)) {
      add(item.sku, `source:${item.sourceRecordId}`, item.sourceRecordId)
    }
  }

  const conflicts = new Set<string>()
  for (const entries of occupants.values()) {
    if (new Set(entries.map((entry) => entry.identity)).size < 2) continue
    for (const entry of entries) {
      if (entry.incomingSourceId) conflicts.add(entry.incomingSourceId)
    }
  }
  return conflicts
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function record(item: CatalogSeedModule, reason?: string) {
  return { sourceRecordId: item.sourceRecordId, sku: item.sku, ...(reason ? { reason } : {}) }
}

function launchRates(seed: CatalogSeed) {
  return {
    bodyRubM2: seed.commercialRules.rates.body_rub_m2,
    facadeRubM2: seed.commercialRules.rates.facade_rub_m2,
    hdfRubM2: seed.commercialRules.rates.hdf_rub_m2,
    agtRubM2: seed.commercialRules.rates.agt_1_rub_m2,
    packagingRubM2: seed.commercialRules.rates.packaging_rub_m2,
    customerPriceMultiplier: seed.commercialRules.rates.customer_price_multiplier,
    includedVatFraction: seed.commercialRules.rates.included_vat_fraction,
    cutToWidthServiceRub: seed.commercialRules.rates.cut_to_width_service_rub,
    finalCustomerTotalRoundingRub: seed.commercialRules.finalCustomerTotalRoundingRub,
    bodyRatesRubM2: seed.materials.body.map((item) => item.rateRubM2),
    facadeRatesRubM2: seed.materials.facade.map((item) => item.rateRubM2),
    hdfRatesRubM2: seed.materials.hdf.map((item) => item.rateRubM2),
    palette: [
      ...seed.materials.body.map((item) => ({ ...item, kind: 'body', isActive: true })),
      ...seed.materials.facade.map((item) => ({ ...item, kind: 'facade', isActive: true })),
      ...seed.materials.hdf.map((item) => ({ ...item, kind: 'hdf', isActive: true })),
    ],
  }
}

function legacyLaunchRates(seed: CatalogSeed) {
  const { palette: _palette, ...legacy } = launchRates(seed)
  return legacy
}

async function ensurePricingBootstrap(tx: Prisma.TransactionClient, seed: CatalogSeed) {
  const state = await tx.pricingState.findUnique({
    where: { singletonKey: 'pricing' },
    include: { currentPriceVersion: true },
  })
  let current = state?.currentPriceVersion ?? await tx.priceVersion.findFirst({ orderBy: { version: 'desc' } })
  if (!current) throw new CatalogImportError('PRICE_VERSION_UNAVAILABLE', 'Could not initialize the launch price version')
  if (!pricingRatesSchema.safeParse(current.rates).success) {
    const latest = await tx.priceVersion.findFirst({ orderBy: { version: 'desc' } })
    if (!latest) throw new CatalogImportError('PRICE_VERSION_UNAVAILABLE', 'Could not initialize the price palette')
    const rates = launchRates(seed)
    current = await tx.priceVersion.create({
      data: {
        version: latest.version + 1,
        currency: 'RUB',
        rates: rates as Prisma.InputJsonValue,
        checksum: sha256(canonicalJson(rates)),
      },
    })
  }
  const parsedRates = pricingRatesSchema.parse(current.rates)
  const pricingState = await tx.pricingState.upsert({
    where: { singletonKey: 'pricing' },
    create: { singletonKey: 'pricing', currentPriceVersionId: current.id },
    update: { currentPriceVersionId: current.id },
  })
  await tx.priceDraft.upsert({
    where: { singletonKey: 'pricing' },
    create: { singletonKey: 'pricing', basePriceVersionId: pricingState.currentPriceVersionId!, rates: parsedRates as Prisma.InputJsonValue },
    update: {},
  })
}

function familyDescription(name: string) {
  return `${name}: серийные размеры и варианты для быстрого расчёта кухни.`
}

function purposesForFamily(key: string) {
  if (key.includes('sink')) return ['мойка']
  if (key.includes('dishwasher')) return ['посудомоечная машина']
  if (key.includes('oven')) return ['духовой шкаф']
  if (key.includes('fridge')) return ['холодильник']
  return ['хранение']
}

function functionsForFamily(key: string) {
  if (key.includes('drawer')) return ['ящики']
  if (key.includes('aventos') || key.includes('klok')) return ['подъёмник']
  if (key.includes('corner')) return ['угловой']
  if (key.includes('panel') || key.includes('cornice') || key.includes('plinth')) return ['доборный элемент']
  return ['распашной']
}

export class CatalogImportError extends Error {
  constructor(public readonly code: string, message: string, public readonly details?: unknown) {
    super(message)
  }
}
