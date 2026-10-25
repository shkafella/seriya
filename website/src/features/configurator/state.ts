import type {
  AcceptedConfigurationQuote,
  ConfigurationBootstrap,
  ConfigurationQuoteRequest,
  ConfiguratorDraft,
} from '@seriya/contracts'

import { validateDraftCompatibility } from './draft-compatibility'
import { commitHistory, createHistory, redoHistory, undoHistory } from './history'

export type ConfiguratorRow = 'lower' | 'wall' | 'mezzanine'
export type ConfiguratorModule = {
  variantId: string
  startMm: number
  cutWidthMm: number | null
  withoutFacade: boolean
}
export type ConfiguratorFalsePanel = {
  variantId: string
  row: ConfiguratorRow
  startMm: number
  widthMm: number
  position: 'start' | 'between' | 'end'
  anchorIndex?: number
}
export type ConfiguratorState = {
  publicationId: string
  wallLengthMm: number | null
  startSide: 'left' | 'right'
  bodyMaterialId: string
  facadeMaterialId: string | null
  facadesIncluded: boolean
  packagingIncluded: boolean
  countertopThicknessMm: 12 | 20 | 38
  rows: Record<ConfiguratorRow, ConfiguratorModule[]>
  falsePanels: ConfiguratorFalsePanel[]
  plinthVariantId: string | null
  crownVariantId: string | null
}

export const configuratorRows: ConfiguratorRow[] = ['lower', 'wall', 'mezzanine']

export function createEmptyConfiguratorState(): ConfiguratorState {
  return {
    publicationId: '',
    wallLengthMm: null,
    startSide: 'left',
    bodyMaterialId: '',
    facadeMaterialId: null,
    facadesIncluded: true,
    packagingIncluded: false,
    countertopThicknessMm: 38,
    rows: { lower: [], wall: [], mezzanine: [] },
    falsePanels: [],
    plinthVariantId: null,
    crownVariantId: null,
  }
}

export function createInitialConfiguratorState(bootstrap: ConfigurationBootstrap): ConfiguratorState {
  const state = createEmptyConfiguratorState()
  state.publicationId = bootstrap.publicationId
  state.bodyMaterialId = bootstrap.materials.find((item) => item.kind === 'body')?.id ?? ''
  state.facadeMaterialId = bootstrap.materials.find((item) => item.kind === 'facade')?.id ?? null
  return state
}

export function buildConfigurationCommand(
  state: ConfiguratorState,
  intentId: string,
): ConfigurationQuoteRequest | null {
  const selectedRows = configuratorRows
    .filter((row) => state.rows[row].length > 0)
    .map((row) => ({ row, modules: state.rows[row] }))
  if (selectedRows.length === 0 || !state.publicationId || !state.bodyMaterialId) return null
  return {
    publicationId: state.publicationId,
    intentId,
    wallLengthMm: state.wallLengthMm,
    bodyMaterialId: state.bodyMaterialId,
    facadeMaterialId: state.facadeMaterialId,
    facadesIncluded: state.facadesIncluded,
    packagingIncluded: state.packagingIncluded,
    countertopThicknessMm: state.countertopThicknessMm,
    rows: selectedRows,
    falsePanels: state.falsePanels.map(({ anchorIndex: _anchorIndex, ...panel }) => panel),
    plinthVariantId: state.plinthVariantId,
    crownVariantId: state.crownVariantId,
  }
}

export function configuratorStateFromDraft(
  draft: ConfiguratorDraft,
  bootstrap: ConfigurationBootstrap,
): ConfiguratorState | null {
  if (validateDraftCompatibility(draft, bootstrap).status !== 'ready') return null
  const command = draft.command
  const restoredRows: ConfiguratorState['rows'] = { lower: [], wall: [], mezzanine: [] }
  for (const row of command.rows) restoredRows[row.row] = structuredClone(row.modules)
  const restoredPanels = command.falsePanels.map((panel) => {
    if (panel.position !== 'between') return { ...panel }
    const precedingIndex = restoredRows[panel.row].findLastIndex((module) => module.startMm < panel.startMm)
    return { ...panel, anchorIndex: Math.max(0, precedingIndex) }
  })
  return {
    publicationId: command.publicationId,
    wallLengthMm: command.wallLengthMm ?? null,
    startSide: draft.uiOptions.startSide,
    bodyMaterialId: command.bodyMaterialId,
    facadeMaterialId: command.facadeMaterialId,
    facadesIncluded: command.facadesIncluded,
    packagingIncluded: command.packagingIncluded,
    countertopThicknessMm: command.countertopThicknessMm,
    rows: restoredRows,
    falsePanels: restoredPanels,
    plinthVariantId: command.plinthVariantId,
    crownVariantId: command.crownVariantId,
  }
}

export class ConfiguratorStateModel {
  private history
  private accepted: AcceptedConfigurationQuote | null = null

  constructor(initialState = createEmptyConfiguratorState()) {
    this.history = createHistory(initialState)
  }

  get state() { return this.history.present }
  get acceptedQuote() { return this.accepted }
  get canUndo() { return this.history.past.length > 0 }
  get canRedo() { return this.history.future.length > 0 }

  mutate(mutator: (nextState: ConfiguratorState) => void) {
    const nextState = structuredClone(this.state)
    mutator(nextState)
    const nextHistory = commitHistory(this.history, nextState)
    if (nextHistory === this.history) return false
    this.history = nextHistory
    this.accepted = null
    return true
  }

  restore(nextState: ConfiguratorState, acceptedQuote: AcceptedConfigurationQuote | null = null) {
    this.history = createHistory(nextState)
    this.accepted = acceptedQuote
  }

  accept(acceptedQuote: AcceptedConfigurationQuote) {
    this.accepted = acceptedQuote
  }

  clearAcceptance() {
    if (this.accepted === null) return false
    this.accepted = null
    return true
  }

  undo() {
    const nextHistory = undoHistory(this.history)
    if (nextHistory === this.history) return false
    this.history = nextHistory
    this.accepted = null
    return true
  }

  redo() {
    const nextHistory = redoHistory(this.history)
    if (nextHistory === this.history) return false
    this.history = nextHistory
    this.accepted = null
    return true
  }
}
