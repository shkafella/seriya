import {
  configurationBootstrapSchema,
  configurationMaterialSchema,
  configurationMetadataSchema,
  configurationQuoteRequestSchema,
  configurationQuoteResponseSchema,
  configurationReplacementProposalRequestSchema,
  configurationReplacementProposalSchema,
} from '@seriya/contracts'
import { z } from 'zod'

import type { DbClient } from '../../../db'
import { AppError } from '../../../http/errors'
import { calculateKitchenQuote, proposeUpperReplacement, type PublishedKitchenSnapshot, type PublishedKitchenVariant } from '../domain/kitchen-quote'

const storedSnapshotSchema = z.object({
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
      return configurationQuoteResponseSchema.parse(calculateKitchenQuote(snapshot, command))
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

  private async activeSnapshot(): Promise<{ publication: { id: string; catalogRevision: number }; snapshot: StoredKitchenSnapshot }> {
    const state = await this.db.catalogState.findUnique({ where: { singletonKey: 'catalog' }, include: { activePublication: true } })
    if (state?.activationState === 'MAINTENANCE') throw new AppError(503, 'CATALOG_MAINTENANCE', 'Catalog publication is being switched')
    if (!state?.activePublication?.pricingSnapshot) throw new AppError(404, 'CATALOG_NOT_PUBLISHED', 'Configurator is not published yet')
    return {
      publication: { id: state.activePublication.id, catalogRevision: state.activePublication.catalogRevision },
      snapshot: storedSnapshotSchema.parse(state.activePublication.pricingSnapshot) as StoredKitchenSnapshot,
    }
  }
}
