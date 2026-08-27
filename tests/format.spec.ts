import { describe, expect, it } from 'vitest'
import {
  canonCurrency,
  chooseComparePrice,
  convertCurrency,
  currencySymbol,
  formatPrice,
  isDiscountedPrice,
  pickDisplayPrice,
  priceTierKey,
  priceTierLabel,
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

describe('canonCurrency', () => {
  it('normalizes codes and aliases CNH → CNY, unknown → null', () => {
    expect(canonCurrency('USD')).toBe('USD')
    expect(canonCurrency('cnh')).toBe('CNY')
    expect(canonCurrency(null)).toBeNull()
    expect(canonCurrency('')).toBeNull()
  })
})

describe('convertCurrency', () => {
  const rates = { USD: 1, CNY: 7.25, EUR: 0.92 }

  it('converts between currencies using USD-based rates', () => {
    // 5 USD → CNY
    expect(convertCurrency(5, 'USD', 'CNY', rates)).toBeCloseTo(36.25)
    // 7.25 CNY → USD
    expect(convertCurrency(7.25, 'CNY', 'USD', rates)).toBeCloseTo(1)
    // 1 USD → EUR
    expect(convertCurrency(1, 'USD', 'EUR', rates)).toBeCloseTo(0.92)
  })

  it('returns the value unchanged for the same currency', () => {
    expect(convertCurrency(5, 'USD', 'USD', rates)).toBe(5)
  })

  it('treats CNH as CNY for conversion', () => {
    expect(convertCurrency(7.25, 'CNH', 'USD', rates)).toBeCloseTo(1)
  })

  it('returns null when either unit is unknown or a rate is missing', () => {
    expect(convertCurrency(5, 'USD', 'XYZ', rates)).toBeNull()
    expect(convertCurrency(5, 'USD', null, rates)).toBeNull()
    expect(convertCurrency(5, null, 'USD', rates)).toBeNull()
  })
})

describe('priceTierKey', () => {
  it('combines tierLabel and processingTier, lowercased', () => {
    expect(priceTierKey({ tierLabel: 'Off-peak' })).toBe('off-peak')
    expect(priceTierKey({ tierLabel: 'Standard', processingTier: 'Peak' })).toBe('standard|peak')
    expect(priceTierKey({})).toBe('')
  })
})

describe('isDiscountedPrice', () => {
  it('flags off-peak / discount / promo rows, not standard rows', () => {
    expect(isDiscountedPrice({ tierLabel: 'Off-peak' })).toBe(true)
    expect(isDiscountedPrice({ processingTier: 'offpeak' })).toBe(true)
    expect(isDiscountedPrice({ tierLabel: 'Standard' })).toBe(false)
    expect(isDiscountedPrice({})).toBe(false)
  })
})

describe('chooseComparePrice', () => {
  it('prefers the standard row over an off-peak row', () => {
    const model = {
      price: { inputPricePerMillion: 2, priceUnit: 'CNY', tierLabel: 'Off-peak' },
      prices: [
        { inputPricePerMillion: 2, priceUnit: 'CNY', tierLabel: 'Off-peak' },
        { inputPricePerMillion: 4, priceUnit: 'CNY', tierLabel: 'Standard' },
      ],
    }
    expect(chooseComparePrice(model).tierLabel).toBe('Standard')
  })

  it('keeps the off-peak row when it is the only priced row', () => {
    const model = {
      price: { inputPricePerMillion: 2, priceUnit: 'CNY', tierLabel: 'Off-peak' },
      prices: [{ inputPricePerMillion: 2, priceUnit: 'CNY', tierLabel: 'Off-peak' }],
    }
    expect(chooseComparePrice(model).tierLabel).toBe('Off-peak')
  })
})