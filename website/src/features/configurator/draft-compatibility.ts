import type {
  AcceptedConfigurationQuote,
  ConfigurationBootstrap,
  ConfiguratorDraft,
} from '@seriya/contracts'

export type DraftCompatibility =
  | { status: 'ready'; acceptedQuote: AcceptedConfigurationQuote | null }
  | { status: 'reconciling' }
  | { status: 'stale' }
  | { status: 'corrupt' }

type DraftPlacement = {
  row: string
  start: number
  end: number
  role: 'ordinary' | 'tall' | 'false_panel'
  reservedUpperRows: string[]
  panelPosition?: 'start' | 'between' | 'end'
}

function overlaps(left: DraftPlacement, right: DraftPlacement) {
  return left.start < right.end && right.start < left.end
}

export function validateDraftCompatibility(
  draft: ConfiguratorDraft,
  bootstrap: ConfigurationBootstrap,
): DraftCompatibility {
  const command = draft.command
  if (draft.reconciliationSourceCommand !== null) return { status: 'reconciling' }
  if (command.publicationId !== bootstrap.publicationId) return { status: 'stale' }

  const materials = new Map(bootstrap.materials.map((material) => [material.id, material]))
  const body = materials.get(command.bodyMaterialId)
  const facade = command.facadeMaterialId === null ? null : materials.get(command.facadeMaterialId)
  if (!body || body.kind !== 'body' || !body.isActive) return { status: 'corrupt' }
  if (command.facadeMaterialId !== null && (!facade || facade.kind !== 'facade' || !facade.isActive)) {
    return { status: 'corrupt' }
  }

  const variants = new Map(bootstrap.variants.map((variant) => [variant.id, variant]))
  const modulePlacements: DraftPlacement[] = []
  const cutsByRow = new Map<string, number>()
  for (const row of command.rows) {
    for (const module of row.modules) {
      const variant = variants.get(module.variantId)
      if (!variant
        || variant.row !== row.row
        || !variant.configuration.straightEligible
        || (variant.configuration.role !== 'ordinary' && variant.configuration.role !== 'tall')) {
        return { status: 'corrupt' }
      }
      const standardVariant = resolveStandardVariant(bootstrap, variant, module.cutWidthMm)
      if (!standardVariant) return { status: 'corrupt' }
      const standardWidth = variantSpan(standardVariant)
      const moduleWidth = module.cutWidthMm ?? standardWidth
      if (module.cutWidthMm !== null && module.cutWidthMm !== standardWidth) {
        cutsByRow.set(row.row, (cutsByRow.get(row.row) ?? 0) + 1)
      }
      modulePlacements.push({
        row: row.row,
        start: module.startMm,
        end: module.startMm + moduleWidth,
        role: variant.configuration.role,
        reservedUpperRows: variant.configuration.reservedUpperRows,
      })
    }
  }
  if ([...cutsByRow.values()].some((cuts) => cuts > 2)) return { status: 'corrupt' }

  const panelPlacements: DraftPlacement[] = []
  for (const panel of command.falsePanels) {
    const variant = variants.get(panel.variantId)
    if (!variant
      || variant.configuration.role !== 'false_panel'
      || !variant.configuration.straightEligible
      || !variant.configuration.falsePanelPositions.includes(panel.position)
      || panel.widthMm !== (variant.dimensionsMm.layoutSpan ?? variant.dimensionsMm.width)) {
      return { status: 'corrupt' }
    }
    panelPlacements.push({
      row: panel.row,
      start: panel.startMm,
      end: panel.startMm + panel.widthMm,
      role: 'false_panel',
      reservedUpperRows: [],
      panelPosition: panel.position,
    })
  }

  for (const tall of modulePlacements.filter((placement) => placement.role === 'tall')) {
    for (const placement of modulePlacements) {
      if (tall.reservedUpperRows.includes(placement.row) && overlaps(tall, placement)) {
        return { status: 'corrupt' }
      }
    }
  }

  for (const panel of panelPlacements) {
    const rowItems = [...modulePlacements, ...panelPlacements.filter((item) => item !== panel)]
      .filter((item) => item.row === panel.row)
    if (rowItems.length === 0) continue
    const start = Math.min(...rowItems.map((item) => item.start))
    const end = Math.max(...rowItems.map((item) => item.end))
    if ((panel.panelPosition === 'start' && panel.start > start)
      || (panel.panelPosition === 'end' && panel.start < end)
      || (panel.panelPosition === 'between' && (panel.start <= start || panel.start >= end))) {
      return { status: 'corrupt' }
    }
  }

  const intervalsByRow = new Map<string, DraftPlacement[]>()
  for (const placement of [...modulePlacements, ...panelPlacements]) {
    intervalsByRow.set(placement.row, [...(intervalsByRow.get(placement.row) ?? []), placement])
  }
  for (const intervals of intervalsByRow.values()) {
    intervals.sort((left, right) => left.start - right.start)
    let previousEnd = 0
    for (const interval of intervals) {
      if (interval.start < previousEnd) return { status: 'corrupt' }
      previousEnd = interval.end
    }
  }

  for (const [variantId, role] of [
    [command.plinthVariantId, 'plinth'],
    [command.crownVariantId, 'crown'],
  ] as const) {
    if (variantId !== null && variants.get(variantId)?.configuration.role !== role) {
      return { status: 'corrupt' }
    }
  }

  if (draft.acceptedQuote !== null
    && (draft.acceptedQuote.publicationId !== bootstrap.publicationId
      || draft.acceptedQuote.priceVersionId !== bootstrap.priceVersionId)) {
    return { status: 'corrupt' }
  }

  return { status: 'ready', acceptedQuote: draft.acceptedQuote }
}

function resolveStandardVariant(
  bootstrap: ConfigurationBootstrap,
  selected: ConfigurationBootstrap['variants'][number],
  requestedWidth: number | null,
) {
  if (requestedWidth === null || requestedWidth === variantSpan(selected)) return selected
  if (!selected.cutToWidth.allowed) return null
  return bootstrap.variants
    .filter((variant) => variant.familyKey === selected.familyKey
      && variant.row === selected.row
      && variant.cutToWidth.allowed)
    .filter((variant) => {
      const reduction = variantSpan(variant) - requestedWidth
      return reduction >= 0
        && variant.cutToWidth.maxReductionMm !== null
        && reduction <= variant.cutToWidth.maxReductionMm
        && variant.cutToWidth.stepMm !== null
        && reduction % variant.cutToWidth.stepMm === 0
    })
    .sort((left, right) => variantSpan(left) - variantSpan(right))[0] ?? null
}

function variantSpan(variant: ConfigurationBootstrap['variants'][number]) {
  return variant.dimensionsMm.layoutSpan ?? variant.dimensionsMm.width
}
