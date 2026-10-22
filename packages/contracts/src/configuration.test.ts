import { describe, expect, test } from 'bun:test'

import { configurationQuoteRequestSchema } from './configuration'

const validRequest = {
  publicationId: '019c0a31-7d03-7000-8000-000000000001',
  intentId: 'kitchen-42',
  bodyMaterialId: 'ldsp-white',
  facadeMaterialId: 'ultradecor-1',
  facadesIncluded: true,
  packagingIncluded: true,
  countertopThicknessMm: 38,
  rows: [{
    row: 'lower',
    modules: [{
      variantId: '019c0a31-7d03-7000-8000-000000000002',
      startMm: 0,
      cutWidthMm: 550,
      withoutFacade: false,
    }],
  }],
  falsePanels: [],
  plinthVariantId: null,
  crownVariantId: null,
}

describe('configuration quote command', () => {
  test('accepts a kitchen intent without any browser-controlled price', () => {
    expect(configurationQuoteRequestSchema.parse(validRequest)).toMatchObject({
      intentId: 'kitchen-42',
      rows: [{ row: 'lower', modules: [{ cutWidthMm: 550 }] }],
    })
  })

  test('rejects a client price and fractional millimetres', () => {
    expect(() => configurationQuoteRequestSchema.parse({ ...validRequest, totalRub: 1 })).toThrow()
    expect(() => configurationQuoteRequestSchema.parse({
      ...validRequest,
      rows: [{ ...validRequest.rows[0], modules: [{ ...validRequest.rows[0].modules[0], startMm: 0.5 }] }],
    })).toThrow()
  })

  test('allows a facade material for a price-bearing individual item when the kitchen-wide switch is off', () => {
    expect(configurationQuoteRequestSchema.parse({ ...validRequest, facadesIncluded: false })).toMatchObject({
      facadeMaterialId: 'ultradecor-1',
      facadesIncluded: false,
    })
  })

  test('rejects an empty kitchen layout', () => {
    expect(() => configurationQuoteRequestSchema.parse({
      ...validRequest,
      rows: [{ row: 'lower', modules: [] }],
    })).toThrow('At least one module')
  })
})
