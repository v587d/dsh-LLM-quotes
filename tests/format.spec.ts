import { describe, expect, it } from 'vitest'
import {
  currencySymbol,
  formatPrice,
  pickDisplayPrice,
  priceUnitPriority,
} from '../src/client/format.ts'
import type { PriceInfo } from '../src/types.ts'

function price(unit: string | null | undefined, input: number | null = null, output: number | null = null): PriceInfo {
  return {
    inputPricePerMillion: input,
    outputPricePerMillion: output,
    priceUnit: unit,
  }
}

describe('currencySymbol', () => {
  it('maps known codes to symbols and falls back to the code', () => {
    expect(currencySymbol('USD')).toBe('$')
    expect(currencySymbol('CNY')).toBe('¥')
    expect(currencySymbol('EUR')).toBe('€')
    expect(currencySymbol('XYZ')).toBe('XYZ ')
  })

  it('defaults to USD when no unit is present', () => {
    expect(currencySymbol(null)).toBe('$')
    expect(currencySymbol(undefined)).toBe('$')
    expect(currencySymbol('')).toBe('$')
  })
})

describe('formatPrice', () => {
  it('uses the row currency instead of a hardcoded $', () => {
    expect(formatPrice(1.5, 'CNY')).toBe('¥1.5')
    expect(formatPrice(0.44, 'USD')).toBe('$0.44')
    expect(formatPrice(3, 'CNY')).toBe('¥3')
    expect(formatPrice(0, 'CNY')).toBe('¥0')
    expect(formatPrice(null, 'CNY')).toBe('—')
    expect(formatPrice(1.5)).toBe('$1.5')
  })
})

describe('priceUnitPriority', () => {
  it('orders CNY first, then USD, then others', () => {
    expect(priceUnitPriority('CNY')).toBeLessThan(priceUnitPriority('USD'))
    expect(priceUnitPriority('USD')).toBeLessThan(priceUnitPriority('EUR'))
    expect(priceUnitPriority(null)).toBeLessThan(priceUnitPriority('EUR'))
    expect(priceUnitPriority('CNH')).toBe(priceUnitPriority('CNY'))
  })
})

describe('pickDisplayPrice', () => {
  it('prefers CNY, then USD, then other currencies', () => {
    expect(pickDisplayPrice([price('USD', 1, 2), price('CNY', 3, 4)])?.priceUnit).toBe('CNY')
    expect(pickDisplayPrice([price('EUR', 1, 2), price('USD', 3, 4)])?.priceUnit).toBe('USD')
    expect(pickDisplayPrice([price('EUR', 1, 2), price('GBP', 3, 4)])?.priceUnit).toBe('EUR')
  })

  it('skips rows without token prices when a token-priced row exists', () => {
    const rows = [price('CNY', null, null), price('USD', 1, 2)]
    expect(pickDisplayPrice(rows)?.priceUnit).toBe('USD')
  })

  it('keeps dataset order within the same priority (stable)', () => {
    const rows = [price('USD', 1, 2), price('USD', 3, 4)]
    expect(pickDisplayPrice(rows)).toBe(rows[0])
  })

  it('returns undefined for empty input', () => {
    expect(pickDisplayPrice([])).toBeUndefined()
    expect(pickDisplayPrice(undefined)).toBeUndefined()
  })
})