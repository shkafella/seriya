import type { ConfigurationBootstrap } from '@seriya/contracts'

import type { ConfiguratorFalsePanel, ConfiguratorRow, ConfiguratorState } from './state'

type Variant = ConfigurationBootstrap['variants'][number]
export type ConfiguratorInterval = { row: ConfiguratorRow; startMm: number; endMm: number }

export function variantSpan(variant: Variant) {
  return variant.dimensionsMm.layoutSpan ?? variant.dimensionsMm.width
}

function variantById(bootstrap: ConfigurationBootstrap, id: string) {
  const variant = bootstrap.variants.find((item) => item.id === id)
  if (!variant) throw new Error('Модуль больше недоступен')
  return variant
}

export function currentRowEnd(state: ConfiguratorState, bootstrap: ConfigurationBootstrap, row: ConfiguratorRow) {
  return state.rows[row].reduce((end, item) => Math.max(
    end,
    item.startMm + (item.cutWidthMm ?? variantSpan(variantById(bootstrap, item.variantId))),
  ), 0)
}

export function occupiedRowEnd(state: ConfiguratorState, bootstrap: ConfigurationBootstrap, row: ConfiguratorRow) {
  return Math.max(
    0,
    currentRowEnd(state, bootstrap, row),
    ...state.falsePanels.filter((item) => item.row === row).map((item) => item.startMm + item.widthMm),
  )
}

export function reservedRowIntervals(
  state: ConfiguratorState,
  bootstrap: ConfigurationBootstrap,
  row: ConfiguratorRow,
) {
  if (row === 'lower') return []
  return state.rows.lower.flatMap((item) => {
    const variant = variantById(bootstrap, item.variantId)
    if (variant.configuration.role !== 'tall' || !variant.configuration.reservedUpperRows.includes(row)) return []
    const itemSpan = item.cutWidthMm ?? variantSpan(variant)
    return [{ startMm: item.startMm, endMm: item.startMm + itemSpan }]
  }).sort((left, right) => left.startMm - right.startMm)
}

export function nextAvailableStart(
  state: ConfiguratorState,
  bootstrap: ConfigurationBootstrap,
  row: ConfiguratorRow,
  startMm: number,
  itemSpan: number,
) {
  let candidate = startMm
  while (true) {
    const reserved = reservedRowIntervals(state, bootstrap, row)
      .find((interval) => candidate < interval.endMm && candidate + itemSpan > interval.startMm)
    if (!reserved) return candidate
    candidate = reserved.endMm
  }
}

export function flowedRowEnd(
  state: ConfiguratorState,
  bootstrap: ConfigurationBootstrap,
  row: ConfiguratorRow,
  moduleSpans: number[],
  panels = state.falsePanels.filter((item) => item.row === row),
) {
  let startMm = 0
  const place = (itemSpan: number) => {
    startMm = nextAvailableStart(state, bootstrap, row, startMm, itemSpan) + itemSpan
  }
  const rowPanels = panels.filter((item) => item.row === row)
  for (const panel of rowPanels.filter((item) => item.position === 'start')) place(panel.widthMm)
  for (const [index, itemSpan] of moduleSpans.entries()) {
    place(itemSpan)
    for (const panel of rowPanels.filter((item) => item.position === 'between' && item.anchorIndex === index)) {
      place(panel.widthMm)
    }
  }
  for (const panel of rowPanels.filter((item) => item.position === 'end')) place(panel.widthMm)
  return startMm
}

export function moduleFitsWall(
  state: ConfiguratorState,
  bootstrap: ConfigurationBootstrap,
  row: ConfiguratorRow,
  nextModuleSpan = 0,
  replacedIndex: number | null = null,
) {
  const spans = state.rows[row].map(
    (item) => item.cutWidthMm ?? variantSpan(variantById(bootstrap, item.variantId)),
  )
  if (replacedIndex === null) spans.push(nextModuleSpan)
  else spans[replacedIndex] = nextModuleSpan
  return state.wallLengthMm === null
    || flowedRowEnd(state, bootstrap, row, spans) <= state.wallLengthMm
}

export function falsePanelFitsWall(
  state: ConfiguratorState,
  bootstrap: ConfigurationBootstrap,
  row: ConfiguratorRow,
  nextPanelSpan: number,
  position: ConfiguratorFalsePanel['position'],
  anchorIndex?: number,
) {
  const panels = [
    ...state.falsePanels.filter((item) => item.row !== row),
    { variantId: '', row, startMm: 0, widthMm: nextPanelSpan, position, ...(anchorIndex === undefined ? {} : { anchorIndex }) },
  ]
  const spans = state.rows[row].map(
    (item) => item.cutWidthMm ?? variantSpan(variantById(bootstrap, item.variantId)),
  )
  return state.wallLengthMm === null
    || flowedRowEnd(state, bootstrap, row, spans, panels) <= state.wallLengthMm
}

export function freeIntervalsForRow(
  state: ConfiguratorState,
  bootstrap: ConfigurationBootstrap,
  row: ConfiguratorRow,
): ConfiguratorInterval[] {
  const wall = state.wallLengthMm
  if (wall === null) return []
  const occupied = [
    ...state.rows[row].map((item) => ({
      startMm: item.startMm,
      endMm: item.startMm + (item.cutWidthMm ?? variantSpan(variantById(bootstrap, item.variantId))),
    })),
    ...state.falsePanels.filter((item) => item.row === row)
      .map((item) => ({ startMm: item.startMm, endMm: item.startMm + item.widthMm })),
    ...reservedRowIntervals(state, bootstrap, row),
  ].sort((left, right) => left.startMm - right.startMm)
  const intervals: ConfiguratorInterval[] = []
  let cursor = 0
  for (const item of occupied) {
    if (item.startMm > cursor) intervals.push({ row, startMm: cursor, endMm: Math.min(item.startMm, wall) })
    cursor = Math.max(cursor, item.endMm)
  }
  if (cursor < wall) intervals.push({ row, startMm: cursor, endMm: wall })
  return intervals.filter((item) => item.endMm > item.startMm)
}

export function normalizeFalsePanels(state: ConfiguratorState, row: ConfiguratorRow) {
  const count = state.rows[row].length
  state.falsePanels = state.falsePanels.filter(
    (item) => item.row !== row || item.position !== 'between' || count >= 2,
  )
  for (const panel of state.falsePanels) {
    if (panel.row === row && panel.position === 'between') {
      panel.anchorIndex = Math.min(Math.max(panel.anchorIndex ?? 0, 0), count - 2)
    }
  }
}

export function reflowConfiguratorRow(
  state: ConfiguratorState,
  bootstrap: ConfigurationBootstrap,
  row: ConfiguratorRow,
) {
  let startMm = 0
  const panels = state.falsePanels.filter((item) => item.row === row)
  const place = (item: { startMm: number }, itemSpan: number) => {
    item.startMm = nextAvailableStart(state, bootstrap, row, startMm, itemSpan)
    startMm = item.startMm + itemSpan
  }
  for (const panel of panels.filter((item) => item.position === 'start')) place(panel, panel.widthMm)
  for (const [index, item] of state.rows[row].entries()) {
    place(item, item.cutWidthMm ?? variantSpan(variantById(bootstrap, item.variantId)))
    for (const panel of panels.filter((candidate) => candidate.position === 'between' && candidate.anchorIndex === index)) {
      place(panel, panel.widthMm)
    }
  }
  for (const panel of panels.filter((item) => item.position === 'end')) place(panel, panel.widthMm)
  if (row === 'lower') {
    reflowConfiguratorRow(state, bootstrap, 'wall')
    reflowConfiguratorRow(state, bootstrap, 'mezzanine')
  }
}
