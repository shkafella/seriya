import type {
  ConfigurationQuoteRequest,
  ReconciliationIssue,
} from '@seriya/contracts'

import {
  resolveStandardVariant,
  validateKitchenGeometry,
  type PublishedKitchenSnapshot,
  type PublishedKitchenVariant,
} from './kitchen-quote'

export function findReconciliationIssues(
  source: PublishedKitchenSnapshot,
  current: PublishedKitchenSnapshot,
  sourceCommand: ConfigurationQuoteRequest,
  working: ConfigurationQuoteRequest,
): ReconciliationIssue[] {
  const sourceVariants = new Map(source.variants.map((variant) => [variant.id, variant]))
  const currentVariants = new Map(current.variants.map((variant) => [variant.id, variant]))
  const sourceMaterials = new Map(source.materials.map((material) => [material.id, material]))
  const currentMaterials = new Map(current.materials.map((material) => [material.id, material]))
  const geometry = resolveReconciliationGeometry(source, current, sourceCommand, working)
  const issues: ReconciliationIssue[] = []

  for (const [field, expectedKind] of [
    ['bodyMaterialId', 'body'],
    ['facadeMaterialId', 'facade'],
  ] as const) {
    const id = working[field]
    if (id === null) continue
    const selected = currentMaterials.get(id)
    if (selected?.isActive && selected.kind === expectedKind) continue
    const original = sourceMaterials.get(id)
    if (!original || original.kind !== expectedKind) throw new Error('The working material has no verified source selection')
    issues.push({
      code: 'MATERIAL_UNAVAILABLE',
      blocking: true,
      path: [field],
      message: `Материал «${original.name}» больше недоступен`,
      target: { kind: 'material', field },
      originalSelection: materialOption(original),
      replacementOptions: current.materials
        .filter((material) => material.isActive && material.kind === expectedKind)
        .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
        .slice(0, 20)
        .map(materialOption),
    })
  }

  for (const [rowIndex, row] of working.rows.entries()) {
    for (const [index, module] of row.modules.entries()) {
      if (geometry.currentModules.has(moduleKey(rowIndex, index))) continue
      const original = sourceVariants.get(module.variantId)
      if (!original || !moduleCompatible(source.variants, original, row.row, module.cutWidthMm)) {
        throw new Error('The working module has no verified source selection')
      }
      issues.push({
        code: 'ITEM_UNAVAILABLE',
        blocking: true,
        path: ['rows', rowIndex, 'modules', index],
        message: `Модуль «${original.publicName}» больше недоступен`,
        target: { kind: 'module', row: row.row, index },
        originalSelection: variantOption(original),
        replacementOptions: replacementVariants(current.variants, original, (candidate) => (
          moduleCompatible(current.variants, candidate, row.row, module.cutWidthMm)
          && layoutSpan(candidate) === layoutSpan(original)
          && replacementPreservesGeometry(geometry, rowIndex, index, candidate.id)
        )),
      })
    }
  }

  for (const [index, panel] of working.falsePanels.entries()) {
    if (geometry.currentPanels.has(index)) continue
    const original = sourceVariants.get(panel.variantId)
    if (!original || !panelCompatible(original, panel.widthMm, panel.position)) {
      throw new Error('The working false panel has no verified source selection')
    }
    issues.push({
      code: 'ITEM_UNAVAILABLE',
      blocking: true,
      path: ['falsePanels', index],
      message: `Фальш-панель «${original.publicName}» больше недоступна`,
      target: { kind: 'false_panel', index },
      originalSelection: variantOption(original),
        replacementOptions: replacementVariants(current.variants, original, (candidate) => (
          panelCompatible(candidate, panel.widthMm, panel.position)
          && panelReplacementPreservesGeometry(geometry, index, candidate.id)
        )),
    })
  }

  for (const [field, role] of [
    ['plinthVariantId', 'plinth'],
    ['crownVariantId', 'crown'],
  ] as const) {
    const id = working[field]
    if (id === null) continue
    const selected = currentVariants.get(id)
    if (selected?.configuration.role === role && selected.configuration.trimLine === role) continue
    const original = sourceVariants.get(id)
    if (!original || original.configuration.role !== role || original.configuration.trimLine !== role) {
      throw new Error('The working trim has no verified source selection')
    }
    issues.push({
      code: 'ITEM_UNAVAILABLE',
      blocking: true,
      path: [field],
      message: `Позиция «${original.publicName}» больше недоступна`,
      target: { kind: 'trim', field },
      originalSelection: variantOption(original),
      replacementOptions: replacementVariants(current.variants, original, (candidate) => (
        candidate.configuration.role === role && candidate.configuration.trimLine === role
      )),
    })
  }

  return issues
}

type ReconciliationGeometry = {
  snapshot: PublishedKitchenSnapshot
  command: ConfigurationQuoteRequest
  currentModules: Set<string>
  currentPanels: Set<number>
}

function resolveReconciliationGeometry(
  source: PublishedKitchenSnapshot,
  current: PublishedKitchenSnapshot,
  sourceCommand: ConfigurationQuoteRequest,
  working: ConfigurationQuoteRequest,
): ReconciliationGeometry {
  const sourceVariants = new Map(source.variants.map((variant) => [variant.id, variant]))
  const currentVariants = new Map(current.variants.map((variant) => [variant.id, variant]))
  const sourceModuleIds = new Map(sourceCommand.rows.flatMap((row) => row.modules.map((module) => (
    [modulePlacementKey(row.row, module.startMm), module.variantId] as const
  ))))
  const sourcePanelIds = new Map(sourceCommand.falsePanels.map((panel) => (
    [panelPlacementKey(panel.row, panel.startMm, panel.position), panel.variantId] as const
  )))
  const snapshot: PublishedKitchenSnapshot = {
    ...current,
    variants: [
      ...current.variants,
      ...source.variants.map((variant) => ({
        ...variant,
        id: historicalVariantId(source.publicationId, variant.id),
        familyKey: `historical:${source.publicationId}:${variant.familyKey}`,
      })),
    ],
  }
  let command = structuredClone(working)
  const currentModules = new Set<string>()
  const currentPanels = new Set<number>()
  const switchableModules: Array<{
    rowIndex: number
    index: number
    id: string
    row: 'lower' | 'wall' | 'mezzanine'
    startMm: number
  }> = []
  const switchablePanels: Array<{ index: number; id: string; row: string; startMm: number }> = []

  for (const [rowIndex, row] of command.rows.entries()) {
    for (const [index, module] of row.modules.entries()) {
      const sourceVariant = sourceVariants.get(module.variantId)
      const currentVariant = currentVariants.get(module.variantId)
      const sourceCompatible = sourceVariant && moduleCompatible(source.variants, sourceVariant, row.row, module.cutWidthMm)
      const currentCompatible = currentVariant && moduleCompatible(current.variants, currentVariant, row.row, module.cutWidthMm)
      const isOriginalSelection = sourceModuleIds.get(modulePlacementKey(row.row, module.startMm)) === module.variantId
      if (isOriginalSelection && sourceCompatible) {
        module.variantId = historicalVariantId(source.publicationId, sourceVariant.id)
        if (currentCompatible) switchableModules.push({
          rowIndex,
          index,
          id: currentVariant.id,
          row: row.row,
          startMm: module.startMm,
        })
      } else if (currentCompatible) {
        currentModules.add(moduleKey(rowIndex, index))
      } else {
        throw new Error('The working module has no verified source selection')
      }
    }
  }

  for (const [index, panel] of command.falsePanels.entries()) {
    const sourceVariant = sourceVariants.get(panel.variantId)
    const currentVariant = currentVariants.get(panel.variantId)
    const sourceCompatible = sourceVariant && panelCompatible(sourceVariant, panel.widthMm, panel.position)
    const currentCompatible = currentVariant && panelCompatible(currentVariant, panel.widthMm, panel.position)
    const isOriginalSelection = sourcePanelIds.get(panelPlacementKey(panel.row, panel.startMm, panel.position)) === panel.variantId
    if (isOriginalSelection && sourceCompatible) {
      panel.variantId = historicalVariantId(source.publicationId, sourceVariant.id)
      if (currentCompatible) switchablePanels.push({ index, id: currentVariant.id, row: panel.row, startMm: panel.startMm })
    } else if (currentCompatible) {
      currentPanels.add(index)
    } else {
      throw new Error('The working false panel has no verified source selection')
    }
  }

  validateKitchenGeometry(snapshot, command)

  const rowOrder = { lower: 0, wall: 1, mezzanine: 2 } as const
  switchableModules.sort((left, right) => rowOrder[left.row] - rowOrder[right.row]
    || left.startMm - right.startMm
    || left.id.localeCompare(right.id))
  switchablePanels.sort((left, right) => left.row.localeCompare(right.row)
    || left.startMm - right.startMm
    || left.id.localeCompare(right.id))

  const fullyCurrent = structuredClone(command)
  for (const candidate of switchableModules) {
    fullyCurrent.rows[candidate.rowIndex]!.modules[candidate.index]!.variantId = candidate.id
  }
  for (const candidate of switchablePanels) fullyCurrent.falsePanels[candidate.index]!.variantId = candidate.id
  if (hasValidGeometry(snapshot, fullyCurrent)) {
    command = fullyCurrent
    switchableModules.forEach((candidate) => currentModules.add(moduleKey(candidate.rowIndex, candidate.index)))
    switchablePanels.forEach((candidate) => currentPanels.add(candidate.index))
    return { snapshot, command, currentModules, currentPanels }
  }

  const pendingModules = [...switchableModules]
  const pendingPanels = [...switchablePanels]
  let progressed: boolean
  do {
    progressed = false
    for (let index = 0; index < pendingModules.length;) {
      const candidate = pendingModules[index]!
      const next = structuredClone(command)
      next.rows[candidate.rowIndex]!.modules[candidate.index]!.variantId = candidate.id
      if (!hasValidGeometry(snapshot, next)) {
        index += 1
        continue
      }
      command = next
      currentModules.add(moduleKey(candidate.rowIndex, candidate.index))
      pendingModules.splice(index, 1)
      progressed = true
    }
    for (let index = 0; index < pendingPanels.length;) {
      const candidate = pendingPanels[index]!
      const next = structuredClone(command)
      next.falsePanels[candidate.index]!.variantId = candidate.id
      if (!hasValidGeometry(snapshot, next)) {
        index += 1
        continue
      }
      command = next
      currentPanels.add(candidate.index)
      pendingPanels.splice(index, 1)
      progressed = true
    }
  } while (progressed)

  return { snapshot, command, currentModules, currentPanels }
}

function replacementPreservesGeometry(
  geometry: ReconciliationGeometry,
  rowIndex: number,
  moduleIndex: number,
  replacementId: string,
) {
  const candidate = structuredClone(geometry.command)
  candidate.rows[rowIndex]!.modules[moduleIndex]!.variantId = replacementId
  return hasValidGeometry(geometry.snapshot, candidate)
}

function panelReplacementPreservesGeometry(
  geometry: ReconciliationGeometry,
  panelIndex: number,
  replacementId: string,
) {
  const candidate = structuredClone(geometry.command)
  candidate.falsePanels[panelIndex]!.variantId = replacementId
  return hasValidGeometry(geometry.snapshot, candidate)
}

function hasValidGeometry(snapshot: PublishedKitchenSnapshot, command: ConfigurationQuoteRequest) {
  try {
    validateKitchenGeometry(snapshot, command)
    return true
  } catch {
    return false
  }
}

function historicalVariantId(publicationId: string, variantId: string) {
  return `historical:${publicationId}:${variantId}`
}

function moduleKey(rowIndex: number, moduleIndex: number) {
  return `${rowIndex}:${moduleIndex}`
}

function modulePlacementKey(row: string, startMm: number) {
  return `${row}:${startMm}`
}

function panelPlacementKey(row: string, startMm: number, position: string) {
  return `${row}:${startMm}:${position}`
}

function moduleCompatible(
  variants: PublishedKitchenVariant[],
  variant: PublishedKitchenVariant,
  row: 'lower' | 'wall' | 'mezzanine',
  cutWidthMm: number | null,
) {
  if (variant.row !== row || !variant.configuration.straightEligible
    || !['ordinary', 'tall'].includes(variant.configuration.role)) return false
  try {
    resolveStandardVariant(variants, variant, cutWidthMm)
    return true
  } catch {
    return false
  }
}

function panelCompatible(
  variant: PublishedKitchenVariant,
  widthMm: number,
  position: 'start' | 'between' | 'end',
) {
  return variant.configuration.role === 'false_panel'
    && variant.configuration.straightEligible
    && variant.configuration.falsePanelPositions.includes(position)
    && layoutSpan(variant) === widthMm
}

function replacementVariants(
  variants: PublishedKitchenVariant[],
  original: PublishedKitchenVariant,
  compatible: (candidate: PublishedKitchenVariant) => boolean,
) {
  return variants
    .filter(compatible)
    .sort((left, right) => (
      Number(right.familyKey === original.familyKey) - Number(left.familyKey === original.familyKey)
      || Math.abs(layoutSpan(left) - layoutSpan(original)) - Math.abs(layoutSpan(right) - layoutSpan(original))
      || left.publicName.localeCompare(right.publicName)
      || left.id.localeCompare(right.id)
    ))
    .slice(0, 20)
    .map(variantOption)
}

function variantOption(variant: PublishedKitchenVariant) {
  return {
    kind: 'variant' as const,
    id: variant.id,
    publicName: variant.publicName,
    sku: variant.sku,
    row: variant.row,
    widthMm: variant.widthMm,
    layoutSpanMm: variant.layoutSpanMm,
  }
}

function materialOption(material: PublishedKitchenSnapshot['materials'][number]) {
  return {
    kind: 'material' as const,
    id: material.id,
    publicName: material.name,
    materialKind: material.kind,
  }
}

function layoutSpan(variant: PublishedKitchenVariant) {
  return variant.layoutSpanMm ?? variant.widthMm
}
