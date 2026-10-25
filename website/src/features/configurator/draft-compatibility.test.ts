import { describe, expect, test } from 'bun:test'

import type { ConfigurationBootstrap, ConfigurationMetadata, ConfiguratorDraft } from '@seriya/contracts'

import { validateDraftCompatibility } from './draft-compatibility'

const publicationId = '018f0f89-8a7b-7c6d-8e5f-1234567890ab'
const priceVersionId = '018f0f89-8a7b-7c6d-8e5f-1234567890ad'
const moduleId = '018f0f89-8a7b-7c6d-8e5f-1234567890ac'
const accessoryId = '018f0f89-8a7b-7c6d-8e5f-1234567890ae'
const panelId = '018f0f89-8a7b-7c6d-8e5f-1234567890af'
const cutLowerId = '018f0f89-8a7b-7c6d-8e5f-1234567890b0'
const cutWallId = '018f0f89-8a7b-7c6d-8e5f-1234567890b1'
const tallId = '018f0f89-8a7b-7c6d-8e5f-1234567890b2'
const wallId = '018f0f89-8a7b-7c6d-8e5f-1234567890b3'
const standard550Id = '018f0f89-8a7b-7c6d-8e5f-1234567890b4'

const metadata = {
  straightEligible: true,
  reservedUpperRows: [],
  falsePanelPositions: [],
  trimLine: null,
  trimLines: [],
} satisfies Omit<ConfigurationMetadata, 'role'>

const bootstrap: ConfigurationBootstrap = {
  publicationId,
  priceVersionId,
  catalogRevision: 1,
  materials: [
    { id: 'body-white', name: 'Корпус', kind: 'body', isActive: true },
    { id: 'facade-oak', name: 'Фасад', kind: 'facade', isActive: true },
  ],
  variants: [
    {
      id: moduleId, familyKey: 'lower', row: 'lower', sku: 'LOWER', publicName: 'Тумба',
      dimensionsMm: { height: 720, width: 600, depth: 500 },
      cutToWidth: { allowed: false, maxReductionMm: null, stepMm: null },
      configuration: { ...metadata, role: 'ordinary' },
    },
    {
      id: accessoryId, familyKey: 'plinth', row: 'accessory', sku: 'PLINTH', publicName: 'Цоколь',
      dimensionsMm: { height: 100, width: 1000, depth: 20 },
      cutToWidth: { allowed: false, maxReductionMm: null, stepMm: null },
      configuration: { ...metadata, role: 'plinth', trimLine: 'plinth' },
    },
    {
      id: panelId, familyKey: 'false-panel', row: 'accessory', sku: 'PANEL', publicName: 'Фальш-панель',
      dimensionsMm: { height: 720, width: 100, depth: 20, layoutSpan: 100 },
      cutToWidth: { allowed: false, maxReductionMm: null, stepMm: null },
      configuration: {
        ...metadata,
        role: 'false_panel',
        falsePanelPositions: ['start', 'between', 'end'],
      },
    },
    {
      id: cutLowerId, familyKey: 'cut-lower', row: 'lower', sku: 'CUT-L', publicName: 'Подрезной низ',
      dimensionsMm: { height: 720, width: 600, depth: 500 },
      cutToWidth: { allowed: true, maxReductionMm: 50, stepMm: 10 },
      configuration: { ...metadata, role: 'ordinary' },
    },
    {
      id: standard550Id, familyKey: 'cut-lower', row: 'lower', sku: 'STD-L-550', publicName: 'Стандартный низ 550',
      dimensionsMm: { height: 720, width: 550, depth: 500 },
      cutToWidth: { allowed: true, maxReductionMm: 50, stepMm: 1 },
      configuration: { ...metadata, role: 'ordinary' },
    },
    {
      id: cutWallId, familyKey: 'cut-wall', row: 'wall', sku: 'CUT-W', publicName: 'Подрезной верх',
      dimensionsMm: { height: 700, width: 600, depth: 320 },
      cutToWidth: { allowed: true, maxReductionMm: 50, stepMm: 10 },
      configuration: { ...metadata, role: 'ordinary' },
    },
    {
      id: tallId, familyKey: 'tall', row: 'lower', sku: 'TALL', publicName: 'Пенал',
      dimensionsMm: { height: 2100, width: 600, depth: 500 },
      cutToWidth: { allowed: false, maxReductionMm: null, stepMm: null },
      configuration: { ...metadata, role: 'tall', reservedUpperRows: ['wall'] },
    },
    {
      id: wallId, familyKey: 'wall', row: 'wall', sku: 'WALL', publicName: 'Верх',
      dimensionsMm: { height: 700, width: 600, depth: 320 },
      cutToWidth: { allowed: false, maxReductionMm: null, stepMm: null },
      configuration: { ...metadata, role: 'ordinary' },
    },
  ],
}

function draft(): ConfiguratorDraft {
  return {
    draftSchemaVersion: 3,
    savedAt: '2026-10-24T10:00:00.000Z',
    uiOptions: { startSide: 'right' },
    command: {
      publicationId,
      intentId: 'local-draft',
      wallLengthMm: 2400,
      bodyMaterialId: 'body-white',
      facadeMaterialId: 'facade-oak',
      facadesIncluded: true,
      packagingIncluded: false,
      countertopThicknessMm: 38,
      rows: [{
        row: 'lower',
        modules: [{ variantId: moduleId, startMm: 0, cutWidthMm: null, withoutFacade: false }],
      }],
      falsePanels: [],
      plinthVariantId: null,
      crownVariantId: null,
    },
    reconciliationSourceCommand: null,
    acceptedQuote: null,
  }
}

describe('configurator draft compatibility', () => {
  test('accepts a semantically valid current-publication draft', () => {
    expect(validateDraftCompatibility(draft(), bootstrap)).toEqual({ status: 'ready', acceptedQuote: null })
  })

  test('separates an older publication for later reconciliation', () => {
    const candidate = draft()
    candidate.command.publicationId = '018f0f89-8a7b-7c6d-8e5f-1234567890ff'
    expect(validateDraftCompatibility(candidate, bootstrap)).toEqual({ status: 'stale' })
  })

  test('keeps an unfinished repair in reconciliation even on the current publication', () => {
    const candidate = draft()
    candidate.reconciliationSourceCommand = {
      ...candidate.command,
      publicationId: '018f0f89-8a7b-7c6d-8e5f-1234567890ff',
    }
    expect(validateDraftCompatibility(candidate, bootstrap)).toEqual({ status: 'reconciling' })
  })

  test('rejects wrong material kind and accessory-as-module semantics', () => {
    const wrongMaterial = draft()
    wrongMaterial.command.bodyMaterialId = 'facade-oak'
    expect(validateDraftCompatibility(wrongMaterial, bootstrap)).toEqual({ status: 'corrupt' })

    const wrongModule = draft()
    wrongModule.command.rows[0]!.modules[0]!.variantId = accessoryId
    expect(validateDraftCompatibility(wrongModule, bootstrap)).toEqual({ status: 'corrupt' })
  })

  test('rejects incompatible row and mismatched accepted quote', () => {
    const wrongRow = draft()
    wrongRow.command.rows[0]!.row = 'wall'
    expect(validateDraftCompatibility(wrongRow, bootstrap)).toEqual({ status: 'corrupt' })

    const wrongQuote = draft()
    wrongQuote.acceptedQuote = {
      publicationId,
      priceVersionId: '018f0f89-8a7b-7c6d-8e5f-1234567890ff',
      configurationFingerprint: 'sha256:configuration',
      totalRub: 125_000,
      acceptedAt: '2026-10-24T10:00:00.000Z',
    }
    expect(validateDraftCompatibility(wrongQuote, bootstrap)).toEqual({ status: 'corrupt' })
  })

  test('rejects forged panel width, forbidden cuts, and overlap while keeping wall overflow as a warning', () => {
    const wrongPanel = draft()
    wrongPanel.command.falsePanels = [{
      variantId: panelId, row: 'lower', startMm: 600, widthMm: 1, position: 'end',
    }]
    expect(validateDraftCompatibility(wrongPanel, bootstrap)).toEqual({ status: 'corrupt' })

    const forbiddenCut = draft()
    forbiddenCut.command.rows[0]!.modules[0]!.cutWidthMm = 550
    expect(validateDraftCompatibility(forbiddenCut, bootstrap)).toEqual({ status: 'corrupt' })

    const overlap = draft()
    overlap.command.falsePanels = [{
      variantId: panelId, row: 'lower', startMm: 550, widthMm: 100, position: 'end',
    }]
    expect(validateDraftCompatibility(overlap, bootstrap)).toEqual({ status: 'corrupt' })

    const overflow = draft()
    overflow.command.wallLengthMm = 500
    expect(validateDraftCompatibility(overflow, bootstrap)).toEqual({ status: 'ready', acceptedQuote: null })
  })

  test('applies the two-cut limit independently to each row', () => {
    const candidate = draft()
    candidate.command.rows = [
      {
        row: 'lower',
        modules: [
          { variantId: cutLowerId, startMm: 0, cutWidthMm: 550, withoutFacade: false },
          { variantId: cutLowerId, startMm: 550, cutWidthMm: 550, withoutFacade: false },
        ],
      },
      {
        row: 'wall',
        modules: [{ variantId: cutWallId, startMm: 0, cutWidthMm: 550, withoutFacade: false }],
      },
    ]
    expect(validateDraftCompatibility(candidate, bootstrap)).toEqual({ status: 'ready', acceptedQuote: null })

    candidate.command.rows[1]!.modules.push(
      { variantId: cutWallId, startMm: 550, cutWidthMm: 550, withoutFacade: false },
      { variantId: cutWallId, startMm: 1100, cutWidthMm: 550, withoutFacade: false },
    )
    expect(validateDraftCompatibility(candidate, bootstrap)).toEqual({ status: 'corrupt' })
  })

  test('does not count an exact family width as a cut when restoring a reconciled draft', () => {
    const candidate = draft()
    candidate.command.rows = [{
      row: 'lower',
      modules: [0, 550, 1100, 1650].map((startMm) => ({
        variantId: cutLowerId,
        startMm,
        cutWidthMm: 550,
        withoutFacade: false,
      })),
    }]

    expect(validateDraftCompatibility(candidate, bootstrap)).toEqual({ status: 'ready', acceptedQuote: null })
  })

  test('rejects upper modules inside a tall-module reservation', () => {
    const candidate = draft()
    candidate.command.rows = [
      { row: 'lower', modules: [{ variantId: tallId, startMm: 0, cutWidthMm: null, withoutFacade: false }] },
      { row: 'wall', modules: [{ variantId: wallId, startMm: 0, cutWidthMm: null, withoutFacade: false }] },
    ]
    expect(validateDraftCompatibility(candidate, bootstrap)).toEqual({ status: 'corrupt' })
  })

  test('rejects a false panel whose declared topology does not match its row position', () => {
    const candidate = draft()
    candidate.command.falsePanels = [{
      variantId: panelId,
      row: 'lower',
      startMm: 600,
      widthMm: 100,
      position: 'start',
    }]
    expect(validateDraftCompatibility(candidate, bootstrap)).toEqual({ status: 'corrupt' })
  })
})
