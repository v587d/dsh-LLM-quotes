import { describe, expect, it } from 'vitest'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelInfo } from '../src/types.ts'
import { compareFields, NA } from '../src/client/compareFields.tsx'
import { convertCurrency } from '../src/client/format.ts'
import { NS } from '../src/client/locales.ts'

// A key-echoing translate: the built rows only need the labels to be stable
// identifiers, so returning the key itself is enough for these assertions.
const t = ((key: string) => key) as unknown as TranslateNS<typeof NS>

function makeModel(partial: Partial<ModelInfo> & { providerSlug: string }): ModelInfo {
  return {
    id: 1,
    sid: partial.slug!,
    name: partial.slug!,
    slug: partial.slug!,
    provider: { name: partial.providerSlug, slug: partial.providerSlug },
    modalities: [],
    price: { priceUnit: 'USD' },
    prices: [{ priceUnit: 'USD' }],
    ...partial,
  } as ModelInfo
}

describe('compareFields', () => {
  it('frames rows on the target model field set only', () => {
    const target = makeModel({
      slug: 'gpt-4o',
      providerSlug: 'openai',
      contextWindow: 128000,
      maxOutput: 16384,
      supportsTools: true,
      modalities: ['text', 'image'],
      price: { inputPricePerMillion: 5, outputPricePerMillion: 15, priceUnit: 'USD' },
      prices: [{ inputPricePerMillion: 5, outputPricePerMillion: 15, priceUnit: 'USD' }],
    })
    const fields = compareFields(target, t)
    const keys = fields.map((field) => field.key)

    // Model + price fields the target values are rows.
    expect(keys).toContain('contextWindow')
    expect(keys).toContain('maxOutput')
    expect(keys).toContain('modalities')
    expect(keys).toContain('input')
    expect(keys).toContain('output')

    // A price field the target does NOT carry must not become a row.
    expect(keys).not.toContain('imagePrice')
    expect(keys).not.toContain('videoPrice')
  })

  it('a comparison model without a target field shows the NA placeholder', () => {
    const target = makeModel({
      slug: 'gpt-4o',
      providerSlug: 'openai',
      contextWindow: 128000,
      maxOutput: 16384,
      price: { inputPricePerMillion: 5, outputPricePerMillion: 15, priceUnit: 'USD' },
      prices: [{ inputPricePerMillion: 5, outputPricePerMillion: 15, priceUnit: 'USD' }],
    })
    const other = makeModel({
      slug: 'gpt-4o',
      providerSlug: 'azure',
      contextWindow: 100000,
      maxOutput: null,
      price: { inputPricePerMillion: 6, outputPricePerMillion: 18, priceUnit: 'USD' },
      prices: [{ inputPricePerMillion: 6, outputPricePerMillion: 18, priceUnit: 'USD' }],
    })
    const fields = compareFields(target, t)

    const context = fields.find((field) => field.key === 'contextWindow')!
    expect(context.render(other)).toBe('100K')
    // The comparison model lacks maxOutput → NA, not `0` or an empty string.
    const maxOut = fields.find((field) => field.key === 'maxOutput')!
    expect(maxOut.render(other)).toBe(NA)
    // Price cells use each model's own display price.
    const input = fields.find((field) => field.key === 'input')!
    expect(input.render(target)).toBe('$5')
    expect(input.render(other)).toBe('$6')
  })

  it('does not add a row for a field only the comparison model carries', () => {
    const target = makeModel({
      slug: 'gpt-4o',
      providerSlug: 'openai',
      price: { inputPricePerMillion: 5, outputPricePerMillion: 15, priceUnit: 'USD' },
      prices: [{ inputPricePerMillion: 5, outputPricePerMillion: 15, priceUnit: 'USD' }],
    })
    const other = makeModel({
      slug: 'gpt-4o',
      providerSlug: 'azure',
      price: {
        inputPricePerMillion: 6,
        outputPricePerMillion: 18,
        imagePrice: 0.01,
        priceUnit: 'USD',
      },
      prices: [{
        inputPricePerMillion: 6,
        outputPricePerMillion: 18,
        imagePrice: 0.01,
        priceUnit: 'USD',
      }],
    })
    // The comparison model has a value the target lacks; the table must not add it.
    const fields = compareFields(target, t)
    expect(fields.map((field) => field.key)).not.toContain('imagePrice')
  })

  it('boolean support flags always render a check/cross, never NA', () => {
    const target = makeModel({
      slug: 'gpt-4o',
      providerSlug: 'openai',
      supportsTools: true,
    })
    const other = makeModel({
      slug: 'gpt-4o',
      providerSlug: 'azure',
      supportsTools: false,
    })
    const fields = compareFields(target, t)
    const tools = fields.find((field) => field.key === 'supportsTools')!
    const targetCell = tools.render(target) as { type: string; props: { children: string } }
    const otherCell = tools.render(other) as { type: string; props: { children: string } }
    expect(targetCell.type).toBe('span')
    expect(targetCell.props.children).toBe('✓')
    expect(otherCell.props.children).toBe('✗')
  })
})

describe('compareFields options (currency normalization)', () => {
  const rates = { USD: 1, CNY: 7.25 }
  const options = {
    baseUnit: 'USD',
    convert: (value: number, from: string | null | undefined) => convertCurrency(value, from, 'USD', rates),
  }

  it('converts price cells to the base currency via the convert callback', () => {
    const target = makeModel({
      slug: 'gpt-4o',
      providerSlug: 'openai',
      price: { inputPricePerMillion: 5, outputPricePerMillion: 15, priceUnit: 'USD' },
      prices: [{ inputPricePerMillion: 5, outputPricePerMillion: 15, priceUnit: 'USD' }],
    })
    const other = makeModel({
      slug: 'gpt-4o',
      providerSlug: 'azure',
      price: { inputPricePerMillion: 72.5, outputPricePerMillion: 145, priceUnit: 'CNY' },
      prices: [{ inputPricePerMillion: 72.5, outputPricePerMillion: 145, priceUnit: 'CNY' }],
    })
    const fields = compareFields(target, t, options)
    const input = fields.find((field) => field.key === 'input')!
    // 72.5 CNY → $10 (baseUnit USD); target stays $5.
    expect(input.render(other)).toBe('$10')
    expect(input.numeric!(other)).toBeCloseTo(10)
    expect(input.numeric!(target)).toBe(5)
    // Price fields favor the lowest value.
    expect(input.direction).toBe('min')
  })

  it('exposes a max direction for capacity fields', () => {
    const target = makeModel({ slug: 'gpt-4o', providerSlug: 'openai', contextWindow: 128000 })
    const fields = compareFields(target, t, options)
    const context = fields.find((field) => field.key === 'contextWindow')!
    expect(context.direction).toBe('max')
    expect(context.numeric!(target)).toBe(128000)
  })

  it('falls back to the native value when conversion is unavailable', () => {
    const target = makeModel({
      slug: 'gpt-4o',
      providerSlug: 'openai',
      price: { inputPricePerMillion: 5, outputPricePerMillion: 15, priceUnit: 'USD' },
      prices: [{ inputPricePerMillion: 5, outputPricePerMillion: 15, priceUnit: 'USD' }],
    })
    const other = makeModel({
      slug: 'gpt-4o',
      providerSlug: 'azure',
      price: { inputPricePerMillion: 50, outputPricePerMillion: 150, priceUnit: 'XYZ' },
      prices: [{ inputPricePerMillion: 50, outputPricePerMillion: 150, priceUnit: 'XYZ' }],
    })
    // Unknown unit → convert returns null → native symbol + symbol.
    const fields = compareFields(target, t, options)
    const input = fields.find((field) => field.key === 'input')!
    expect(input.render(other)).toBe('XYZ 50')
    expect(input.numeric!(other)).toBe(50)
  })
})

describe('compareFields tier standardization', () => {
  it('compares on the standard (peak) row when the target also has off-peak', () => {
    const target = makeModel({
      slug: 'deepseek-v4',
      providerSlug: 'deepseek',
      price: { inputPricePerMillion: 1, outputPricePerMillion: 2, priceUnit: 'CNY', tierLabel: 'Off-peak' },
      prices: [
        { inputPricePerMillion: 1, outputPricePerMillion: 2, priceUnit: 'CNY', tierLabel: 'Off-peak' },
        { inputPricePerMillion: 2, outputPricePerMillion: 4, priceUnit: 'CNY', tierLabel: 'Standard' },
      ],
    })
    const fields = compareFields(target, t)
    const input = fields.find((field) => field.key === 'input')!
    // The primary row is off-peak (¥1), but the compare standardizes to standard (¥2).
    expect(input.render(target)).toBe('¥2')
  })
})
