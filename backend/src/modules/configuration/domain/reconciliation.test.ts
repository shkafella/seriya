import { describe, expect, test } from 'bun:test'
import type { ConfigurationQuoteRequest } from '@seriya/contracts'

import type { PublishedKitchenSnapshot, PublishedKitchenVariant } from './kitchen-quote'
import { findReconciliationIssues } from './reconciliation'

const oldId = '018f0f89-8a7b-7c6d-8e5f-1234567890a1'
const replacementId = '018f0f89-8a7b-7c6d-8e5f-1234567890a2'
const tallReplacementId = '018f0f89-8a7b-7c6d-8e5f-1234567890a3'
const upperId = '018f0f89-8a7b-7c6d-8e5f-1234567890a4'

function variant(
  id: string,
  publicName: string,
  options: {
    row?: PublishedKitchenVariant['row']
    role?: PublishedKitchenVariant['configuration']['role']
    reservedUpperRows?: Array<'wall' | 'mezzanine'>
    familyKey?: string
    widthMm?: number
    cutPolicy?: PublishedKitchenVariant['cutPolicy']
    falsePanelPositions?: Array<'start' | 'between' | 'end'>
  } = {},
): PublishedKitchenVariant {
  const row = options.row ?? 'lower'
  const widthMm = options.widthMm ?? 600
  return {
    id,
    familyKey: options.familyKey ?? `${row}-cabinet`,
    row,
    sku: id,
    publicName,
    widthMm,
    layoutSpanMm: widthMm,
    consumption: { body: 1, facade: 1, hdf: 1 },
    fastenerChargeRub: 100,
    cutPolicy: options.cutPolicy ?? 'allowed',
    configuration: {
      role: options.role ?? 'ordinary',
      straightEligible: true,
      reservedUpperRows: options.reservedUpperRows ?? [],
      falsePanelPositions: options.falsePanelPositions ?? [],
      trimLine: null,
      trimLines: [],
    },
    customerSupplied: [],
  }
}

function snapshot(publicationId: string, variants: PublishedKitchenVariant[]): PublishedKitchenSnapshot {
  return {
    publicationId,
    priceVersionId: publicationId,
    rates: {
      packagingRubM2: 1,
      customerPriceMultiplier: 1,
      includedVatFraction: 0.2,
      cutToWidthServiceRub: 1,
      finalCustomerTotalRoundingRub: 1,
    },
    materials: [
      { id: 'body', name: 'Корпус', kind: 'body', rateRubM2: 1, isActive: true },
      { id: 'facade', name: 'Фасад', kind: 'facade', rateRubM2: 1, isActive: true },
      { id: 'hdf', name: 'ХДФ', kind: 'hdf', rateRubM2: 1, isActive: true },
    ],
    variants,
  }
}

function firstModuleReplacementOptions(issues: ReturnType<typeof findReconciliationIssues>) {
  const issue = issues.find((item) => item.code === 'ITEM_UNAVAILABLE' && item.target.kind === 'module')
  if (!issue || issue.code !== 'ITEM_UNAVAILABLE') throw new Error('Expected an unavailable module issue')
  return issue.replacementOptions
}

const command: ConfigurationQuoteRequest = {
  publicationId: '018f0f89-8a7b-7c6d-8e5f-1234567890b1',
  intentId: 'reconcile-1',
  wallLengthMm: 2400,
  bodyMaterialId: 'body',
  facadeMaterialId: 'facade',
  facadesIncluded: true,
  packagingIncluded: false,
  countertopThicknessMm: 38,
  rows: [{ row: 'lower', modules: [{ variantId: oldId, startMm: 0, cutWidthMm: null, withoutFacade: false }] }],
  falsePanels: [],
  plinthVariantId: null,
  crownVariantId: null,
}

describe('configuration reconciliation', () => {
  test('preserves a removed module and returns a deterministic compatible replacement', () => {
    const issues = findReconciliationIssues(
      snapshot(command.publicationId, [variant(oldId, 'Старый модуль')]),
      snapshot('018f0f89-8a7b-7c6d-8e5f-1234567890b2', [variant(replacementId, 'Новый модуль')]),
      command,
      { ...command, publicationId: '018f0f89-8a7b-7c6d-8e5f-1234567890b2' },
    )
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      code: 'ITEM_UNAVAILABLE',
      target: { kind: 'module', row: 'lower', index: 0 },
      originalSelection: { id: oldId, publicName: 'Старый модуль' },
      replacementOptions: [{ id: replacementId, publicName: 'Новый модуль' }],
    })
  })

  test('rejects an unavailable selection that was never in the verified source', () => {
    expect(() => findReconciliationIssues(
      snapshot(command.publicationId, [variant(oldId, 'Старый модуль')]),
      snapshot('018f0f89-8a7b-7c6d-8e5f-1234567890b2', [variant(replacementId, 'Новый модуль')]),
      command,
      {
        ...command,
        publicationId: '018f0f89-8a7b-7c6d-8e5f-1234567890b2',
        rows: [{ row: 'lower', modules: [{ ...command.rows[0]!.modules[0]!, variantId: '018f0f89-8a7b-7c6d-8e5f-123456789099' }] }],
      },
    )).toThrow('no verified source selection')
  })

  test('does not offer a replacement that conflicts with the rest of the kitchen geometry', () => {
    const upper = variant(upperId, 'Верхний модуль', { row: 'wall' })
    const tall = variant(tallReplacementId, 'Пенал', { role: 'tall', reservedUpperRows: ['wall', 'mezzanine'] })
    const working: ConfigurationQuoteRequest = {
      ...command,
      publicationId: '018f0f89-8a7b-7c6d-8e5f-1234567890b2',
      rows: [
        command.rows[0]!,
        { row: 'wall', modules: [{ variantId: upperId, startMm: 0, cutWidthMm: null, withoutFacade: false }] },
      ],
    }

    const issues = findReconciliationIssues(
      snapshot(command.publicationId, [variant(oldId, 'Старый модуль'), upper]),
      snapshot(working.publicationId, [tall, upper]),
      command,
      working,
    )

    expect(issues[0]).toMatchObject({
      code: 'ITEM_UNAVAILABLE',
      target: { kind: 'module', row: 'lower', index: 0 },
      replacementOptions: [],
    })
  })

  test('does not let historical standard widths hide the current cut limit', () => {
    const old550Id = '018f0f89-8a7b-7c6d-8e5f-1234567890a5'
    const new600Id = '018f0f89-8a7b-7c6d-8e5f-1234567890a6'
    const source = snapshot(command.publicationId, [
      variant(oldId, 'Старый 600', { familyKey: 'cut-family' }),
      variant(old550Id, 'Старый 550', { familyKey: 'cut-family', widthMm: 550 }),
    ])
    const current = snapshot('018f0f89-8a7b-7c6d-8e5f-1234567890b2', [
      variant(new600Id, 'Новый 600', { familyKey: 'cut-family' }),
    ])
    const working: ConfigurationQuoteRequest = {
      ...command,
      publicationId: current.publicationId,
      rows: [{
        row: 'lower',
        modules: [0, 550, 1100].map((startMm) => ({
          variantId: oldId,
          startMm,
          cutWidthMm: 550,
          withoutFacade: false,
        })),
      }],
    }
    const sourceCommand = { ...structuredClone(working), publicationId: source.publicationId }

    expect(firstModuleReplacementOptions(findReconciliationIssues(source, current, sourceCommand, working))).toHaveLength(1)
    working.rows[0]!.modules[0]!.variantId = new600Id
    expect(firstModuleReplacementOptions(findReconciliationIssues(source, current, sourceCommand, working))).toHaveLength(1)
    working.rows[0]!.modules[1]!.variantId = new600Id
    expect(firstModuleReplacementOptions(findReconciliationIssues(source, current, sourceCommand, working))).toHaveLength(0)
  })

  test('keeps the complete historical width family while evaluating current replacements', () => {
    const old550Id = '018f0f89-8a7b-7c6d-8e5f-1234567890a5'
    const new600Id = '018f0f89-8a7b-7c6d-8e5f-1234567890a6'
    const source = snapshot(command.publicationId, [
      variant(oldId, 'Старый 600', { familyKey: 'cut-family' }),
      variant(old550Id, 'Старый 550', { familyKey: 'cut-family', widthMm: 550 }),
    ])
    const current = snapshot('018f0f89-8a7b-7c6d-8e5f-1234567890b2', [
      variant(old550Id, 'Текущий 550', { familyKey: 'cut-family', widthMm: 550 }),
      variant(new600Id, 'Новый 600', { familyKey: 'cut-family' }),
    ])
    const working: ConfigurationQuoteRequest = {
      ...command,
      publicationId: current.publicationId,
      rows: [{
        row: 'lower',
        modules: [0, 550, 1100, 1650].map((startMm) => ({
          variantId: oldId,
          startMm,
          cutWidthMm: 550,
          withoutFacade: false,
        })),
      }],
    }
    const sourceCommand = { ...structuredClone(working), publicationId: source.publicationId }

    const issues = findReconciliationIssues(source, current, sourceCommand, working)
      .flatMap((item) => item.code === 'ITEM_UNAVAILABLE' && item.target.kind === 'module' ? [item] : [])
    expect(issues).toHaveLength(4)
    expect(issues.every((issue) => issue.replacementOptions.some((option) => option.id === new600Id))).toBe(true)

    working.rows[0]!.modules.forEach((module) => { module.variantId = new600Id })
    expect(findReconciliationIssues(source, current, sourceCommand, working)).toHaveLength(0)
  })

  test('turns a retained id with a newly forbidden cut into a repairable issue', () => {
    const currentPublicationId = '018f0f89-8a7b-7c6d-8e5f-1234567890b2'
    const source = snapshot(command.publicationId, [variant(oldId, 'Старый модуль')])
    const current = snapshot(currentPublicationId, [
      variant(oldId, 'Изменённый модуль', { cutPolicy: 'forbidden' }),
      variant(replacementId, 'Безопасная замена'),
    ])
    const working: ConfigurationQuoteRequest = {
      ...command,
      publicationId: currentPublicationId,
      rows: [{ row: 'lower', modules: [{ variantId: oldId, startMm: 0, cutWidthMm: 550, withoutFacade: false }] }],
    }

    expect(findReconciliationIssues(source, current, command, working)).toMatchObject([{
      code: 'ITEM_UNAVAILABLE',
      target: { kind: 'module', row: 'lower', index: 0 },
      originalSelection: { id: oldId },
      replacementOptions: [{ id: replacementId }],
    }])
  })

  test('rejects an intermediate removal that strands a between panel even while another blocker remains', () => {
    const retainedModuleId = '018f0f89-8a7b-7c6d-8e5f-1234567890a5'
    const panelId = '018f0f89-8a7b-7c6d-8e5f-1234567890a6'
    const source = snapshot(command.publicationId, [
      variant(oldId, 'Удалённый модуль'),
      variant(retainedModuleId, 'Оставшийся модуль'),
      variant(panelId, 'Панель', { role: 'false_panel', widthMm: 600, falsePanelPositions: ['between'] }),
    ])
    const current = snapshot('018f0f89-8a7b-7c6d-8e5f-1234567890b2', [
      variant(retainedModuleId, 'Оставшийся модуль'),
      variant(panelId, 'Панель', { role: 'false_panel', widthMm: 600, falsePanelPositions: ['between'] }),
    ])
    current.materials = current.materials.filter((material) => material.kind !== 'facade')
    const working: ConfigurationQuoteRequest = {
      ...command,
      publicationId: current.publicationId,
      rows: [{ row: 'lower', modules: [{ variantId: retainedModuleId, startMm: 1200, cutWidthMm: null, withoutFacade: false }] }],
      falsePanels: [{ variantId: panelId, row: 'lower', startMm: 600, widthMm: 600, position: 'between' }],
    }

    expect(() => findReconciliationIssues(source, current, command, working)).toThrow('False panel must be between modules')
  })

  test('keeps a chosen current replacement current when its id also existed historically', () => {
    const retainedId = '018f0f89-8a7b-7c6d-8e5f-1234567890a5'
    const source = snapshot(command.publicationId, [
      variant(oldId, 'Исходный 600'),
      variant(retainedId, 'Соседний 600'),
      variant(replacementId, 'Исторический 800', { widthMm: 800, familyKey: 'replacement' }),
    ])
    const sourceCommand: ConfigurationQuoteRequest = {
      ...command,
      rows: [{ row: 'lower', modules: [
        { variantId: oldId, startMm: 0, cutWidthMm: null, withoutFacade: false },
        { variantId: retainedId, startMm: 600, cutWidthMm: null, withoutFacade: false },
      ] }],
    }
    const current = snapshot('018f0f89-8a7b-7c6d-8e5f-1234567890b2', [
      variant(retainedId, 'Соседний 600'),
      variant(replacementId, 'Текущая замена 600', { widthMm: 600, familyKey: 'replacement' }),
    ])
    const working: ConfigurationQuoteRequest = {
      ...sourceCommand,
      publicationId: current.publicationId,
      rows: [{ row: 'lower', modules: [
        { variantId: replacementId, startMm: 0, cutWidthMm: null, withoutFacade: false },
        { variantId: retainedId, startMm: 600, cutWidthMm: null, withoutFacade: false },
      ] }],
    }

    expect(findReconciliationIssues(source, current, sourceCommand, working)).toHaveLength(0)
  })

  test('accepts a jointly valid current cut distribution independently of module array order', () => {
    const a550Id = '018f0f89-8a7b-7c6d-8e5f-1234567890a5'
    const b600Id = '018f0f89-8a7b-7c6d-8e5f-1234567890a6'
    const b550Id = '018f0f89-8a7b-7c6d-8e5f-1234567890a7'
    const source = snapshot(command.publicationId, [
      variant(oldId, 'A600', { familyKey: 'family-a' }),
      variant(a550Id, 'A550', { familyKey: 'family-a', widthMm: 550 }),
      variant(b600Id, 'B600', { familyKey: 'family-b' }),
    ])
    const current = snapshot('018f0f89-8a7b-7c6d-8e5f-1234567890b2', [
      variant(oldId, 'A600', { familyKey: 'family-a' }),
      variant(b600Id, 'B600', { familyKey: 'family-b' }),
      variant(b550Id, 'B550', { familyKey: 'family-b', widthMm: 550 }),
    ])
    const modules = [
      { variantId: oldId, startMm: 0, cutWidthMm: 550, withoutFacade: false },
      { variantId: oldId, startMm: 550, cutWidthMm: 550, withoutFacade: false },
      { variantId: b600Id, startMm: 1100, cutWidthMm: 550, withoutFacade: false },
      { variantId: b600Id, startMm: 1650, cutWidthMm: 550, withoutFacade: false },
    ]
    const sourceCommand: ConfigurationQuoteRequest = {
      ...command,
      rows: [{ row: 'lower', modules: structuredClone(modules) }],
    }
    const working: ConfigurationQuoteRequest = {
      ...sourceCommand,
      publicationId: current.publicationId,
      rows: [{ row: 'lower', modules: structuredClone(modules) }],
    }

    expect(findReconciliationIssues(source, current, sourceCommand, working)).toHaveLength(0)
    working.rows[0]!.modules.reverse()
    expect(findReconciliationIssues(source, current, sourceCommand, working)).toHaveLength(0)
  })

  test('uses an exact family standard when the requested width is over 50 mm below the selected variant', () => {
    const standard450Id = '018f0f89-8a7b-7c6d-8e5f-1234567890a5'
    const source = snapshot(command.publicationId, [
      variant(oldId, 'A600', { familyKey: 'family-a' }),
      variant(standard450Id, 'A450', { familyKey: 'family-a', widthMm: 450 }),
    ])
    const current = snapshot('018f0f89-8a7b-7c6d-8e5f-1234567890b2', source.variants)
    const sourceCommand: ConfigurationQuoteRequest = {
      ...command,
      rows: [{ row: 'lower', modules: [{ variantId: oldId, startMm: 0, cutWidthMm: 450, withoutFacade: false }] }],
    }
    const working = { ...structuredClone(sourceCommand), publicationId: current.publicationId }

    expect(findReconciliationIssues(source, current, sourceCommand, working)).toHaveLength(0)
  })
})
