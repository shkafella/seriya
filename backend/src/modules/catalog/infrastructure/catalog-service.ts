import {
  catalogRatesSchema,
  configurationMetadataSchema,
  ownerCatalogResponseSchema,
  ownerCatalogVariantEditSchema,
  publicCatalogSchema,
  pricingRatesSchema,
  type OwnerCatalogVariantEdit,
  type PublicCatalog,
  type PublicCatalogFamily,
  type PublicPriceMode,
} from '@seriya/contracts'
import type { Prisma } from '../../../generated/prisma/client'

import type { DbClient } from '../../../db'
import { AppError } from '../../../http/errors'
import { calculatePublicPriceRange, ensurePricingBootstrap } from '../../pricing'
import { canonicalJson, sha256 } from '../application/canonical-json'
import { configurationDefaultsForFamily } from '../application/configuration-defaults'

type ActivationInput = {
  candidateId: string
  releaseId: string
  releasePath: string
  previousReleasePath?: string
  backupReceipt: { backupId: string; completedAt: string; database: string; integrity: string }
  expectedDatabase: string
  requireProductionAssets: boolean
}

export class CatalogService {
  constructor(private readonly db: DbClient) {}

  async assertOwner(userId: string) {
    const owner = await this.db.ownerIdentity.findUnique({ where: { singletonKey: 'owner' } })
    if (!owner || owner.userId !== userId) throw new AppError(403, 'OWNER_REQUIRED', 'Catalog owner access required')
  }

  async ownerCatalog() {
    await this.db.$transaction(async (tx) => { await ensurePricingBootstrap(tx) })
    const [state, pricingState, variants, assets, latestCandidate] = await Promise.all([
      this.db.catalogState.findUnique({ where: { singletonKey: 'catalog' }, include: { activePublication: true } }),
      this.db.pricingState.findUnique({ where: { singletonKey: 'pricing' }, include: { currentPriceVersion: true } }),
      this.db.catalogVariant.findMany({ include: { family: true }, orderBy: [{ family: { publicName: 'asc' } }, { widthMm: 'asc' }] }),
      this.db.catalogAsset.findMany({ orderBy: { key: 'asc' } }),
      this.db.catalogPublication.findFirst({ where: { status: 'CANDIDATE' }, orderBy: { createdAt: 'desc' } }),
    ])
    if (!state || !pricingState?.currentPriceVersion) throw new AppError(409, 'CATALOG_NOT_IMPORTED', 'Import the approved catalog first')
    const activePublicationIsCurrent = state.activePublication?.catalogRevision === state.revision
      && state.activePublication.priceVersionId === pricingState.currentPriceVersion.id
    const publicationStatus = latestCandidate?.catalogRevision === state.revision && latestCandidate.priceVersionId === pricingState.currentPriceVersion.id
      ? 'AWAITING_RELEASE'
      : activePublicationIsCurrent
        ? 'PUBLISHED'
        : 'UNPREPARED'
    return ownerCatalogResponseSchema.parse({
      catalogRevision: state.revision,
      activePublicationId: state.activePublicationId,
      activationState: state.activationState,
      publicationStatus,
      hasUnpreparedChanges: publicationStatus === 'UNPREPARED',
      priceVersion: priceDto(pricingState.currentPriceVersion),
      assets: assets.map((asset) => ({
        id: asset.id,
        key: asset.key,
        publicPath: asset.publicPath,
        status: asset.status,
        productionApproved: asset.productionApproved,
      })),
      variants: variants.map(ownerVariantDto),
    })
  }

  async editVariant(userId: string, variantId: string, input: unknown) {
    const command = ownerCatalogVariantEditSchema.parse(input)
    try {
      return await this.db.$transaction(async (tx) => {
        const variant = await tx.catalogVariant.findUnique({ where: { id: variantId }, include: { family: true } })
        if (!variant) throw new AppError(404, 'CATALOG_VARIANT_NOT_FOUND', 'Catalog variant not found')
        if (variant.revision !== command.revision) throw new AppError(409, 'STALE_CATALOG_EDIT', 'This item changed; reload and try again')
        const state = await tx.catalogState.findUnique({ where: { singletonKey: 'catalog' } })
        if (!state) throw new AppError(409, 'CATALOG_NOT_IMPORTED', 'Import the approved catalog first')
        const before = ownerVariantDto(variant)
        const actualChanges = Object.fromEntries(
          Object.entries(command.changes).filter(([key, value]) => canonicalJson(ownerFieldValue(variant, key)) !== canonicalJson(value)),
        ) as OwnerCatalogVariantEdit['changes']
        if (Object.keys(actualChanges).length === 0) return before
        if (actualChanges.sku !== undefined) {
          const existingSku = await tx.catalogVariant.findFirst({
            where: { sku: actualChanges.sku, NOT: { id: variantId } },
            select: { id: true },
          })
          if (existingSku) throw duplicateCatalogSkuError()
        }
        if (actualChanges.assetId !== undefined && actualChanges.assetId !== null) {
          const asset = await tx.catalogAsset.findUnique({ where: { id: actualChanges.assetId }, select: { id: true } })
          if (!asset) throw new AppError(400, 'VALIDATION_ERROR', 'Selected catalog asset does not exist', { field: 'assetId' })
        }
        const editedFields = new Set(stringArray(variant.ownerEditedFields))
        for (const key of Object.keys(actualChanges)) editedFields.add(key)
        const data = editData({ ...command, changes: actualChanges }, [...editedFields])
        const claimed = await tx.catalogVariant.updateMany({
          where: { id: variantId, revision: command.revision },
          data: { ...data, revision: { increment: 1 } },
        })
        if (claimed.count !== 1) throw new AppError(409, 'STALE_CATALOG_EDIT', 'This item changed; reload and try again')
        const updated = await tx.catalogVariant.findUniqueOrThrow({ where: { id: variantId }, include: { family: true } })
        await tx.catalogState.update({ where: { id: state.id }, data: { revision: { increment: 1 } } })
        await tx.catalogEditHistory.create({
          data: {
            variantId, userId,
            before: before as unknown as Prisma.InputJsonValue,
            after: ownerVariantDto(updated) as unknown as Prisma.InputJsonValue,
          },
        })
        return ownerVariantDto(updated)
      })
    } catch (error) {
      if (prismaErrorCode(error) === 'P2002') throw duplicateCatalogSkuError()
      if (prismaErrorCode(error) === 'P2003') {
        throw new AppError(400, 'VALIDATION_ERROR', 'Selected catalog asset does not exist', { field: 'assetId' })
      }
      throw error
    }
  }

  async prepareCandidate() {
    return this.db.$transaction(async (tx) => {
      const state = await lockCatalogState(tx)
      await ensurePricingBootstrap(tx)
      const pricingState = await lockPricingState(tx)
      if (!pricingState.currentPriceVersionId) throw new AppError(409, 'CATALOG_NOT_IMPORTED', 'Import the approved catalog first')
      const price = await tx.priceVersion.findUnique({ where: { id: pricingState.currentPriceVersionId } })
      if (!price) throw new AppError(409, 'CATALOG_NOT_IMPORTED', 'Import the approved catalog first')
      const existing = await tx.catalogPublication.findFirst({
        where: { status: 'CANDIDATE', catalogRevision: state.revision, priceVersionId: price.id },
        orderBy: { createdAt: 'desc' },
      })
      if (existing) {
        const snapshot = publicCatalogSchema.parse(existing.snapshot)
        return { candidateId: existing.id, releaseId: snapshot.releaseId, catalogRevision: existing.catalogRevision, checksum: existing.checksum, status: 'AWAITING_RELEASE' as const }
      }

      const [{ id: publicationId }] = await tx.$queryRaw<Array<{ id: string }>>`SELECT uuidv7()::text AS id`
      const snapshot = await buildPublicSnapshot(tx, publicationId, state.revision, price)
      const pricingSnapshot = await buildConfigurationPricingSnapshot(tx, publicationId, price)
      const checksum = sha256(canonicalJson(snapshot))
      await tx.catalogPublication.create({
        data: {
          id: publicationId,
          catalogRevision: state.revision,
          priceVersionId: price.id,
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          pricingSnapshot: pricingSnapshot as unknown as Prisma.InputJsonValue,
          checksum,
        },
      })
      return { candidateId: publicationId, releaseId: snapshot.releaseId, catalogRevision: state.revision, checksum, status: 'AWAITING_RELEASE' as const }
    })
  }

  async publicCatalog(): Promise<PublicCatalog> {
    const state = await this.db.catalogState.findUnique({
      where: { singletonKey: 'catalog' },
      include: { activePublication: true },
    })
    if (state?.activationState === 'MAINTENANCE') throw new AppError(503, 'CATALOG_MAINTENANCE', 'Catalog publication is being switched')
    if (!state?.activePublication) throw new AppError(404, 'CATALOG_NOT_PUBLISHED', 'Catalog is not published yet')
    return publicCatalogSchema.parse(state.activePublication.snapshot)
  }

  async releaseSmokeCatalog(candidateId: string): Promise<PublicCatalog> {
    const [state, attempt] = await Promise.all([
      this.db.catalogState.findUnique({
        where: { singletonKey: 'catalog' },
        include: { activePublication: true },
      }),
      this.db.catalogActivationAttempt.findFirst({
        where: { nextPublicationId: candidateId, status: 'PUBLICATION_SWITCHED' },
        orderBy: { createdAt: 'desc' },
      }),
    ])
    if (!state || state.activationState !== 'MAINTENANCE' || state.activePublicationId !== candidateId || !state.activePublication || !attempt) {
      throw new AppError(404, 'NOT_FOUND', 'Release smoke catalog is not available')
    }
    return publicCatalogSchema.parse(state.activePublication.snapshot)
  }

  async markApplicationSwitched(candidateId: string, releasePath: string) {
    const claimed = await this.db.catalogActivationAttempt.updateMany({
      where: { nextPublicationId: candidateId, nextReleasePath: releasePath, status: 'PREPARED' },
      data: { status: 'APPLICATION_SWITCHED' },
    })
    if (claimed.count !== 1) throw new AppError(409, 'INVALID_ACTIVATION_STATE', 'Prepared activation attempt was not found')
  }

  async activateCandidate(input: ActivationInput) {
    validateBackupReceipt(input.backupReceipt, input.expectedDatabase)
    const attempt = await this.db.catalogActivationAttempt.findFirst({
      where: { nextPublicationId: input.candidateId, nextReleasePath: input.releasePath, status: 'APPLICATION_SWITCHED' },
      orderBy: { createdAt: 'desc' },
    })
    if (!attempt) throw new AppError(409, 'INVALID_ACTIVATION_STATE', 'Application release has not been switched')
    return this.db.$transaction(async (tx) => {
      const state = await lockCatalogState(tx)
      const pricingState = await lockPricingState(tx)
      const candidate = await tx.catalogPublication.findUnique({ where: { id: input.candidateId } })
      if (state.activationState !== 'MAINTENANCE' || !candidate || candidate.status !== 'CANDIDATE') throw new AppError(409, 'INVALID_CANDIDATE', 'Candidate is missing or no longer pending')
      if (candidate.catalogRevision !== state.revision) throw new AppError(409, 'STALE_CANDIDATE', 'Catalog changed after candidate preparation')
      if (candidate.priceVersionId !== pricingState.currentPriceVersionId) throw new AppError(409, 'STALE_CANDIDATE', 'Prices changed after candidate preparation')
      const snapshot = publicCatalogSchema.parse(candidate.snapshot)
      if (snapshot.releaseId !== input.releaseId) throw new AppError(409, 'RELEASE_MISMATCH', 'Release ID does not match candidate snapshot')
      if (input.requireProductionAssets) await assertProductionAssetCoverage(tx, snapshot)
      if (state.activePublicationId) {
        await tx.catalogPublication.update({ where: { id: state.activePublicationId }, data: { status: 'SUPERSEDED' } })
      }
      await tx.catalogPublication.update({
        where: { id: candidate.id },
        data: {
          status: 'ACTIVE', releaseId: input.releaseId,
          backupReceipt: input.backupReceipt as Prisma.InputJsonValue,
          activatedAt: new Date(),
        },
      })
      await tx.catalogState.update({
        where: { id: state.id },
        data: { activePublicationId: candidate.id, activationState: 'MAINTENANCE' },
      })
      await tx.catalogActivationAttempt.update({ where: { id: attempt.id }, data: { status: 'PUBLICATION_SWITCHED' } })
      return { publicationId: candidate.id, releaseId: input.releaseId }
    }, { maxWait: 10_000, timeout: 30_000 })
  }

  async verifyActivation(candidateId: string, releasePath: string) {
    return this.db.$transaction(async (tx) => {
      const attempt = await tx.catalogActivationAttempt.findFirst({
        where: { nextPublicationId: candidateId, nextReleasePath: releasePath, status: 'PUBLICATION_SWITCHED' },
        orderBy: { createdAt: 'desc' },
      })
      const state = await tx.catalogState.findUnique({ where: { singletonKey: 'catalog' } })
      if (!attempt || !state || state.activePublicationId !== candidateId || state.activationState !== 'MAINTENANCE') {
        throw new AppError(409, 'INVALID_ACTIVATION_STATE', 'Publication switch is not ready for verification')
      }
      const verifiedAt = new Date()
      await tx.catalogPublication.updateMany({
        where: { id: candidateId, status: 'ACTIVE', publicVerifiedAt: null },
        data: { publicVerifiedAt: verifiedAt },
      })
      await tx.catalogState.update({ where: { id: state.id }, data: { activationState: 'IDLE' } })
      await tx.catalogActivationAttempt.update({ where: { id: attempt.id }, data: { status: 'VERIFIED' } })
      return { publicationId: candidateId, verified: true as const }
    })
  }

  async bootstrapPublicVerification() {
    return this.db.$transaction(async (tx) => {
      const markedPublicationIds: string[] = []
      const verifiedAttempts = await tx.catalogActivationAttempt.findMany({
        where: { status: 'VERIFIED' },
        include: { nextPublication: true },
        orderBy: { updatedAt: 'asc' },
      })

      for (const attempt of verifiedAttempts) {
        const publication = attempt.nextPublication
        if (publication.publicVerifiedAt || !hasConsistentPublicEvidence(publication)) continue
        const marked = await tx.catalogPublication.updateMany({
          where: { id: publication.id, publicVerifiedAt: null },
          data: { publicVerifiedAt: attempt.updatedAt },
        })
        if (marked.count === 1) markedPublicationIds.push(publication.id)
      }

      const state = await tx.catalogState.findUnique({
        where: { singletonKey: 'catalog' },
        include: { activePublication: true },
      })
      const active = state?.activePublication
      if (state?.activationState === 'IDLE' && active?.status === 'ACTIVE'
        && !active.publicVerifiedAt && hasConsistentPublicEvidence(active)) {
        const marked = await tx.catalogPublication.updateMany({
          where: { id: active.id, status: 'ACTIVE', publicVerifiedAt: null },
          data: { publicVerifiedAt: new Date() },
        })
        if (marked.count === 1) markedPublicationIds.push(active.id)
      }

      return {
        markedPublicationIds: [...new Set(markedPublicationIds)],
        markedCount: new Set(markedPublicationIds).size,
      }
    })
  }

  async recoverActivation(candidateId?: string) {
    const attempt = await this.db.catalogActivationAttempt.findFirst({
      where: { ...(candidateId ? { nextPublicationId: candidateId } : {}), status: 'FAILED' },
      orderBy: { createdAt: 'desc' },
    })
    if (!attempt) return null
    return this.db.$transaction(async (tx) => {
      const state = await tx.catalogState.findUniqueOrThrow({ where: { singletonKey: 'catalog' } })
      const next = await tx.catalogPublication.findUnique({ where: { id: attempt.nextPublicationId } })
      if (next?.status === 'ACTIVE') {
        await tx.catalogPublication.update({
          where: { id: next.id },
          data: { status: 'CANDIDATE', releaseId: null, backupReceipt: undefined, activatedAt: null },
        })
      }
      if (attempt.previousPublicationId) {
        await tx.catalogPublication.update({ where: { id: attempt.previousPublicationId }, data: { status: 'ACTIVE' } })
      }
      await tx.catalogState.update({ where: { id: state.id }, data: { activePublicationId: attempt.previousPublicationId, activationState: 'IDLE' } })
      await tx.catalogActivationAttempt.update({ where: { id: attempt.id }, data: { status: 'ROLLED_BACK', recoveryDecision: 'RESTORE_PREVIOUS' } })
      return attempt
    })
  }

  async startRecovery(candidateId: string) {
    return this.db.$transaction(async (tx) => {
      const attempt = await tx.catalogActivationAttempt.findFirst({
        where: {
          nextPublicationId: candidateId,
          status: { in: ['PREPARED', 'APPLICATION_SWITCHED', 'PUBLICATION_SWITCHED', 'VERIFIED', 'FAILED'] },
        },
        orderBy: { createdAt: 'desc' },
      })
      if (!attempt) return null
      if (attempt.status !== 'FAILED') {
        await tx.catalogState.update({
          where: { singletonKey: 'catalog' },
          data: { activationState: 'MAINTENANCE' },
        })
        await tx.catalogActivationAttempt.update({
          where: { id: attempt.id },
          data: { status: 'FAILED', recoveryDecision: 'RESTORE_PREVIOUS', error: 'Release recovery requested' },
        })
      }
      return attempt
    })
  }

  async beginActivation(input: ActivationInput) {
    validateBackupReceipt(input.backupReceipt, input.expectedDatabase)
    return this.db.$transaction(async (tx) => {
      const inProgress = await tx.catalogActivationAttempt.findFirst({
        where: { status: { in: ['PREPARED', 'APPLICATION_SWITCHED', 'PUBLICATION_SWITCHED'] } },
      })
      if (inProgress) {
        if (inProgress.nextPublicationId === input.candidateId && inProgress.nextReleasePath === input.releasePath) return inProgress
        throw new AppError(409, 'CONFLICT', 'Another catalog activation requires recovery')
      }
      const state = await lockCatalogState(tx)
      const pricingState = await lockPricingState(tx)
      const candidate = await tx.catalogPublication.findUnique({ where: { id: input.candidateId } })
      if (state.activationState !== 'IDLE' || !candidate || candidate.status !== 'CANDIDATE') {
        throw new AppError(409, 'INVALID_CANDIDATE', 'Candidate is missing or catalog activation is not idle')
      }
      if (candidate.catalogRevision !== state.revision) throw new AppError(409, 'STALE_CANDIDATE', 'Catalog changed after candidate preparation')
      if (candidate.priceVersionId !== pricingState.currentPriceVersionId) throw new AppError(409, 'STALE_CANDIDATE', 'Prices changed after candidate preparation')
      const snapshot = publicCatalogSchema.parse(candidate.snapshot)
      if (snapshot.releaseId !== input.releaseId) throw new AppError(409, 'RELEASE_MISMATCH', 'Release ID does not match candidate snapshot')
      if (input.requireProductionAssets) await assertProductionAssetCoverage(tx, snapshot)
      const claimed = await tx.catalogState.updateMany({
        where: { id: state.id, activationState: 'IDLE' },
        data: { activationState: 'MAINTENANCE' },
      })
      if (claimed.count !== 1) throw new AppError(409, 'CONFLICT', 'Another catalog activation won the maintenance gate')
      return tx.catalogActivationAttempt.create({
        data: {
          previousPublicationId: state.activePublicationId,
          nextPublicationId: candidate.id,
          previousReleasePath: input.previousReleasePath,
          nextReleasePath: input.releasePath,
          status: 'PREPARED',
        },
      })
    })
  }
}

function ownerFieldValue(variant: {
  sku: string; publicName: string; heightMm: number; widthMm: number; depthMm: number;
  layoutSpanMm: number | null; bodyM2: unknown; facadeM2: unknown; hdfM2: unknown; fastenerChargeRub: unknown;
  configurationData: unknown; family?: { key: string }; isActive: boolean; cutPolicy: string; assetId: string | null;
}, key: string) {
  switch (key) {
    case 'sku': return variant.sku
    case 'publicName': return variant.publicName
    case 'heightMm': return variant.heightMm
    case 'widthMm': return variant.widthMm
    case 'depthMm': return variant.depthMm
    case 'layoutSpanMm': return variant.layoutSpanMm
    case 'consumptionM2': return { body: Number(variant.bodyM2), facade: Number(variant.facadeM2), hdf: Number(variant.hdfM2) }
    case 'fastenerChargeRub': return Number(variant.fastenerChargeRub)
    case 'configuration': return configurationForStoredVariant(variant.configurationData, variant.family?.key)
    case 'isActive': return variant.isActive
    case 'cutPolicy': return variant.cutPolicy
    case 'assetId': return variant.assetId
    default: return undefined
  }
}

function hasConsistentPublicEvidence(publication: {
  activatedAt: Date | null
  checksum: string
  releaseId: string | null
  snapshot: unknown
  status: 'CANDIDATE' | 'ACTIVE' | 'SUPERSEDED'
}) {
  if (!publication.activatedAt || !publication.releaseId || publication.status === 'CANDIDATE') return false
  try {
    const snapshot = publicCatalogSchema.parse(publication.snapshot)
    return snapshot.releaseId === publication.releaseId && sha256(canonicalJson(snapshot)) === publication.checksum
  } catch {
    return false
  }
}

function duplicateCatalogSkuError() {
  return new AppError(409, 'CONFLICT', 'Another catalog variant already uses this SKU', { field: 'sku' })
}

function prismaErrorCode(error: unknown) {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}

async function buildPublicSnapshot(
  tx: Prisma.TransactionClient,
  publicationId: string,
  revision: number,
  price: { id: string; version: number; currency: string; rates: unknown; checksum: string; publishedAt: Date },
) {
  const families = await tx.catalogFamily.findMany({
    where: { isActive: true, variants: { some: { isActive: true, isComplete: true } } },
    include: { asset: true, variants: { where: { isActive: true, isComplete: true }, include: { asset: true }, orderBy: { widthMm: 'asc' } } },
    orderBy: { publicName: 'asc' },
  })
  const ratesJson = price.rates as Record<string, unknown>
  const rates = catalogRatesSchema.parse(ratesJson)
  const materialRates = {
    bodyRatesRubM2: numberArray(ratesJson.bodyRatesRubM2, [rates.bodyRubM2]),
    facadeRatesRubM2: numberArray(ratesJson.facadeRatesRubM2, [rates.facadeRubM2, rates.agtRubM2]),
    hdfRatesRubM2: numberArray(ratesJson.hdfRatesRubM2, [rates.hdfRubM2]),
    multiplier: rates.customerPriceMultiplier,
    roundingRub: rates.finalCustomerTotalRoundingRub,
  }
  const dtoFamilies: PublicCatalogFamily[] = families.map((family) => {
    if (!family.asset) throw new AppError(409, 'CATALOG_ASSETS_INCOMPLETE', `Family ${family.key} has no catalog asset`)
    const mode = publicPriceMode(family.key)
    const prices = family.variants.map((variant) => calculatePublicPriceRange({
      mode, bodyM2: Number(variant.bodyM2), facadeM2: Number(variant.facadeM2),
      hdfM2: Number(variant.hdfM2), fastenerChargeRub: Number(variant.fastenerChargeRub),
    }, materialRates))
    const familyAsset = family.asset.publicPath
    return {
      id: family.id,
      key: family.key,
      slug: family.slug,
      publicName: family.publicName,
      description: family.description,
      row: family.row as PublicCatalogFamily['row'],
      purposes: stringArray(family.purposes),
      functions: stringArray(family.functions),
      widthsMm: [...new Set(family.variants.map((item) => item.widthMm))].sort((a, b) => a - b),
      assetPath: familyAsset,
      priceRange: {
        mode,
        minRub: Math.min(...prices.map((item) => item.minRub)),
        maxRub: Math.max(...prices.map((item) => item.maxRub)),
        currency: 'RUB',
        unitLabel: priceLabel(mode),
        includesFacade: mode !== 'ordinary',
        includesPackaging: false,
      },
      exclusions: exclusions(mode),
      variants: family.variants.map((variant) => ({
        id: variant.id, sku: variant.sku, publicName: variant.publicName,
        dimensionsMm: { height: variant.heightMm, width: variant.widthMm, depth: variant.depthMm, ...(variant.layoutSpanMm ? { layoutSpan: variant.layoutSpanMm } : {}) },
        cutToWidth: { allowed: variant.cutPolicy === 'allowed', maxReductionMm: variant.cutPolicy === 'allowed' ? 50 : null, stepMm: variant.cutPolicy === 'allowed' ? 1 : null },
        assetPath: variant.asset?.publicPath ?? familyAsset,
        variant: variant.variantData as Record<string, unknown>,
      })),
    }
  })
  return publicCatalogSchema.parse({
    schemaVersion: 1,
    publicationId,
    releaseId: `candidate-${publicationId}`,
    catalogRevision: revision,
    generatedAt: new Date().toISOString(),
    priceVersion: priceDto(price),
    families: dtoFamilies,
  })
}

async function buildConfigurationPricingSnapshot(
  tx: Prisma.TransactionClient,
  publicationId: string,
  price: { id: string; rates: unknown },
) {
  const rates = pricingRatesSchema.parse(price.rates)
  const variants = await tx.catalogVariant.findMany({
    where: { isActive: true, isComplete: true, family: { is: { isActive: true } } },
    include: { family: true },
    orderBy: [{ family: { key: 'asc' } }, { widthMm: 'asc' }],
  })
  if (variants.length === 0) throw new AppError(409, 'CATALOG_NOT_IMPORTED', 'No active catalog variants are available for configuration')
  return {
    publicationId,
    priceVersionId: price.id,
    rates: {
      packagingRubM2: rates.packagingRubM2,
      customerPriceMultiplier: rates.customerPriceMultiplier,
      includedVatFraction: rates.includedVatFraction,
      cutToWidthServiceRub: rates.cutToWidthServiceRub,
      finalCustomerTotalRoundingRub: rates.finalCustomerTotalRoundingRub,
    },
    materials: rates.palette,
    variants: variants.map((variant) => ({
      id: variant.id,
      familyKey: variant.family.key,
      row: variant.family.row,
      sku: variant.sku,
      publicName: variant.publicName,
      heightMm: variant.heightMm,
      widthMm: variant.widthMm,
      depthMm: variant.depthMm,
      layoutSpanMm: variant.layoutSpanMm,
      consumption: { body: Number(variant.bodyM2), facade: Number(variant.facadeM2), hdf: Number(variant.hdfM2) },
      fastenerChargeRub: Number(variant.fastenerChargeRub),
      cutPolicy: variant.cutPolicy,
      configuration: configurationForStoredVariant(variant.configurationData, variant.family.key),
      customerSupplied: customerSuppliedComments(variant.fastenersData),
    })),
  }
}

function ownerVariantDto(variant: {
  id: string; sourceRecordId: string | null; familyId: string; family: { key: string }; sku: string; publicName: string;
  heightMm: number; widthMm: number; depthMm: number; layoutSpanMm: number | null;
  bodyM2: unknown; facadeM2: unknown; hdfM2: unknown; fastenerChargeRub: unknown;
  cutPolicy: string; configurationData: unknown; isActive: boolean; isComplete: boolean; sourceManaged: boolean;
  ownerEditedFields: unknown; assetId: string | null; revision: number; updatedAt: Date;
}) {
  return {
    id: variant.id, sourceRecordId: variant.sourceRecordId, familyId: variant.familyId,
    sku: variant.sku, publicName: variant.publicName,
    dimensionsMm: { height: variant.heightMm, width: variant.widthMm, depth: variant.depthMm, ...(variant.layoutSpanMm ? { layoutSpan: variant.layoutSpanMm } : {}) },
    consumptionM2: { body: Number(variant.bodyM2), facade: Number(variant.facadeM2), hdf: Number(variant.hdfM2) },
    fastenerChargeRub: Number(variant.fastenerChargeRub),
    cutPolicy: variant.cutPolicy as 'allowed' | 'forbidden', isActive: variant.isActive, isComplete: variant.isComplete,
    configuration: configurationForStoredVariant(variant.configurationData, variant.family.key),
    sourceManaged: variant.sourceManaged, ownerEditedFields: stringArray(variant.ownerEditedFields),
    assetId: variant.assetId, revision: variant.revision, updatedAt: variant.updatedAt.toISOString(),
  }
}

function editData(command: OwnerCatalogVariantEdit, ownerEditedFields: string[]): Prisma.CatalogVariantUpdateManyMutationInput {
  const changes = command.changes
  return {
    ...(changes.sku !== undefined ? { sku: changes.sku } : {}),
    ...(changes.publicName !== undefined ? { publicName: changes.publicName } : {}),
    ...(changes.heightMm !== undefined ? { heightMm: changes.heightMm } : {}),
    ...(changes.widthMm !== undefined ? { widthMm: changes.widthMm } : {}),
    ...(changes.depthMm !== undefined ? { depthMm: changes.depthMm } : {}),
    ...(changes.layoutSpanMm !== undefined ? { layoutSpanMm: changes.layoutSpanMm } : {}),
    ...(changes.consumptionM2 !== undefined ? {
      bodyM2: changes.consumptionM2.body,
      facadeM2: changes.consumptionM2.facade,
      hdfM2: changes.consumptionM2.hdf,
    } : {}),
    ...(changes.fastenerChargeRub !== undefined ? { fastenerChargeRub: changes.fastenerChargeRub } : {}),
    ...(changes.configuration !== undefined ? { configurationData: changes.configuration as Prisma.InputJsonValue } : {}),
    ...(changes.isActive !== undefined ? { isActive: changes.isActive } : {}),
    ...(changes.cutPolicy !== undefined ? { cutPolicy: changes.cutPolicy } : {}),
    ...(changes.assetId !== undefined ? { assetId: changes.assetId } : {}),
    ownerEditedFields,
  }
}

function priceDto(price: { id: string; version: number; currency: string; rates: unknown; checksum: string; publishedAt: Date }) {
  return {
    id: price.id, version: price.version, currency: price.currency,
    rates: catalogRatesSchema.parse(price.rates), checksum: price.checksum,
    publishedAt: price.publishedAt.toISOString(),
  }
}

function publicPriceMode(familyKey: string): PublicPriceMode {
  if (familyKey === 'false-panel') return 'false_panel'
  if (['cornice', 'deep-cornice', 'plinth'].includes(familyKey)) return 'trim_piece'
  return 'ordinary'
}

function priceLabel(mode: PublicPriceMode) {
  if (mode === 'ordinary') return 'Цена модуля без фасадов и упаковки'
  if (mode === 'false_panel') return 'Цена за панель; зависит от фасада'
  return 'Цена за одну целую деталь 2700 мм'
}

function exclusions(mode: PublicPriceMode) {
  const common = ['Столешница не входит', 'Фурнитура клиента не входит', 'Упаковка не входит']
  return mode === 'ordinary' ? ['Фасады не входят', ...common] : common
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function configurationForStoredVariant(value: unknown, familyKey: string | undefined) {
  if (
    familyKey
    && typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Object.keys(value).length === 0
  ) {
    return configurationDefaultsForFamily(familyKey)
  }
  return configurationMetadataSchema.parse(value)
}

function customerSuppliedComments(value: unknown) {
  if (!value || typeof value !== 'object') return []
  const supplied = (value as { customerSupplied?: unknown }).customerSupplied
  if (!Array.isArray(supplied)) return []
  return supplied.flatMap((line) => {
    if (!line || typeof line !== 'object' || typeof (line as { item?: unknown }).item !== 'string') return []
    const item = (line as { item: string }).item
    return item ? [`${item}: покупают сами` ] : []
  })
}

function numberArray(value: unknown, fallback: number[]) {
  return Array.isArray(value) && value.every((item) => typeof item === 'number') ? value : fallback
}

async function lockCatalogState(tx: Prisma.TransactionClient) {
  const states = await tx.$queryRaw<Array<{
    id: string
    revision: number
    activePublicationId: string | null
    activationState: 'IDLE' | 'MAINTENANCE'
  }>>`
    SELECT id, revision, active_publication_id AS "activePublicationId", activation_state AS "activationState"
    FROM catalog_state WHERE singleton_key = 'catalog' FOR UPDATE
  `
  const state = states[0]
  if (!state) throw new AppError(409, 'CATALOG_NOT_IMPORTED', 'Import the approved catalog first')
  return state
}

async function lockPricingState(tx: Prisma.TransactionClient) {
  const states = await tx.$queryRaw<Array<{ currentPriceVersionId: string | null }>>`
    SELECT current_price_version_id AS "currentPriceVersionId"
    FROM pricing_state WHERE singleton_key = 'pricing' FOR UPDATE
  `
  const state = states[0]
  if (!state?.currentPriceVersionId) throw new AppError(409, 'CATALOG_NOT_IMPORTED', 'Import the approved catalog first')
  return state
}

function validateBackupReceipt(
  receipt: { backupId: string; completedAt: string; database: string; integrity: string },
  expectedDatabase: string,
) {
  const completedAt = Date.parse(receipt.completedAt)
  if (!receipt.backupId || receipt.database !== expectedDatabase || !/^sha256:[a-f0-9]{64}$/.test(receipt.integrity) || Number.isNaN(completedAt)) {
    throw new AppError(409, 'INVALID_BACKUP_RECEIPT', 'A valid database backup receipt is required')
  }
  const age = Date.now() - completedAt
  if (age < -5 * 60 * 1000) throw new AppError(409, 'INVALID_BACKUP_RECEIPT', 'Database backup receipt is from the future')
  if (age > 24 * 60 * 60 * 1000) {
    throw new AppError(409, 'STALE_BACKUP_RECEIPT', 'Database backup receipt is older than 24 hours')
  }
}

async function assertProductionAssetCoverage(tx: Prisma.TransactionClient, snapshot: PublicCatalog) {
  const expectedPaths = new Set(snapshot.families.flatMap((family) => [family.assetPath, ...family.variants.map((variant) => variant.assetPath)]))
  const assets = await tx.catalogAsset.findMany({ where: { publicPath: { in: [...expectedPaths] } } })
  const approved = new Set(assets.filter((asset) => asset.status === 'APPROVED'
    && asset.rightsApproved && asset.productionApproved && /^[a-f0-9]{64}$/.test(asset.derivedChecksum)
    && Boolean(asset.sourceChecksum?.match(/^[a-f0-9]{64}$/))
    && asset.provenance !== null && typeof asset.provenance === 'object' && Object.keys(asset.provenance as object).length > 0)
    .map((asset) => asset.publicPath))
  const missing = [...expectedPaths].filter((path) => !approved.has(path))
  if (missing.length > 0) throw new AppError(409, 'PRODUCTION_ASSETS_INCOMPLETE', `${missing.length} snapshot assets lack complete production approval`)
}
