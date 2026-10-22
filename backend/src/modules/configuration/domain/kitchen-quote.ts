import type {
  ConfigurationMaterial,
  ConfigurationMetadata,
  ConfigurationQuoteRequest,
  ConfigurationQuoteResponse,
  ConfigurationReplacementProposalRequest,
  ConfigurationReplacementProposal,
} from '@seriya/contracts'

export type PublishedKitchenVariant = {
  id: string
  familyKey: string
  row: 'lower' | 'wall' | 'mezzanine' | 'accessory'
  sku: string
  publicName: string
  widthMm: number
  layoutSpanMm: number | null
  consumption: { body: number; facade: number; hdf: number }
  fastenerChargeRub: number
  cutPolicy: 'allowed' | 'forbidden'
  configuration: ConfigurationMetadata
  customerSupplied: string[]
}

export type PublishedKitchenSnapshot = {
  publicationId: string
  priceVersionId: string
  rates: {
    packagingRubM2: number
    customerPriceMultiplier: number
    includedVatFraction: number
    cutToWidthServiceRub: number
    finalCustomerTotalRoundingRub: number
  }
  materials: ConfigurationMaterial[]
  variants: PublishedKitchenVariant[]
}

type Placement = {
  variant: PublishedKitchenVariant
  standardVariant: PublishedKitchenVariant
  row: 'lower' | 'wall' | 'mezzanine'
  startMm: number
  spanMm: number
  withoutFacade: boolean
  cut: boolean
}

type FalsePanelPlacement = Placement & { position: 'start' | 'between' | 'end' }

const rows = ['lower', 'wall', 'mezzanine'] as const

export function calculateKitchenQuote(
  snapshot: PublishedKitchenSnapshot,
  request: ConfigurationQuoteRequest,
): ConfigurationQuoteResponse {
  if (request.publicationId !== snapshot.publicationId) throw new Error('The requested publication is no longer active')

  const variants = new Map(snapshot.variants.map((variant) => [variant.id, variant]))
  const materials = new Map(snapshot.materials.map((material) => [material.id, material]))
  const body = requiredMaterial(materials, request.bodyMaterialId, 'body')
  const hdf = requiredSingleActiveMaterial(snapshot.materials, 'hdf')
  const facade = request.facadeMaterialId === null ? null : requiredMaterial(materials, request.facadeMaterialId, 'facade')

  const placements = request.rows.flatMap((row) => row.modules.map((module) => {
    const selected = requiredVariant(variants, module.variantId)
    if (selected.row !== row.row || !selected.configuration.straightEligible || !['ordinary', 'tall'].includes(selected.configuration.role)) {
      throw new Error('The selected module is not compatible with this straight kitchen row')
    }
    const standardVariant = resolveStandardVariant(snapshot.variants, selected, module.cutWidthMm)
    const spanMm = module.cutWidthMm ?? layoutSpan(standardVariant)
    return {
      variant: selected,
      standardVariant,
      row: row.row,
      startMm: module.startMm,
      spanMm,
      withoutFacade: module.withoutFacade,
      cut: spanMm !== layoutSpan(standardVariant),
    } satisfies Placement
  }))

  assertNoOverlaps(placements)
  assertUpperReservations(placements)
  assertCutLimits(placements)

  const panels = request.falsePanels.map((panel) => {
    const variant = requiredVariant(variants, panel.variantId)
    if (variant.configuration.role !== 'false_panel' || !variant.configuration.straightEligible || !variant.configuration.falsePanelPositions.includes(panel.position)) {
      throw new Error('The selected false panel is not compatible with this position')
    }
    if (panel.widthMm !== layoutSpan(variant)) throw new Error('False panel width must match the published catalog panel')
    if (variant.consumption.facade > 0 && !facade) throw new Error('A facade material is required for a false panel')
    const placement: FalsePanelPlacement = {
      variant,
      standardVariant: variant,
      row: panel.row,
      startMm: panel.startMm,
      spanMm: layoutSpan(variant),
      withoutFacade: false,
      cut: false,
      position: panel.position,
    }
    return placement
  })
  for (const panel of panels) assertFalsePanelPosition(panel, placements, panels.filter((item) => item !== panel))
  assertNoOverlaps([...placements, ...panels])

  const specification: ConfigurationQuoteResponse['specification'] = []
  let wholesaleTotal = 0
  for (const placement of placements) {
    // The per-module switch is the commercial source of truth.  The global
    // control only prepares that switch in the phone UI; a forged request
    // must never turn a facade-bearing module into a cheaper bare one.
    const hasFacade = !placement.withoutFacade && placement.standardVariant.consumption.facade > 0
    const amount = moduleAmount(placement.standardVariant, body, hdf, facade, hasFacade, request.packagingIncluded, snapshot.rates.packagingRubM2)
    wholesaleTotal += amount
    specification.push({
      key: `module:${placement.standardVariant.id}:${placement.startMm}`,
      label: placement.standardVariant.publicName,
      quantity: 1,
      unit: 'шт.',
      amountRub: amount,
      customerSupplied: false,
    })
    if (placement.cut) {
      wholesaleTotal += snapshot.rates.cutToWidthServiceRub
      specification.push({
        key: `cut:${placement.standardVariant.id}:${placement.startMm}`,
        label: `Подрезка ${placement.standardVariant.publicName} до ${placement.spanMm} мм`,
        quantity: 1,
        unit: 'услуга',
        amountRub: snapshot.rates.cutToWidthServiceRub,
        customerSupplied: false,
      })
    }
    for (const comment of placement.standardVariant.customerSupplied) {
      specification.push({ key: `customer:${placement.standardVariant.id}:${comment}`, label: comment, quantity: 1, unit: 'комментарий', amountRub: 0, customerSupplied: true })
    }
  }
  for (const panel of panels) {
    const amount = moduleAmount(panel.variant, body, hdf, facade, true, request.packagingIncluded, snapshot.rates.packagingRubM2)
    wholesaleTotal += amount
    specification.push({ key: `false-panel:${panel.variant.id}:${panel.startMm}`, label: panel.variant.publicName, quantity: 1, unit: 'шт.', amountRub: amount, customerSupplied: false })
  }

  const trimInputs: Array<{ id: string | null; role: 'plinth' | 'crown'; runMm: number }> = [
    { id: request.plinthVariantId, role: 'plinth', runMm: trimRun('plinth', 'lower', placements, panels) },
    { id: request.crownVariantId, role: 'crown', runMm: crownRun(placements, panels) },
  ]
  for (const trim of trimInputs) {
    if (trim.id === null) continue
    const variant = requiredVariant(variants, trim.id)
    if (variant.configuration.role !== trim.role || variant.configuration.trimLine !== trim.role) {
      throw new Error(`The selected ${trim.role} product is invalid`)
    }
    if (variant.consumption.facade > 0 && !facade) throw new Error(`A facade material is required for ${trim.role}`)
    const pieceLengthMm = layoutSpan(variant)
    const quantity = Math.ceil(trim.runMm / pieceLengthMm)
    if (quantity === 0) continue
    const unitAmount = moduleAmount(variant, body, hdf, facade, variant.consumption.facade > 0, request.packagingIncluded, snapshot.rates.packagingRubM2)
    const amount = unitAmount * quantity
    wholesaleTotal += amount
    specification.push({ key: `${trim.role}:${variant.id}`, label: variant.publicName, quantity, unit: `шт. ${pieceLengthMm} мм`, amountRub: amount, customerSupplied: false })
  }

  const totalRub = roundRub(wholesaleTotal * snapshot.rates.customerPriceMultiplier, snapshot.rates.finalCustomerTotalRoundingRub)
  const rowSpansMm = rowSpans([...placements, ...panels])
  const warnings = wallWarnings(request.wallLengthMm ?? null, rowSpansMm)
  return {
    publicationId: snapshot.publicationId,
    priceVersionId: snapshot.priceVersionId,
    intentId: request.intentId,
    totalRub,
    includedVatRub: Number((totalRub * snapshot.rates.includedVatFraction).toFixed(2)),
    kitchenHeightMm: 100 + 780 + request.countertopThicknessMm + 600 + 700 + 350,
    rowSpansMm,
    freeIntervals: freeIntervals(request.wallLengthMm ?? null, [...placements, ...panels]),
    specification,
    warnings,
  }
}

/** Proposes the smallest atomic upper-row package: the selected replacement and, when needed, its right neighbour. */
export function proposeUpperReplacement(
  snapshot: PublishedKitchenSnapshot,
  request: ConfigurationReplacementProposalRequest,
): ConfigurationReplacementProposal {
  if (request.falsePanels.some((item) => item.row === request.row)) {
    throw new Error('Remove false panels from this row before replacing a module')
  }
  const variants = new Map(snapshot.variants.map((variant) => [variant.id, variant]))
  const requestedRow = request.rows.find((item) => item.row === request.row)
  const selected = requestedRow?.modules[request.selectedIndex]
  if (!requestedRow || !selected) throw new Error('The selected upper module is unavailable')
  const currentVariant = requiredVariant(variants, selected.variantId)
  const replacement = requiredVariant(variants, request.replacementVariantId)
  if (currentVariant.row !== request.row || replacement.row !== request.row || !replacement.configuration.straightEligible || replacement.configuration.role !== 'ordinary') {
    throw new Error('The replacement module is not compatible with this upper row')
  }
  const currentSpan = selected.cutWidthMm ?? layoutSpan(currentVariant)
  const replacementSpan = layoutSpan(replacement)
  const ordered = requestedRow.modules.map((item, index) => ({ item, index, spanMm: item.cutWidthMm ?? layoutSpan(requiredVariant(variants, item.variantId)) }))
    .sort((left, right) => left.item.startMm - right.item.startMm)
  const selectedOrderIndex = ordered.findIndex((item) => item.index === request.selectedIndex)
  if (selectedOrderIndex < 0) throw new Error('The selected upper module is unavailable')
  const changes: ConfigurationReplacementProposal['changes'] = [{ row: request.row, index: request.selectedIndex, variantId: replacement.id, startMm: selected.startMm }]
  const delta = replacementSpan - currentSpan
  if (delta !== 0) {
    const right = ordered[selectedOrderIndex + 1]
    if (!right) {
      if (request.wallLengthMm !== null && selected.startMm + replacementSpan > request.wallLengthMm) throw new Error('The replacement module does not fit the selected free interval')
    } else {
      const targetSpan = right.spanMm - delta
      const rightVariant = requiredVariant(variants, right.item.variantId)
      const replacementForRight = snapshot.variants.find((candidate) => candidate.familyKey === rightVariant.familyKey
        && candidate.row === request.row
        && candidate.configuration.straightEligible
        && candidate.configuration.role === 'ordinary'
        && layoutSpan(candidate) === targetSpan)
      if (!replacementForRight) throw new Error('No compatible neighbouring module can preserve this upper-row interval')
      changes.push({ row: request.row, index: right.index, variantId: replacementForRight.id, startMm: selected.startMm + replacementSpan })
    }
  }
  const proposedRows = request.rows.map((row) => row.row !== request.row ? row : {
    ...row,
    modules: row.modules.map((module, index) => {
      const change = changes.find((item) => item.index === index)
      return change ? { ...module, variantId: change.variantId, startMm: change.startMm, cutWidthMm: null } : module
    }),
  })
  const proposedPlacements = proposedRows.flatMap((row) => row.modules.map((module) => {
    const variant = requiredVariant(variants, module.variantId)
    return { variant, standardVariant: variant, row: row.row, startMm: module.startMm, spanMm: module.cutWidthMm ?? layoutSpan(variant), withoutFacade: module.withoutFacade, cut: false } satisfies Placement
  }))
  assertNoOverlaps(proposedPlacements)
  assertUpperReservations(proposedPlacements)
  const wallLengthMm = request.wallLengthMm
  if (wallLengthMm !== null && proposedPlacements.some((item) => item.startMm + item.spanMm > wallLengthMm)) {
    throw new Error('The replacement package exceeds the wall length')
  }
  return { requiresConfirmation: changes.length > 1, changes }
}

function resolveStandardVariant(variants: PublishedKitchenVariant[], selected: PublishedKitchenVariant, requestedWidth: number | null) {
  if (requestedWidth === null || requestedWidth === layoutSpan(selected)) return selected
  if (selected.cutPolicy !== 'allowed') throw new Error('The selected module cannot be cut')
  const matches = variants
    .filter((variant) => variant.familyKey === selected.familyKey && variant.row === selected.row && variant.cutPolicy === 'allowed')
    .filter((variant) => layoutSpan(variant) >= requestedWidth && layoutSpan(variant) - requestedWidth <= 50)
    .sort((left, right) => layoutSpan(left) - layoutSpan(right))
  if (matches.length === 0) throw new Error('Requested cut width is not permitted for this module')
  return matches[0]!
}

function assertCutLimits(placements: Placement[]) {
  for (const row of rows) {
    if (placements.filter((placement) => placement.row === row && placement.cut).length > 2) {
      throw new Error(`No more than two cut modules are allowed in the ${row} row`)
    }
  }
}

function moduleAmount(
  variant: PublishedKitchenVariant,
  body: ConfigurationMaterial,
  hdf: ConfigurationMaterial,
  facade: ConfigurationMaterial | null,
  includesFacade: boolean,
  includesPackaging: boolean,
  packagingRubM2: number,
  multiplier = 1,
) {
  if (variant.consumption.facade > 0 && includesFacade && !facade) throw new Error('A facade material is required')
  return (variant.consumption.body * body.rateRubM2
    + variant.consumption.hdf * hdf.rateRubM2
    + (includesFacade && facade ? variant.consumption.facade * facade.rateRubM2 : 0)
    + variant.fastenerChargeRub
    + (includesPackaging ? variant.consumption.body * packagingRubM2 : 0)) * multiplier
}

function assertNoOverlaps(placements: Placement[]) {
  for (const row of rows) {
    const rowPlacements = placements.filter((item) => item.row === row).sort((left, right) => left.startMm - right.startMm)
    for (let index = 1; index < rowPlacements.length; index += 1) {
      if (rowPlacements[index - 1]!.startMm + rowPlacements[index - 1]!.spanMm > rowPlacements[index]!.startMm) {
        throw new Error(`Modules overlap in the ${row} row`)
      }
    }
  }
}

function assertUpperReservations(placements: Placement[]) {
  const tall = placements.filter((item) => item.variant.configuration.role === 'tall')
  for (const item of placements) {
    for (const blockedRow of tall.flatMap((blocker) => blocker.variant.configuration.reservedUpperRows.map((row) => ({ blocker, row })))) {
      if (item.row !== blockedRow.row) continue
      if (intervalsOverlap(item.startMm, item.spanMm, blockedRow.blocker.startMm, blockedRow.blocker.spanMm)) {
        throw new Error('An upper module overlaps a reserved tall-module zone')
      }
    }
  }
}

function assertFalsePanelPosition(panel: FalsePanelPlacement, modules: Placement[], panels: FalsePanelPlacement[]) {
  const rowItems = [...modules, ...panels].filter((item) => item.row === panel.row)
  if (rowItems.length === 0) return
  const start = Math.min(...rowItems.map((item) => item.startMm))
  const end = Math.max(...rowItems.map((item) => item.startMm + item.spanMm))
  if (panel.position === 'start' && panel.startMm > start) throw new Error('False panel must be at the row start')
  if (panel.position === 'end' && panel.startMm < end) throw new Error('False panel must be at the row end')
  if (panel.position === 'between' && (panel.startMm <= start || panel.startMm >= end)) throw new Error('False panel must be between modules')
}

function trimRun(line: 'plinth' | 'crown', row: Placement['row'], placements: Placement[], panels: FalsePanelPlacement[]) {
  const regular = placements.filter((item) => item.row === row)
  return regular.reduce((total, item) => total + item.spanMm, 0)
    + panels.filter((item) => item.row === row && item.variant.configuration.trimLines.includes(line)).reduce((total, item) => total + item.spanMm, 0)
}

function crownRun(placements: Placement[], panels: FalsePanelPlacement[]) {
  const hasMezzanine = placements.some((item) => item.row === 'mezzanine')
  const upperRun = trimRun('crown', hasMezzanine ? 'mezzanine' : 'wall', placements, panels)
  const tallRun = placements.filter((item) => item.variant.configuration.role === 'tall').reduce((total, item) => total + item.spanMm, 0)
  return upperRun + tallRun
}

function rowSpans(placements: Placement[]) {
  return Object.fromEntries(rows.map((row) => [row, Math.max(0, ...placements.filter((item) => item.row === row).map((item) => item.startMm + item.spanMm))])) as ConfigurationQuoteResponse['rowSpansMm']
}

function wallWarnings(wallLengthMm: number | null, spans: ConfigurationQuoteResponse['rowSpansMm']) {
  if (wallLengthMm === null) return ['Длина стены не указана: проверьте габариты кухни перед заказом.']
  return rows.filter((row) => spans[row] > wallLengthMm).map((row) => `Ряд ${row} выходит за длину стены на ${spans[row] - wallLengthMm} мм.`)
}

function freeIntervals(wallLengthMm: number | null, placements: Placement[]) {
  if (wallLengthMm === null) return []
  return rows.flatMap((row) => {
    const occupied = [
      ...placements.filter((item) => item.row === row).map((item) => ({ startMm: item.startMm, endMm: item.startMm + item.spanMm })),
      ...(row === 'lower' ? [] : placements
        .filter((item) => item.variant.configuration.role === 'tall' && item.variant.configuration.reservedUpperRows.includes(row))
        .map((item) => ({ startMm: item.startMm, endMm: item.startMm + item.spanMm }))),
    ].sort((left, right) => left.startMm - right.startMm)
    const intervals: Array<{ row: typeof row; startMm: number; endMm: number }> = []
    let cursor = 0
    for (const item of occupied) {
      if (item.startMm > cursor) intervals.push({ row, startMm: cursor, endMm: Math.min(item.startMm, wallLengthMm) })
      cursor = Math.max(cursor, item.endMm)
    }
    if (cursor < wallLengthMm) intervals.push({ row, startMm: cursor, endMm: wallLengthMm })
    return intervals.filter((item) => item.endMm > item.startMm)
  })
}

function requiredVariant(variants: Map<string, PublishedKitchenVariant>, id: string) {
  const variant = variants.get(id)
  if (!variant) throw new Error('A selected catalog variant is unavailable')
  return variant
}

function requiredMaterial(materials: Map<string, ConfigurationMaterial>, id: string, kind: ConfigurationMaterial['kind']) {
  const material = materials.get(id)
  if (!material || !material.isActive || material.kind !== kind) throw new Error(`Selected ${kind} material is unavailable`)
  return material
}

function requiredSingleActiveMaterial(materials: ConfigurationMaterial[], kind: ConfigurationMaterial['kind']) {
  const material = materials.find((item) => item.kind === kind && item.isActive)
  if (!material) throw new Error(`No active ${kind} material is published`)
  return material
}

function layoutSpan(variant: PublishedKitchenVariant) {
  return variant.layoutSpanMm ?? variant.widthMm
}

function intervalsOverlap(leftStart: number, leftSpan: number, rightStart: number, rightSpan: number) {
  return leftStart < rightStart + rightSpan && rightStart < leftStart + leftSpan
}

function roundRub(value: number, increment: number) {
  return Math.round((value + Number.EPSILON) / increment) * increment
}
