import {
  configurationBootstrapSchema,
  configurationMaterialSchema,
  configurationMetadataSchema,
  configurationQuoteRequestSchema,
  configurationQuoteResponseSchema,
  configurationReplacementProposalRequestSchema,
  configurationReplacementProposalSchema,
  configuratorReconciliationRequestSchema,
  configuratorReconciliationResponseSchema,
} from '@seriya/contracts'
import { z } from 'zod'

import type { DbClient } from '../../../db'
import { AppError } from '../../../http/errors'
import { hasConsistentPublicEvidence } from '../../catalog'
import { configurationFingerprint } from '../application/configuration-fingerprint'
import { configurationSnapshotCalculator } from '../application/snapshot-calculator'
import { proposeUpperReplacement, type PublishedKitchenSnapshot, type PublishedKitchenVariant } from '../domain/kitchen-quote'
import { findReconciliationIssues } from '../domain/reconciliation'

const storedSnapshotSchema = z.object({
  snapshotSchemaVersion: z.literal(1).default(1),
  quoteCalculatorVersion: z.literal(1).default(1),
  publicationId: z.string().uuid(),
  priceVersionId: z.string().uuid(),
  rates: z.object({
    packagingRubM2: z.number().finite().nonnegative(),
    customerPriceMultiplier: z.number().finite().positive(),
    includedVatFraction: z.number().finite().min(0).max(1),
    cutToWidthServiceRub: z.number().finite().nonnegative(),
    finalCustomerTotalRoundingRub: z.number().int().positive(),
  }).strict(),
  materials: z.array(configurationMaterialSchema).min(1),
  variants: z.array(z.object({
    id: z.string().uuid(), familyKey: z.string().min(1), row: z.enum(['lower', 'wall', 'mezzanine', 'accessory']),
    sku: z.string().min(1), publicName: z.string().min(1), heightMm: z.number().int().positive(), widthMm: z.number().int().positive(), depthMm: z.number().int().positive(), layoutSpanMm: z.number().int().positive().nullable(),
    consumption: z.object({ body: z.number().finite().nonnegative(), facade: z.number().finite().nonnegative(), hdf: z.number().finite().nonnegative() }).strict(),
    fastenerChargeRub: z.number().finite().nonnegative(), cutPolicy: z.enum(['allowed', 'forbidden']), configuration: configurationMetadataSchema,
    customerSupplied: z.array(z.string().min(1)),
  }).strict()).min(1),
}).strict()

type StoredKitchenSnapshot = Omit<PublishedKitchenSnapshot, 'variants'> & {
  snapshotSchemaVersion: 1
  quoteCalculatorVersion: 1
  variants: Array<PublishedKitchenVariant & { heightMm: number; depthMm: number }>
}

export class ConfigurationService {
  constructor(private readonly db: DbClient) {}

  async bootstrap() {
    const { publication, snapshot } = await this.activeSnapshot()
    return configurationBootstrapSchema.parse({
      publicationId: snapshot.publicationId,
      priceVersionId: snapshot.priceVersionId,
      catalogRevision: publication.catalogRevision,
      materials: snapshot.materials.filter((item) => item.isActive).map(({ rateRubM2: _rate, ...item }) => item),
      variants: snapshot.variants.filter((item) => item.configuration.straightEligible || ['false_panel', 'plinth', 'crown'].includes(item.configuration.role)).map((item) => ({
        id: item.id, familyKey: item.familyKey, row: item.row, sku: item.sku, publicName: item.publicName,
        dimensionsMm: { height: item.heightMm, width: item.widthMm, depth: item.depthMm, ...(item.layoutSpanMm === null ? {} : { layoutSpan: item.layoutSpanMm }) },
        cutToWidth: { allowed: item.cutPolicy === 'allowed', maxReductionMm: item.cutPolicy === 'allowed' ? 50 : null, stepMm: item.cutPolicy === 'allowed' ? 1 : null },
        configuration: item.configuration,
      })),
    })
  }

  async quote(input: unknown) {
    const command = configurationQuoteRequestSchema.parse(input)
    const { snapshot } = await this.activeSnapshot()
    if (command.publicationId !== snapshot.publicationId) {
      throw new AppError(409, 'CONFLICT', 'Catalog or price changed; refresh the configurator')
    }
    try {
      return configurationQuoteResponseSchema.parse(configurationSnapshotCalculator.calculate(snapshot, command))
    } catch (error) {
      if (error instanceof AppError) throw error
      if (error instanceof Error) throw new AppError(400, 'VALIDATION_ERROR', error.message)
      throw error
    }
  }

  async replacementProposal(input: unknown) {
    const command = configurationReplacementProposalRequestSchema.parse(input)
    const { snapshot } = await this.activeSnapshot()
    if (command.publicationId !== snapshot.publicationId) {
      throw new AppError(409, 'CONFLICT', 'Catalog or price changed; refresh the configurator')
    }
    try {
      return configurationReplacementProposalSchema.parse(proposeUpperReplacement(snapshot, command))
    } catch (error) {
      if (error instanceof AppError) throw error
      if (error instanceof Error) throw new AppError(400, 'VALIDATION_ERROR', error.message)
      throw error
    }
  }

  async reconcile(input: unknown) {
    const command = configuratorReconciliationRequestSchema.parse(input)
    const { source, current } = await this.publicSnapshots(command.sourceCommand.publicationId)
    if (command.workingCommand.publicationId !== current.snapshot.publicationId) {
      throw new AppError(409, 'PUBLICATION_CHANGED', 'Catalog or price changed; review the saved kitchen again')
    }

    let originalQuote
    try {
      originalQuote = configurationSnapshotCalculator.calculate(source.snapshot, command.sourceCommand)
    } catch {
      throw new AppError(409, 'RECONCILIATION_REQUIRED', 'The saved kitchen cannot be safely reconciled')
    }

    let issues
    try {
      issues = findReconciliationIssues(source.snapshot, current.snapshot, command.sourceCommand, command.workingCommand)
    } catch (error) {
      throw new AppError(400, 'VALIDATION_ERROR', error instanceof Error ? error.message : 'Invalid reconciliation command')
    }

    let currentQuote = null
    if (!issues.some((issue) => issue.blocking)) {
      try {
        currentQuote = configurationSnapshotCalculator.calculate(current.snapshot, command.workingCommand)
      } catch (error) {
        throw new AppError(400, 'VALIDATION_ERROR', error instanceof Error ? error.message : 'Invalid current configuration')
      }
    }

    if (source.snapshot.publicationId !== current.snapshot.publicationId) {
      issues.push({
        code: 'PUBLICATION_CHANGED',
        blocking: false,
        path: ['publicationId'],
        message: 'Каталог обновлён после сохранения черновика',
      })
    }
    if (currentQuote && (
      originalQuote.priceVersionId !== currentQuote.priceVersionId
      || originalQuote.totalRub !== currentQuote.totalRub
    )) {
      issues.push({
        code: 'PRICE_CHANGED',
        blocking: false,
        path: ['totalRub'],
        message: 'Цена изменилась после сохранения черновика',
      })
    }

    return configuratorReconciliationResponseSchema.parse({
      originalPublicationId: source.snapshot.publicationId,
      currentPublicationId: current.snapshot.publicationId,
      originalQuote,
      currentQuote,
      workingCommand: command.workingCommand,
      issues,
      currentConfigurationFingerprint: configurationFingerprint(command.workingCommand),
      requiresAcceptance: issues.some((issue) => issue.code === 'PRICE_CHANGED' || issue.code === 'PUBLICATION_CHANGED'),
    })
  }

  private async activeSnapshot(): Promise<{ publication: { id: string; catalogRevision: number }; snapshot: StoredKitchenSnapshot }> {
    const { current } = await this.publicSnapshots()
    return current
  }

  private async publicSnapshots(sourcePublicationId?: string) {
    return this.db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{
        activePublicationId: string | null
        activationState: 'IDLE' | 'MAINTENANCE'
      }>>`
        SELECT active_publication_id AS "activePublicationId", activation_state AS "activationState"
        FROM catalog_state WHERE singleton_key = 'catalog' FOR SHARE
      `
      const state = locked[0]
      if (state?.activationState === 'MAINTENANCE') {
        throw new AppError(503, 'CATALOG_MAINTENANCE', 'Catalog publication is being switched')
      }
      if (!state?.activePublicationId) {
        throw new AppError(404, 'CATALOG_NOT_PUBLISHED', 'Configurator is not published yet')
      }
      const currentPublication = await tx.catalogPublication.findUnique({ where: { id: state.activePublicationId } })
      if (!currentPublication
        || currentPublication.status !== 'ACTIVE'
        || !currentPublication.publicVerifiedAt
        || !hasConsistentPublicEvidence(currentPublication)) {
        throw new AppError(404, 'CATALOG_NOT_PUBLISHED', 'Configurator is not published yet')
      }
      const current = parsedPublication(currentPublication)
      if (!sourcePublicationId || sourcePublicationId === currentPublication.id) {
        return { source: current, current }
      }
      const sourcePublication = await tx.catalogPublication.findUnique({ where: { id: sourcePublicationId } })
      if (!sourcePublication
        || !['ACTIVE', 'SUPERSEDED'].includes(sourcePublication.status)
        || !sourcePublication.publicVerifiedAt
        || !hasConsistentPublicEvidence(sourcePublication)) {
        throw new AppError(409, 'RECONCILIATION_REQUIRED', 'The saved kitchen cannot be safely reconciled')
      }
      return { source: parsedPublication(sourcePublication), current }
    }, { maxWait: 10_000, timeout: 30_000 })
  }
}

function parsedPublication(publication: {
  id: string
  catalogRevision: number
  priceVersionId: string
  pricingSnapshot: unknown
}) {
  let snapshot: StoredKitchenSnapshot
  try {
    snapshot = storedSnapshotSchema.parse(publication.pricingSnapshot) as StoredKitchenSnapshot
  } catch {
    throw new AppError(409, 'RECONCILIATION_REQUIRED', 'The published configuration cannot be safely read')
  }
  if (snapshot.publicationId !== publication.id || snapshot.priceVersionId !== publication.priceVersionId) {
    throw new AppError(409, 'RECONCILIATION_REQUIRED', 'The published configuration is inconsistent')
  }
  return {
    publication: { id: publication.id, catalogRevision: publication.catalogRevision },
    snapshot,
  }
}
