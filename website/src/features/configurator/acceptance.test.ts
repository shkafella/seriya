import { describe, expect, test } from 'bun:test'
import type {
  ConfigurationQuoteRequest,
  ConfigurationQuoteResponse,
  ConfiguratorReconciliationResponse,
} from '@seriya/contracts'

import {
  acceptanceMatchesQuote,
  acceptedQuoteFromResponse,
  reconcileBeforeSubmission,
} from './acceptance'

const quote: ConfigurationQuoteResponse = {
  publicationId: '018f0f89-8a7b-7c6d-8e5f-1234567890ab',
  priceVersionId: '018f0f89-8a7b-7c6d-8e5f-1234567890ac',
  intentId: 'quote-1',
  configurationFingerprint: `sha256:${'a'.repeat(64)}`,
  totalRub: 100_000,
  includedVatRub: 16_666.67,
  kitchenHeightMm: 2568,
  rowSpansMm: { lower: 600, wall: 0, mezzanine: 0 },
  freeIntervals: [],
  specification: [],
  warnings: [],
}

const command: ConfigurationQuoteRequest = {
  publicationId: quote.publicationId,
  intentId: quote.intentId,
  wallLengthMm: 2400,
  bodyMaterialId: 'body',
  facadeMaterialId: 'facade',
  facadesIncluded: true,
  packagingIncluded: false,
  countertopThicknessMm: 38,
  rows: [{
    row: 'lower',
    modules: [{
      variantId: '018f0f89-8a7b-7c6d-8e5f-1234567890ad',
      startMm: 0,
      cutWidthMm: null,
      withoutFacade: false,
    }],
  }],
  falsePanels: [],
  plinthVariantId: null,
  crownVariantId: null,
}

function reconciliation(currentQuote: ConfigurationQuoteResponse | null): ConfiguratorReconciliationResponse {
  return {
    originalPublicationId: quote.publicationId,
    currentPublicationId: quote.publicationId,
    originalQuote: quote,
    currentQuote,
    workingCommand: command,
    issues: currentQuote === null ? [{
      code: 'ITEM_UNAVAILABLE',
      blocking: true,
      path: ['rows', 0, 'modules', 0],
      message: 'Позиция недоступна',
      target: { kind: 'module', row: 'lower', index: 0 },
      originalSelection: {
        kind: 'variant',
        id: command.rows[0]!.modules[0]!.variantId,
        publicName: 'Модуль',
        sku: 'MODULE-1',
        row: 'lower',
        widthMm: 600,
        layoutSpanMm: 600,
      },
      replacementOptions: [],
    }] : [],
    currentConfigurationFingerprint: currentQuote?.configurationFingerprint ?? quote.configurationFingerprint,
    requiresAcceptance: false,
  }
}

describe('configuration price acceptance', () => {
  test('binds acceptance to the exact authoritative quote tuple', () => {
    const accepted = acceptedQuoteFromResponse(quote, new Date('2026-10-25T00:00:00.000Z'))
    expect(acceptanceMatchesQuote(accepted, quote)).toBe(true)
    expect(acceptanceMatchesQuote(accepted, { ...quote, totalRub: quote.totalRub + 1 })).toBe(false)
    expect(acceptanceMatchesQuote(accepted, { ...quote, configurationFingerprint: `sha256:${'b'.repeat(64)}` })).toBe(false)
  })

  test('reconciles again immediately before submission and returns only an exact fresh acceptance', async () => {
    const accepted = acceptedQuoteFromResponse(quote)
    const calls: unknown[] = []
    const ready = await reconcileBeforeSubmission(command, accepted, async (request) => {
      calls.push(request)
      return reconciliation(quote)
    })

    expect(calls).toEqual([{ sourceCommand: command, workingCommand: command }])
    expect(ready).toEqual({ status: 'ready', command, quote })

    const changed = await reconcileBeforeSubmission(command, accepted, async () => (
      reconciliation({ ...quote, totalRub: quote.totalRub + 1 })
    ))
    expect(changed).toMatchObject({ status: 'reconciliation_required', reason: 'quote_changed' })

    const blocked = await reconcileBeforeSubmission(command, accepted, async () => reconciliation(null))
    expect(blocked).toMatchObject({ status: 'reconciliation_required', reason: 'blocked' })

    const publicationChanged = await reconcileBeforeSubmission(command, accepted, async () => {
      throw { code: 'PUBLICATION_CHANGED' }
    })
    expect(publicationChanged).toEqual({
      status: 'reconciliation_required',
      reason: 'publication_changed',
      reconciliation: null,
    })
  })

  test('does not hide retryable transport failures as a catalog change', async () => {
    const failure = new Error('network unavailable')
    let caught: unknown
    try {
      await reconcileBeforeSubmission(command, acceptedQuoteFromResponse(quote), async () => {
        throw failure
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toBe(failure)
  })

  test('does not call the server when no price was accepted', async () => {
    let called = false
    const result = await reconcileBeforeSubmission(command, null, async () => {
      called = true
      return reconciliation(quote)
    })
    expect(result).toEqual({
      status: 'reconciliation_required',
      reason: 'not_accepted',
      reconciliation: null,
    })
    expect(called).toBe(false)
  })
})
