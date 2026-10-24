import { describe, expect, test } from 'bun:test'

import {
  CURRENT_CONFIGURATOR_DRAFT_SCHEMA_VERSION,
  configuratorDraftSchema,
  migrateConfiguratorDraft,
} from './drafts'
import type { ConfigurationQuoteRequest } from './configuration'

const command: ConfigurationQuoteRequest = {
  publicationId: '018f0f89-8a7b-7c6d-8e5f-1234567890ab',
  intentId: 'draft-quote-1',
  wallLengthMm: 2400,
  bodyMaterialId: 'body-white',
  facadeMaterialId: 'facade-oak',
  facadesIncluded: true,
  packagingIncluded: true,
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

describe('configurator draft contract', () => {
  test('accepts the current no-contact draft', () => {
    const draft = configuratorDraftSchema.parse({
      draftSchemaVersion: CURRENT_CONFIGURATOR_DRAFT_SCHEMA_VERSION,
      savedAt: '2026-10-24T08:00:00.000Z',
      command,
      uiOptions: { startSide: 'right' },
      acceptedQuote: null,
    })

    expect(draft.draftSchemaVersion).toBe(2)
    expect(JSON.stringify(draft)).not.toContain('phone')
  })

  test('rejects contact, consent, and final-form data at any top-level boundary', () => {
    for (const forbidden of [
      { phone: '+79990000000' },
      { telegram: '@visitor' },
      { consentAccepted: true },
      { contact: { messenger: 'telegram', value: '@visitor' } },
    ]) {
      expect(() => configuratorDraftSchema.parse({
        draftSchemaVersion: 2,
        savedAt: '2026-10-24T08:00:00.000Z',
        command,
        uiOptions: { startSide: 'left' },
        acceptedQuote: null,
        ...forbidden,
      })).toThrow()
    }
  })

  test('migrates the registered legacy version and rejects unknown versions', () => {
    expect(migrateConfiguratorDraft({
      draftSchemaVersion: 0,
      savedAt: '2026-10-24T08:00:00.000Z',
      command,
    })).toEqual({
      draftSchemaVersion: 2,
      savedAt: '2026-10-24T08:00:00.000Z',
      command,
      uiOptions: { startSide: 'left' },
      acceptedQuote: null,
    })

    expect(migrateConfiguratorDraft({
      draftSchemaVersion: 1,
      savedAt: '2026-10-24T08:00:00.000Z',
      command,
      acceptedQuote: null,
    })).toMatchObject({
      draftSchemaVersion: 2,
      uiOptions: { startSide: 'left' },
    })

    expect(() => migrateConfiguratorDraft({
      draftSchemaVersion: 99,
      savedAt: '2026-10-24T08:00:00.000Z',
      command,
    })).toThrow()
  })

  test('rejects an accepted quote from another publication', () => {
    expect(() => configuratorDraftSchema.parse({
      draftSchemaVersion: 2,
      savedAt: '2026-10-24T08:00:00.000Z',
      command,
      uiOptions: { startSide: 'left' },
      acceptedQuote: {
        publicationId: '018f0f89-8a7b-7c6d-8e5f-1234567890ff',
        priceVersionId: '018f0f89-8a7b-7c6d-8e5f-1234567890ad',
        configurationFingerprint: 'sha256:configuration',
        totalRub: 125_000,
        acceptedAt: '2026-10-24T08:00:00.000Z',
      },
    })).toThrow('Accepted quote must belong to the draft publication')
  })
})
