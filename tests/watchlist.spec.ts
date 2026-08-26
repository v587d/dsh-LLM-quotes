import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ModelInfo } from '../src/types.ts'
import {
  appendPriceSnapshot,
  getPriceChange,
  getPriceChanges,
  getWatchlist,
  getWatchlistEntry,
  removeWatchlist,
  snapshotActiveRecords,
  updateWatchlistStatus,
  upsertWatchlist,
  watchlistFilePath,
} from '../src/server/watchlist.ts'

let dir: string
let oldHome: string | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'llm-quotes-watchlist-'))
  oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = dir
})

afterEach(() => {
  if (oldHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = oldHome
  rmSync(dir, { recursive: true, force: true })
})

function makeModel(slug: string, input: number, output: number): ModelInfo {
  return {
    id: 1,
    sid: slug,
    name: slug,
    slug,
    provider: { name: 'Test', slug: 'test' },
    modalities: ['text'],
    price: { inputPricePerMillion: input, outputPricePerMillion: output, priceUnit: 'USD' },
    prices: [{ inputPricePerMillion: input, outputPricePerMillion: output, priceUnit: 'USD' }],
  }
}

describe('watchlistFilePath', () => {
  it('resolves inside $DSH_HOME with a plugin-prefixed name (no collisions)', () => {
    expect(watchlistFilePath()).toBe(join(dir, 'llm-quotes-watchlist.jsonl'))
  })
})

describe('upsertWatchlist', () => {
  it('creates a record with one initial price snapshot', async () => {
    const record = await upsertWatchlist(makeModel('m1', 1, 2), 'test')
    expect(record.key).toBe('test:m1')
    expect(record.status).toBe('active')
    expect(record.priceHistory).toHaveLength(1)
    expect(record.priceHistory[0]?.prices.inputPricePerMillion).toBe(1)
  })

  it('does not duplicate the last snapshot when prices are unchanged', async () => {
    await upsertWatchlist(makeModel('m1', 1, 2), 'test')
    const again = await upsertWatchlist(makeModel('m1', 1, 2), 'test')
    expect(again.priceHistory).toHaveLength(1)
  })

  it('appends a snapshot when prices changed (e.g. re-follow after an update)', async () => {
    await upsertWatchlist(makeModel('m1', 1, 2), 'test')
    const changed = await upsertWatchlist(makeModel('m1', 5, 6), 'test')
    expect(changed.priceHistory).toHaveLength(2)
    expect(changed.priceHistory[1]?.prices.inputPricePerMillion).toBe(5)
  })

  it('re-activating a paused record keeps addedAt and history', async () => {
    const first = await upsertWatchlist(makeModel('m1', 1, 2), 'test')
    await updateWatchlistStatus('test:m1', 'paused')
    const reactivated = await upsertWatchlist(makeModel('m1', 1, 2), 'test')
    expect(reactivated.status).toBe('active')
    expect(reactivated.addedAt).toBe(first.addedAt)
    expect(reactivated.priceHistory).toHaveLength(1) // unchanged prices → no dup
  })
})

describe('status lifecycle', () => {
  it('pause keeps the record and history (unfollow must not delete)', async () => {
    await upsertWatchlist(makeModel('m1', 1, 2), 'test')
    const paused = await updateWatchlistStatus('test:m1', 'paused')
    expect(paused?.status).toBe('paused')
    expect(paused?.priceHistory).toHaveLength(1)
    expect(await getWatchlistEntry('test:m1')).not.toBeNull()
  })

  it('updating a missing key returns null', async () => {
    expect(await updateWatchlistStatus('nope:m1', 'paused')).toBeNull()
  })
})

describe('removeWatchlist', () => {
  it('permanently removes the record', async () => {
    await upsertWatchlist(makeModel('m1', 1, 2), 'test')
    expect(await removeWatchlist('test:m1')).toBe(true)
    expect(await getWatchlistEntry('test:m1')).toBeNull()
  })

  it('returns false for a missing key', async () => {
    expect(await removeWatchlist('nope:m1')).toBe(false)
  })
})

describe('appendPriceSnapshot', () => {
  it('appends only when prices differ from the last snapshot', async () => {
    await upsertWatchlist(makeModel('m1', 1, 2), 'test')
    const same = await appendPriceSnapshot('test:m1', { inputPricePerMillion: 1, outputPricePerMillion: 2 })
    expect(same?.priceHistory).toHaveLength(1)
    const changed = await appendPriceSnapshot('test:m1', { inputPricePerMillion: 9, outputPricePerMillion: 2 })
    expect(changed?.priceHistory).toHaveLength(2)
  })

  it('returns null for a missing key', async () => {
    expect(await appendPriceSnapshot('nope:m1', { inputPricePerMillion: 1 })).toBeNull()
  })
})

describe('snapshotActiveRecords', () => {
  it('snapshots active records only and dedupes unchanged prices', async () => {
    await upsertWatchlist(makeModel('m1', 1, 2), 'test') // active
    await upsertWatchlist(makeModel('m2', 3, 4), 'test') // active
    await upsertWatchlist(makeModel('m3', 5, 6), 'test') // will be paused
    await updateWatchlistStatus('test:m3', 'paused')

    const models = [makeModel('m1', 1, 2), makeModel('m2', 3, 4), makeModel('m3', 5, 6)]
    const appended = await snapshotActiveRecords(models)
    expect(appended).toBe(0) // nothing changed yet

    const newer = [makeModel('m1', 1, 2), makeModel('m2', 30, 40), makeModel('m3', 5, 6)]
    const appended2 = await snapshotActiveRecords(newer)
    expect(appended2).toBe(1) // only m2 (active + changed); m3 is paused

    const m2 = await getWatchlistEntry('test:m2')
    expect(m2?.priceHistory).toHaveLength(2)
    expect(m2?.priceHistory[1]?.prices.inputPricePerMillion).toBe(30)
    const m3 = await getWatchlistEntry('test:m3')
    expect(m3?.priceHistory).toHaveLength(1)
  })
})

describe('getPriceChange', () => {
  it('reports changes between first and last snapshot', async () => {
    await upsertWatchlist(makeModel('m1', 1, 2), 'test')
    await appendPriceSnapshot('test:m1', { inputPricePerMillion: 4, outputPricePerMillion: 2 })
    const result = await getPriceChange('test:m1')
    expect(result).not.toBeNull()
    expect(result?.changes.inputPricePerMillion).toEqual({ old: 1, new: 4 })
    expect(result?.changes.outputPricePerMillion).toEqual({ old: 2, new: 2 })
    expect(result?.currencyChanged).toBe(false)
  })

  it('returns null for a missing key or empty history', async () => {
    expect(await getPriceChange('nope:m1')).toBeNull()
  })

  it('flags a currency change and still reports raw values', async () => {
    await upsertWatchlist(makeModel('m1', 1, 2), 'test') // USD
    await appendPriceSnapshot('test:m1', { inputPricePerMillion: 7, outputPricePerMillion: 8, priceUnit: 'CNY' })
    const result = await getPriceChange('test:m1')
    expect(result?.currencyChanged).toBe(true)
    expect(result?.from?.currency).toBe('USD')
    expect(result?.to?.currency).toBe('CNY')
  })

  it('treats a disappeared price as null on the new side (never a zero)', async () => {
    await upsertWatchlist(makeModel('m1', 1, 2), 'test')
    await appendPriceSnapshot('test:m1', { outputPricePerMillion: 2 }) // input price removed
    const result = await getPriceChange('test:m1')
    expect(result?.changes.inputPricePerMillion).toEqual({ old: 1, new: null })
  })
})

describe('getPriceChanges', () => {
  it('returns first/last comparisons for existing keys and omits missing ones', async () => {
    await upsertWatchlist(makeModel('m1', 1, 2), 'test')
    await appendPriceSnapshot('test:m1', { inputPricePerMillion: 5, outputPricePerMillion: 2 })
    await upsertWatchlist(makeModel('m2', 3, 4), 'test') // single snapshot

    const changes = await getPriceChanges(['test:m1', 'test:m2', 'nope:x'])
    expect(Object.keys(changes).sort()).toEqual(['test:m1', 'test:m2'])
    expect(changes['test:m1']?.changes.inputPricePerMillion).toEqual({ old: 1, new: 5 })
    expect(changes['test:m2']?.changes.outputPricePerMillion).toEqual({ old: 4, new: 4 })
    expect(changes['nope:x']).toBeUndefined()
  })
})

describe('snapshot field whitelist', () => {
  it('only snapshots PRICE_FIELDS (token tiers etc. never leak in)', async () => {
    const model = makeModel('m1', 1, 2)
    const record = await upsertWatchlist({
      ...model,
      price: { inputPricePerMillion: 1, outputPricePerMillion: 2, priceUnit: 'USD', tokenTierMin: 1000, tokenTierMax: 100000 },
      prices: [{ inputPricePerMillion: 1, outputPricePerMillion: 2, priceUnit: 'USD', tokenTierMin: 1000, tokenTierMax: 100000 }],
    }, 'test')
    expect(record.priceHistory[0]?.prices).toEqual({
      inputPricePerMillion: 1,
      outputPricePerMillion: 2,
    })
  })
})

describe('file resilience', () => {
  it('skips a corrupt line instead of failing the whole read', async () => {
    await upsertWatchlist(makeModel('m1', 1, 2), 'test')
    const path = watchlistFilePath()
    const content = readFileSync(path, 'utf-8')
    writeFileSync(path, `{corrupt-line\n${content}`, 'utf-8')
    const records = await getWatchlist()
    expect(records).toHaveLength(1)
    expect(records[0]?.key).toBe('test:m1')
  })

  it('serializes concurrent read-modify-write cycles (no lost updates)', async () => {
    const writes = Array.from({ length: 20 }, (_, i) =>
      upsertWatchlist(makeModel(`m${i}`, i, i + 1), 'test'))
    await Promise.all(writes)
    const records = await getWatchlist()
    expect(records).toHaveLength(20)
    for (let i = 0; i < 20; i++) {
      expect(await getWatchlistEntry(`test:m${i}`)).not.toBeNull()
    }
  })
})
