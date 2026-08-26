import { describe, expect, it } from 'vitest'
import type { PriceChangeResult } from '../src/types.ts'
import { priceSignalOf } from '../src/client/signals.ts'

const labelOf = (field: string): string => field.toUpperCase()

function result(changes: Record<string, { old: number | null; new: number | null }>, extra?: Partial<PriceChangeResult>): PriceChangeResult {
  return {
    from: { time: '2026-08-01T00:00:00.000Z', currency: 'USD', prices: {} },
    to: { time: '2026-08-26T00:00:00.000Z', currency: 'USD', prices: {} },
    changes,
    ...extra,
  }
}

describe('priceSignalOf', () => {
  it('is up when any price rose', () => {
    const signal = priceSignalOf(result({
      inputPricePerMillion: { old: 1.5, new: 2 },
      outputPricePerMillion: { old: 4.5, new: 4.5 }, // unchanged → dropped
    }), labelOf)
    expect(signal.direction).toBe('up')
    expect(signal.fields).toHaveLength(1)
    expect(signal.fields[0]).toEqual({ label: 'INPUTPRICEPERMILLION', old: 1.5, new: 2 })
  })

  it('is down when any price fell (and up wins over down)', () => {
    expect(priceSignalOf(result({ outputPricePerMillion: { old: 5, new: 4 } }), labelOf).direction).toBe('down')
    expect(priceSignalOf(result({
      inputPricePerMillion: { old: 1, new: 2 }, // up
      outputPricePerMillion: { old: 5, new: 4 }, // down
    }), labelOf).direction).toBe('up')
  })

  it('is none when nothing changed', () => {
    const signal = priceSignalOf(result({
      inputPricePerMillion: { old: 1.5, new: 1.5 },
    }), labelOf)
    expect(signal.direction).toBe('none')
    expect(signal.fields).toHaveLength(0)
  })

  it('counts an appearing price as up and a disappearing one as down', () => {
    expect(priceSignalOf(result({ audioPricePerHour: { old: null, new: 2 } }), labelOf).direction).toBe('up')
    expect(priceSignalOf(result({ audioPricePerHour: { old: 2, new: null } }), labelOf).direction).toBe('down')
  })

  it('never derives a direction across a currency change', () => {
    const signal = priceSignalOf(result(
      { inputPricePerMillion: { old: 1, new: 2 } },
      { currencyChanged: true, from: { time: 't', currency: 'USD', prices: {} }, to: { time: 't2', currency: 'CNY', prices: {} } },
    ), labelOf)
    expect(signal.direction).toBe('none')
    expect(signal.currencyChanged).toBe(true)
    expect(signal.currency).toBe('CNY')
  })

  it('keeps the from/to times for the tooltip range', () => {
    const signal = priceSignalOf(result({ inputPricePerMillion: { old: 1, new: 2 } }), labelOf)
    expect(signal.fromTime).toBe('2026-08-01T00:00:00.000Z')
    expect(signal.toTime).toBe('2026-08-26T00:00:00.000Z')
  })
})
