import type { PublicPriceMode } from '@seriya/contracts'

export type PriceableVariant = {
  mode: PublicPriceMode
  bodyM2: number
  facadeM2: number
  hdfM2: number
  fastenerChargeRub: number
}

export type ActiveMaterialRates = {
  bodyRatesRubM2: number[]
  facadeRatesRubM2: number[]
  hdfRatesRubM2: number[]
  multiplier: number
  roundingRub: number
}

export function roundRub(value: number, increment: number) {
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(increment) || increment <= 0) {
    throw new Error('Invalid price rounding input')
  }
  return Math.round((value + Number.EPSILON) / increment) * increment
}

export function calculatePublicPriceRange(
  item: PriceableVariant,
  rates: ActiveMaterialRates,
): { minRub: number; maxRub: number } {
  const body = extrema(rates.bodyRatesRubM2, item.bodyM2)
  const facade = extrema(rates.facadeRatesRubM2, item.facadeM2)
  const hdf = extrema(rates.hdfRatesRubM2, item.hdfM2)

  let min = item.fastenerChargeRub
  let max = item.fastenerChargeRub
  if (item.mode === 'ordinary') {
    min += body.min + hdf.min
    max += body.max + hdf.max
  } else if (item.mode === 'false_panel') {
    min += facade.min
    max += facade.max
  } else {
    min += body.min + facade.min + hdf.min
    max += body.max + facade.max + hdf.max
  }

  const result = {
    minRub: roundRub(min * rates.multiplier, rates.roundingRub),
    maxRub: roundRub(max * rates.multiplier, rates.roundingRub),
  }
  if (result.maxRub === 0) throw new Error('Public price must not be zero')
  return result
}

function extrema(values: number[], quantity: number) {
  if (quantity === 0) return { min: 0, max: 0 }
  if (values.length === 0) throw new Error('Missing active material rate')
  for (const value of values) {
    if (!Number.isFinite(value) || value < 0) throw new Error('Invalid material rate')
  }
  return {
    min: Math.min(...values) * quantity,
    max: Math.max(...values) * quantity,
  }
}
