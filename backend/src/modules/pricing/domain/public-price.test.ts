import { describe, expect, test } from 'bun:test'

import { calculatePublicPriceRange, roundRub } from './public-price'

const rates = {
  bodyRatesRubM2: [2050],
  facadeRatesRubM2: [2225, 3000],
  hdfRatesRubM2: [600],
  multiplier: 1.1,
  roundingRub: 10,
}

describe('public launch prices', () => {
  test('rounds half up to ten roubles', () => {
    expect(roundRub(1004.99, 10)).toBe(1000)
    expect(roundRub(1005, 10)).toBe(1010)
  })

  test('ordinary modules include body, HDF, and fixed fasteners only', () => {
    expect(calculatePublicPriceRange({
      mode: 'ordinary', bodyM2: 2, facadeM2: 1, hdfM2: 0.5, fastenerChargeRub: 100,
    }, rates)).toEqual({ minRub: 4950, maxRub: 4950 })
  })

  test('false panels use the active facade rate range', () => {
    expect(calculatePublicPriceRange({
      mode: 'false_panel', bodyM2: 0, facadeM2: 1, hdfM2: 0, fastenerChargeRub: 0,
    }, rates)).toEqual({ minRub: 2450, maxRub: 3300 })
  })

  test('trim pieces price every non-zero consumption for one whole piece', () => {
    expect(calculatePublicPriceRange({
      mode: 'trim_piece', bodyM2: 0.27, facadeM2: 0.27, hdfM2: 0.1, fastenerChargeRub: 6,
    }, rates)).toEqual({ minRub: 1340, maxRub: 1570 })
  })

  test('refuses an unpriceable public item', () => {
    expect(() => calculatePublicPriceRange({
      mode: 'ordinary', bodyM2: 0, facadeM2: 0, hdfM2: 0, fastenerChargeRub: 0,
    }, rates)).toThrow('zero')
  })
})
