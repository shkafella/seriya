import { describe, expect, test } from 'bun:test'

import { calculateKitchenQuote, proposeUpperReplacement, type PublishedKitchenSnapshot } from './kitchen-quote'

const ids = {
  publication: '019c0a31-7d03-7000-8000-000000000001',
  price: '019c0a31-7d03-7000-8000-000000000002',
  lower600: '019c0a31-7d03-7000-8000-000000000003',
  lower550: '019c0a31-7d03-7000-8000-000000000004',
  falsePanel: '019c0a31-7d03-7000-8000-000000000005',
  plinth: '019c0a31-7d03-7000-8000-000000000006',
  crown: '019c0a31-7d03-7000-8000-000000000007',
  wall550: '019c0a31-7d03-7000-8000-000000000008',
  wall600: '019c0a31-7d03-7000-8000-000000000009',
  wall500: '019c0a31-7d03-7000-8000-000000000010',
}

const snapshot: PublishedKitchenSnapshot = {
  publicationId: ids.publication,
  priceVersionId: ids.price,
  rates: {
    packagingRubM2: 350,
    customerPriceMultiplier: 1.1,
    includedVatFraction: 22 / 122,
    cutToWidthServiceRub: 3000,
    finalCustomerTotalRoundingRub: 10,
  },
  materials: [
    { id: 'body-white', name: 'Белый корпус', kind: 'body', rateRubM2: 2050, isActive: true },
    { id: 'facade-agt', name: 'AGT 1', kind: 'facade', rateRubM2: 3000, isActive: true },
    { id: 'hdf-white', name: 'ХДФ белый', kind: 'hdf', rateRubM2: 600, isActive: true },
  ],
  variants: [
    {
      id: ids.lower600, familyKey: 'lower-shelf', row: 'lower', sku: 'L600', publicName: 'Нижний 600', widthMm: 600, layoutSpanMm: 600,
      consumption: { body: 2, facade: 1, hdf: 0.5 }, fastenerChargeRub: 100, cutPolicy: 'allowed',
      configuration: { role: 'ordinary', straightEligible: true, reservedUpperRows: [], falsePanelPositions: [], trimLine: null, trimLines: [] },
      customerSupplied: ['Петли покупают сами'],
    },
    {
      id: ids.lower550, familyKey: 'lower-shelf', row: 'lower', sku: 'L550', publicName: 'Нижний 550', widthMm: 550, layoutSpanMm: 550,
      consumption: { body: 1.8, facade: 0.9, hdf: 0.45 }, fastenerChargeRub: 90, cutPolicy: 'allowed',
      configuration: { role: 'ordinary', straightEligible: true, reservedUpperRows: [], falsePanelPositions: [], trimLine: null, trimLines: [] },
      customerSupplied: [],
    },
    {
      id: ids.falsePanel, familyKey: 'false-panel', row: 'accessory', sku: 'FP', publicName: 'Фальш-панель', widthMm: 16, layoutSpanMm: 16,
      consumption: { body: 0, facade: 1, hdf: 0 }, fastenerChargeRub: 0, cutPolicy: 'forbidden',
      configuration: { role: 'false_panel', straightEligible: true, reservedUpperRows: [], falsePanelPositions: ['start', 'between', 'end'], trimLine: null, trimLines: ['plinth'] },
      customerSupplied: [],
    },
    {
      id: ids.plinth, familyKey: 'plinth', row: 'accessory', sku: 'P2700', publicName: 'Цоколь', widthMm: 2700, layoutSpanMm: 2700,
      consumption: { body: 0.27, facade: 0, hdf: 0, }, fastenerChargeRub: 6, cutPolicy: 'forbidden',
      configuration: { role: 'plinth', straightEligible: false, reservedUpperRows: [], falsePanelPositions: [], trimLine: 'plinth', trimLines: [] },
      customerSupplied: [],
    },
    {
      id: ids.crown, familyKey: 'cornice', row: 'accessory', sku: 'C2700', publicName: 'Корона', widthMm: 2700, layoutSpanMm: 2700,
      consumption: { body: 0.27, facade: 0, hdf: 0.1 }, fastenerChargeRub: 6, cutPolicy: 'forbidden',
      configuration: { role: 'crown', straightEligible: false, reservedUpperRows: [], falsePanelPositions: [], trimLine: 'crown', trimLines: [] },
      customerSupplied: [],
    },
    {
      id: ids.wall550, familyKey: 'wall-shelf', row: 'wall', sku: 'W550', publicName: 'Верхний 550', widthMm: 550, layoutSpanMm: 550,
      consumption: { body: 1, facade: 0.5, hdf: 0.2 }, fastenerChargeRub: 50, cutPolicy: 'allowed',
      configuration: { role: 'ordinary', straightEligible: true, reservedUpperRows: [], falsePanelPositions: [], trimLine: null, trimLines: [] },
      customerSupplied: [],
    },
    {
      id: ids.wall600, familyKey: 'wall-shelf', row: 'wall', sku: 'W600', publicName: 'Верхний 600', widthMm: 600, layoutSpanMm: 600,
      consumption: { body: 1, facade: 0.5, hdf: 0.2 }, fastenerChargeRub: 50, cutPolicy: 'allowed',
      configuration: { role: 'ordinary', straightEligible: true, reservedUpperRows: [], falsePanelPositions: [], trimLine: null, trimLines: [] },
      customerSupplied: [],
    },
    {
      id: ids.wall500, familyKey: 'wall-shelf', row: 'wall', sku: 'W500', publicName: 'Верхний 500', widthMm: 500, layoutSpanMm: 500,
      consumption: { body: 1, facade: 0.5, hdf: 0.2 }, fastenerChargeRub: 50, cutPolicy: 'allowed',
      configuration: { role: 'ordinary', straightEligible: true, reservedUpperRows: [], falsePanelPositions: [], trimLine: null, trimLines: [] },
      customerSupplied: [],
    },
  ],
}

const request = {
  publicationId: ids.publication,
  intentId: 'quote-1',
  bodyMaterialId: 'body-white',
  facadeMaterialId: 'facade-agt',
  facadesIncluded: true,
  packagingIncluded: true,
  countertopThicknessMm: 38 as const,
  rows: [{ row: 'lower' as const, modules: [{ variantId: ids.lower600, startMm: 0, cutWidthMm: 570, withoutFacade: false }] }],
  falsePanels: [],
  plinthVariantId: null,
  crownVariantId: null,
}

describe('exact kitchen quote', () => {
  test('uses the nearest permitted standard module price plus a fixed cut service', () => {
    const quote = calculateKitchenQuote(snapshot, request)

    expect(quote.rowSpansMm.lower).toBe(570)
    expect(quote.totalRub).toBe(12320)
    expect(quote.specification.some((line) => line.label.includes('Подрезка'))).toBe(true)
    expect(quote.specification.some((line) => line.customerSupplied)).toBe(true)
  })

  test('does not count an exact standard width as a cut, but still rejects a third actual cut', () => {
    const exactStandards = calculateKitchenQuote(snapshot, {
      ...request,
      rows: [{ row: 'lower', modules: [0, 1, 2].map((index) => ({
        variantId: ids.lower600, startMm: index * 600, cutWidthMm: 600, withoutFacade: false,
      })) }],
    })
    expect(exactStandards.specification.some((line) => line.label.includes('Подрезка'))).toBe(false)

    expect(() => calculateKitchenQuote(snapshot, {
      ...request,
      rows: [{ row: 'lower', modules: [0, 1, 2].map((index) => ({
        variantId: ids.lower600, startMm: index * 570, cutWidthMm: 570, withoutFacade: false,
      })) }],
    })).toThrow('No more than two cut modules')
  })

  test('does not permit a cut merely because another family variant is cuttable', () => {
    expect(() => calculateKitchenQuote({
      ...snapshot,
      variants: snapshot.variants.map((variant) => variant.id === ids.lower600 ? { ...variant, cutPolicy: 'forbidden' as const } : variant),
    }, request)).toThrow('cannot be cut')
  })

  test('prices selected whole trim pieces from their covered front run', () => {
    const quote = calculateKitchenQuote(snapshot, {
      ...request,
      rows: [{ row: 'lower', modules: Array.from({ length: 9 }, (_, index) => ({
        variantId: ids.lower600, startMm: index * 600, cutWidthMm: null, withoutFacade: false,
      })) }],
      falsePanels: [{ variantId: ids.falsePanel, row: 'lower', startMm: 5400, widthMm: 16, position: 'end' }],
      plinthVariantId: ids.plinth,
      crownVariantId: null,
    })

    expect(quote.rowSpansMm.lower).toBe(5416)
    expect(quote.specification.find((line) => line.label === 'Цоколь')?.quantity).toBe(3)
  })

  test('accepts a false panel at the beginning or between non-overlapping modules', () => {
    const atStart = calculateKitchenQuote(snapshot, {
      ...request,
      rows: [{ row: 'lower', modules: [{ variantId: ids.lower600, startMm: 16, cutWidthMm: null, withoutFacade: false }] }],
      falsePanels: [{ variantId: ids.falsePanel, row: 'lower', startMm: 0, widthMm: 16, position: 'start' }],
    })
    const between = calculateKitchenQuote(snapshot, {
      ...request,
      rows: [{ row: 'lower', modules: [
        { variantId: ids.lower600, startMm: 0, cutWidthMm: null, withoutFacade: false },
        { variantId: ids.lower600, startMm: 616, cutWidthMm: null, withoutFacade: false },
      ] }],
      falsePanels: [{ variantId: ids.falsePanel, row: 'lower', startMm: 600, widthMm: 16, position: 'between' }],
    })

    expect(atStart.rowSpansMm.lower).toBe(616)
    expect(between.rowSpansMm.lower).toBe(1216)
  })

  test('refuses a facade-priced false panel without a facade material', () => {
    expect(() => calculateKitchenQuote(snapshot, {
      ...request,
      facadesIncluded: false,
      facadeMaterialId: null,
      falsePanels: [{ variantId: ids.falsePanel, row: 'lower', startMm: 600, widthMm: 16, position: 'end' }],
    })).toThrow('facade')
  })

  test('refuses a forged false-panel width instead of discounting it', () => {
    expect(() => calculateKitchenQuote(snapshot, {
      ...request,
      rows: [{ row: 'lower', modules: [{ variantId: ids.lower600, startMm: 0, cutWidthMm: null, withoutFacade: false }] }],
      falsePanels: [{ variantId: ids.falsePanel, row: 'lower', startMm: 600, widthMm: 1, position: 'end' }],
    })).toThrow('False panel width')
  })

  test('does not let a globally disabled facade toggle underprice an individual faced module', () => {
    expect(() => calculateKitchenQuote(snapshot, {
      ...request,
      facadesIncluded: false,
      facadeMaterialId: null,
    })).toThrow('facade')

    const quote = calculateKitchenQuote(snapshot, {
      ...request,
      facadesIncluded: false,
    })

    expect(quote.totalRub).toBe(12320)
  })

  test('allows a deliberately bare individual module without a facade material', () => {
    const quote = calculateKitchenQuote(snapshot, {
      ...request,
      facadesIncluded: false,
      facadeMaterialId: null,
      rows: [{ row: 'lower', modules: [{ variantId: ids.lower600, startMm: 0, cutWidthMm: 570, withoutFacade: true }] }],
    })

    expect(quote.totalRub).toBe(9020)
  })

  test('uses the mezzanine or wall run for whole crown pieces', () => {
    const quote = calculateKitchenQuote(snapshot, {
      ...request,
      rows: [{ row: 'wall', modules: Array.from({ length: 6 }, (_, index) => ({
        variantId: ids.wall550, startMm: index * 550, cutWidthMm: null, withoutFacade: false,
      })) }],
      crownVariantId: ids.crown,
    })

    expect(quote.specification.find((line) => line.label === 'Корона')?.quantity).toBe(2)
  })

  test('uses the published trim length rather than an assumed 2700 mm length', () => {
    const quote = calculateKitchenQuote({
      ...snapshot,
      variants: snapshot.variants.map((variant) => variant.id === ids.crown ? { ...variant, layoutSpanMm: 1600 } : variant),
    }, {
      ...request,
      rows: [{ row: 'wall', modules: Array.from({ length: 6 }, (_, index) => ({
        variantId: ids.wall550, startMm: index * 550, cutWidthMm: null, withoutFacade: false,
      })) }],
      crownVariantId: ids.crown,
    })

    const crown = quote.specification.find((line) => line.label === 'Корона')
    expect(crown?.quantity).toBe(3)
    expect(crown?.unit).toBe('шт. 1600 мм')
  })

  test('returns server-normalized free intervals including the unused wall run', () => {
    const quote = calculateKitchenQuote(snapshot, { ...request, wallLengthMm: 1200, rows: [{ row: 'lower', modules: [{ variantId: ids.lower600, startMm: 0, cutWidthMm: null, withoutFacade: false }] }] })

    expect(quote.freeIntervals).toContainEqual({ row: 'lower', startMm: 600, endMm: 1200 })
  })

  test('proposes an explicit neighbouring upper-module replacement before changing coverage', () => {
    const proposal = proposeUpperReplacement(snapshot, {
      publicationId: ids.publication, row: 'wall', selectedIndex: 0, replacementVariantId: ids.wall600, wallLengthMm: 1100,
      rows: [{ row: 'lower', modules: [] }, { row: 'wall', modules: [
        { variantId: ids.wall550, startMm: 0, cutWidthMm: null, withoutFacade: false },
        { variantId: ids.wall550, startMm: 550, cutWidthMm: null, withoutFacade: false },
      ] }],
      falsePanels: [],
    })

    expect(proposal).toEqual({
      requiresConfirmation: true,
      changes: [
        { row: 'wall', index: 0, variantId: ids.wall600, startMm: 0 },
        { row: 'wall', index: 1, variantId: ids.wall500, startMm: 600 },
      ],
    })
  })
})
