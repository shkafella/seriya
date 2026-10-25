import { describe, expect, test } from 'bun:test'
import type { ConfigurationQuoteRequest } from '@seriya/contracts'

import { configurationFingerprint } from './configuration-fingerprint'

const command: ConfigurationQuoteRequest = {
  publicationId: '018f0f89-8a7b-7c6d-8e5f-1234567890ab',
  intentId: 'quote-1',
  wallLengthMm: 2400,
  bodyMaterialId: 'body-white',
  facadeMaterialId: 'facade-oak',
  facadesIncluded: true,
  packagingIncluded: false,
  countertopThicknessMm: 38,
  rows: [{
    row: 'lower',
    modules: [{
      variantId: '018f0f89-8a7b-7c6d-8e5f-1234567890ac',
      startMm: 0,
      cutWidthMm: null,
      withoutFacade: false,
    }],
  }],
  falsePanels: [],
  plinthVariantId: null,
  crownVariantId: null,
}

describe('configuration fingerprint', () => {
  test('ignores publication and request correlation identity', () => {
    expect(configurationFingerprint(command)).toBe(configurationFingerprint({
      ...command,
      publicationId: '018f0f89-8a7b-7c6d-8e5f-1234567890ff',
      intentId: 'quote-2',
    }))
  })

  test('changes when a price-bearing choice changes', () => {
    expect(configurationFingerprint(command)).not.toBe(configurationFingerprint({
      ...command,
      packagingIncluded: true,
    }))
    expect(configurationFingerprint(command)).toMatch(/^sha256:[a-f0-9]{64}$/)
  })
})
