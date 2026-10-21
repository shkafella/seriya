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

export const priceVersionSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  currency: z.literal('RUB'),
  rates: catalogRatesSchema,
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  publishedAt: z.string().datetime(),
})

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
export type PriceVersionDto = z.infer<typeof priceVersionSchema>
export type PublicPriceMode = z.infer<typeof publicPriceModeSchema>
export type PublicPriceRange = z.infer<typeof publicPriceRangeSchema>
