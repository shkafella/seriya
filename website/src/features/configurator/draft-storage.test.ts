import { describe, expect, test } from 'bun:test'

import { readConfiguratorDraft, serializeConfiguratorDraft } from './draft-storage'

const command = {
  publicationId: '018f0f89-8a7b-7c6d-8e5f-1234567890ab',
  intentId: 'local-draft',
  wallLengthMm: 2400,
  bodyMaterialId: 'body-white',
  facadeMaterialId: 'facade-oak',
  facadesIncluded: true,
  packagingIncluded: false,
  countertopThicknessMm: 38 as const,
  rows: [{
    row: 'lower' as const,
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

describe('configurator local draft storage', () => {
  test('round-trips only the validated no-contact command', () => {
    const serialized = serializeConfiguratorDraft(
      command,
      null,
      { startSide: 'right' },
      new Date('2026-10-24T10:00:00.000Z'),
    )
    expect(serialized).not.toContain('phone')
    expect(serialized).not.toContain('consent')
    expect(readConfiguratorDraft(serialized)).toMatchObject({
      status: 'ready',
      draft: { draftSchemaVersion: 2, command, uiOptions: { startSide: 'right' } },
    })
  })

  test('migrates the retained v0 draft explicitly', () => {
    const result = readConfiguratorDraft(JSON.stringify({
      draftSchemaVersion: 0,
      savedAt: '2026-10-24T10:00:00.000Z',
      command,
    }))
    expect(result).toMatchObject({
      status: 'ready', migrated: true, draft: { acceptedQuote: null, uiOptions: { startSide: 'left' } },
    })
  })

  test('quarantines corrupt, unknown, and contact-bearing values', () => {
    expect(readConfiguratorDraft('{')).toEqual({ status: 'corrupt' })
    expect(readConfiguratorDraft(JSON.stringify({ draftSchemaVersion: 99 }))).toEqual({
      status: 'unsupported', version: 99,
    })
    const unsafe = JSON.parse(serializeConfiguratorDraft(
      command,
      null,
      { startSide: 'left' },
      new Date('2026-10-24T10:00:00.000Z'),
    ))
    unsafe.contact = { phone: '+79990000000' }
    expect(readConfiguratorDraft(JSON.stringify(unsafe))).toEqual({ status: 'corrupt' })
  })

  test('migrates the retained v1 draft and rejects mismatched quote acceptance', () => {
    expect(readConfiguratorDraft(JSON.stringify({
      draftSchemaVersion: 1,
      savedAt: '2026-10-24T10:00:00.000Z',
      command,
      acceptedQuote: null,
    }))).toMatchObject({
      status: 'ready', migrated: true, draft: { draftSchemaVersion: 2, uiOptions: { startSide: 'left' } },
    })

    const serialized = JSON.parse(serializeConfiguratorDraft(command, null, { startSide: 'left' }))
    serialized.acceptedQuote = {
      publicationId: '018f0f89-8a7b-7c6d-8e5f-1234567890ff',
      priceVersionId: '018f0f89-8a7b-7c6d-8e5f-1234567890ad',
      configurationFingerprint: 'sha256:configuration',
      totalRub: 125_000,
      acceptedAt: '2026-10-24T10:00:00.000Z',
    }
    expect(readConfiguratorDraft(JSON.stringify(serialized))).toEqual({ status: 'corrupt' })
  })
})
