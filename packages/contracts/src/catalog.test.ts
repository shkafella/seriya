import { describe, expect, test } from 'bun:test'

import {
  catalogImportPreviewSchema,
  catalogSeedSchema,
  dimensionsMmSchema,
  ownerCatalogVariantEditSchema,
  publicCatalogSchema,
} from './catalog'
import { publicPriceRangeSchema } from './pricing'

describe('catalog contracts', () => {
  test('rejects non-positive dimensions', () => {
    expect(() => dimensionsMmSchema.parse({ height: 780, width: 0, depth: 560 })).toThrow()
  })

  test('rejects empty and unknown owner edits', () => {
    expect(() => ownerCatalogVariantEditSchema.parse({ revision: 1, changes: {} })).toThrow()
    expect(() => ownerCatalogVariantEditSchema.parse({
      revision: 1,
      changes: { publicName: 'Модуль', fastenerChargeRub: 0 },
    })).toThrow()
  })

  test('rejects zero and reversed public price ranges', () => {
    const base = {
      mode: 'ordinary',
      currency: 'RUB',
      unitLabel: 'Без фасадов и упаковки',
      includesFacade: false,
      includesPackaging: false,
    }
    expect(() => publicPriceRangeSchema.parse({ ...base, minRub: 0, maxRub: 0 })).toThrow()
    expect(() => publicPriceRangeSchema.parse({ ...base, minRub: 2000, maxRub: 1000 })).toThrow()
  })

  test('rejects malformed import preview checksums and counts', () => {
    expect(() => catalogImportPreviewSchema.parse({
      schemaVersion: 1,
      sourcePath: 'catalog.json',
      sourceChecksum: 'bad',
      sourceMapChecksum: 'bad',
      baseCatalogRevision: 0,
      generatedAt: new Date().toISOString(),
      valid: false,
      counts: {
        created: -1,
        updated: 0,
        unchanged: 0,
        deactivated: 0,
        duplicate: 0,
        invalid: 1,
        conflicts: 0,
      },
      created: [],
      updated: [],
      unchanged: [],
      deactivated: [],
      duplicate: [],
      invalid: [],
      conflicts: [],
    })).toThrow()
  })

  test('requires a valid immutable public publication envelope', () => {
    expect(() => publicCatalogSchema.parse({
      schemaVersion: 1,
      publicationId: 'not-a-uuid',
      releaseId: '',
      catalogRevision: -1,
      generatedAt: 'today',
      families: [],
    })).toThrow()
  })

  test('requires every approved launch rate and non-empty material rate list', () => {
    const commercialRules = {
      currency: 'RUB',
      rates: {
        body_rub_m2: 2050, facade_rub_m2: 2225, hdf_rub_m2: 600, agt_1_rub_m2: 3000,
        packaging_rub_m2: 350, customer_price_multiplier: 1.1,
        included_vat_fraction: 22 / 122, cut_to_width_service_rub: 3000,
      },
      finalCustomerTotalRoundingRub: 10,
      vatDisplayAccountantApproved: true,
    }
    const schema = catalogSeedSchema.shape.commercialRules
    expect(() => schema.parse({ ...commercialRules, rates: { ...commercialRules.rates, customer_price_multiplier: undefined } })).toThrow()
    expect(() => schema.parse({ ...commercialRules, rates: { ...commercialRules.rates, customer_price_multiplier: 1.2 } })).toThrow()
    expect(() => schema.parse({ ...commercialRules, rates: { ...commercialRules.rates, included_vat_fraction: 0.2 } })).toThrow()
    expect(() => catalogSeedSchema.shape.materials.parse({ body: [], facade: [], hdf: [] })).toThrow()
  })
})
