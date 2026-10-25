import { describe, expect, test } from 'bun:test'

import type { AcceptedConfigurationQuote, ConfigurationBootstrap, ConfiguratorDraft } from '@seriya/contracts'

import {
  buildConfigurationCommand,
  ConfiguratorStateModel,
  configuratorStateFromDraft,
  createEmptyConfiguratorState,
} from './state'

const publicationId = '018f0f89-8a7b-7c6d-8e5f-1234567890ab'
const variantId = '018f0f89-8a7b-7c6d-8e5f-1234567890ac'
const priceVersionId = '018f0f89-8a7b-7c6d-8e5f-1234567890ad'

function configuredState() {
  const state = createEmptyConfiguratorState()
  state.publicationId = publicationId
  state.bodyMaterialId = 'body-white'
  state.facadeMaterialId = 'facade-oak'
  state.rows.lower.push({ variantId, startMm: 0, cutWidthMm: null, withoutFacade: false })
  return state
}

const bootstrap = {
  publicationId,
  priceVersionId,
  catalogRevision: 1,
  materials: [
    { id: 'body-white', name: 'Корпус', kind: 'body', isActive: true },
    { id: 'facade-oak', name: 'Фасад', kind: 'facade', isActive: true },
  ],
  variants: [{
    id: variantId,
    familyKey: 'lower',
    row: 'lower',
    sku: 'LOWER',
    publicName: 'Тумба',
    dimensionsMm: { height: 720, width: 600, depth: 500 },
    cutToWidth: { allowed: false, maxReductionMm: null, stepMm: null },
    configuration: {
      role: 'ordinary',
      straightEligible: true,
      reservedUpperRows: [],
      falsePanelPositions: [],
      trimLine: null,
      trimLines: [],
    },
  }],
} satisfies ConfigurationBootstrap

describe('configurator state model', () => {
  test('owns mutations, acceptance reset, and bounded undo/redo state', () => {
    const quote: AcceptedConfigurationQuote = {
      publicationId,
      priceVersionId,
      configurationFingerprint: 'sha256:configuration',
      totalRub: 1000,
      acceptedAt: '2026-10-24T10:00:00.000Z',
    }
    const model = new ConfiguratorStateModel()
    model.restore(configuredState(), quote)

    expect(model.mutate((state) => { state.startSide = 'right' })).toBe(true)
    expect(model.acceptedQuote).toBeNull()
    expect(model.canUndo).toBe(true)
    expect(model.undo()).toBe(true)
    expect(model.state.startSide).toBe('left')
    expect(model.redo()).toBe(true)
    expect(model.state.startSide).toBe('right')
  })

  test('builds the only server command shape and strips UI-only panel anchors', () => {
    const state = configuredState()
    state.falsePanels.push({
      variantId,
      row: 'lower',
      startMm: 600,
      widthMm: 100,
      position: 'between',
      anchorIndex: 0,
    })
    expect(buildConfigurationCommand(state, 'intent-1')).toMatchObject({
      publicationId,
      intentId: 'intent-1',
      rows: [{ row: 'lower', modules: state.rows.lower }],
      falsePanels: [{ position: 'between', startMm: 600 }],
    })
    expect(buildConfigurationCommand(state, 'intent-1')?.falsePanels[0]).not.toHaveProperty('anchorIndex')
  })

  test('restores a compatible draft through the feature-owned boundary', () => {
    const command = buildConfigurationCommand(configuredState(), 'local-draft')!
    const draft: ConfiguratorDraft = {
      draftSchemaVersion: 3,
      savedAt: '2026-10-24T10:00:00.000Z',
      uiOptions: { startSide: 'right' },
      command,
      reconciliationSourceCommand: null,
      acceptedQuote: null,
    }
    expect(configuratorStateFromDraft(draft, bootstrap)).toMatchObject({
      publicationId,
      startSide: 'right',
      rows: { lower: [{ variantId }] },
    })
  })
})
