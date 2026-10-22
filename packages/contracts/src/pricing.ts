import { z } from 'zod'

export const rubleAmountSchema = z.number().finite().nonnegative()

export const catalogRatesSchema = z.object({
  bodyRubM2: rubleAmountSchema,
  facadeRubM2: rubleAmountSchema,
  hdfRubM2: rubleAmountSchema,
  agtRubM2: rubleAmountSchema,
  packagingRubM2: rubleAmountSchema,
  customerPriceMultiplier: z.number().finite().positive(),
  includedVatFraction: z.number().finite().min(0).max(1),
  cutToWidthServiceRub: rubleAmountSchema,
  finalCustomerTotalRoundingRub: z.number().int().positive(),
})

export const pricingPaletteEntrySchema = z.object({
  id: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(120),
  kind: z.enum(['body', 'facade', 'hdf']),
  rateRubM2: rubleAmountSchema,
  isActive: z.boolean(),
}).strict()

export const pricingRatesSchema = catalogRatesSchema.extend({
  bodyRatesRubM2: z.array(rubleAmountSchema).min(1),
  facadeRatesRubM2: z.array(rubleAmountSchema).min(1),
  hdfRatesRubM2: z.array(rubleAmountSchema).min(1),
  palette: z.array(pricingPaletteEntrySchema).min(1),
}).strict()

export const priceVersionSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  currency: z.literal('RUB'),
  rates: catalogRatesSchema,
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  publishedAt: z.string().datetime(),
})

/** The owner needs the full published palette to compare it with the editable draft. */
export const ownerPriceVersionSchema = priceVersionSchema.extend({
  rates: pricingRatesSchema,
})

export const pricingDraftSchema = z.object({
  id: z.string().uuid(),
  basePriceVersionId: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  rates: pricingRatesSchema,
  updatedAt: z.string().datetime(),
}).strict()

export const ownerPricingResponseSchema = z.object({
  currentPriceVersion: ownerPriceVersionSchema,
  draft: pricingDraftSchema,
  catalogActivationState: z.enum(['IDLE', 'MAINTENANCE']),
}).strict()

export const ownerPricingDraftEditSchema = z.object({
  revision: z.number().int().nonnegative(),
  materialRates: z.array(z.object({
    id: z.string().trim().min(1).max(100),
    rateRubM2: rubleAmountSchema,
  }).strict()).max(30).optional(),
  packagingRubM2: rubleAmountSchema.optional(),
  cutToWidthServiceRub: rubleAmountSchema.optional(),
}).strict().refine((value) => Boolean(value.materialRates?.length) || value.packagingRubM2 !== undefined || value.cutToWidthServiceRub !== undefined, {
  message: 'At least one price must change',
})

export const ownerPricingPublishSchema = z.object({
  revision: z.number().int().nonnegative(),
}).strict()

export const publicPriceModeSchema = z.enum(['ordinary', 'false_panel', 'trim_piece'])

export const publicPriceRangeSchema = z.object({
  mode: publicPriceModeSchema,
  minRub: rubleAmountSchema,
  maxRub: rubleAmountSchema,
  currency: z.literal('RUB'),
  unitLabel: z.string().min(1).max(120),
  includesFacade: z.boolean(),
  includesPackaging: z.literal(false),
}).superRefine((range, context) => {
  if (range.maxRub < range.minRub) {
    context.addIssue({
      code: 'custom',
      path: ['maxRub'],
      message: 'maxRub must be greater than or equal to minRub',
    })
  }
  if (range.maxRub === 0) {
    context.addIssue({
      code: 'custom',
      path: ['maxRub'],
      message: 'Public price range must not be zero',
    })
  }
})

export type CatalogRates = z.infer<typeof catalogRatesSchema>
export type PricingRates = z.infer<typeof pricingRatesSchema>
export type PricingDraft = z.infer<typeof pricingDraftSchema>
export type OwnerPricingResponse = z.infer<typeof ownerPricingResponseSchema>
export type OwnerPricingDraftEdit = z.infer<typeof ownerPricingDraftEditSchema>
export type PriceVersionDto = z.infer<typeof priceVersionSchema>
export type PublicPriceMode = z.infer<typeof publicPriceModeSchema>
export type PublicPriceRange = z.infer<typeof publicPriceRangeSchema>
