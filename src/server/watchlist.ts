/**
 * Watchlist JSONL persistence for dsh-llm-quotes.
 *
 * Stores watched models with their price history in a JSONL file
 * (`<dshHome>/llm-quotes-watchlist.jsonl`). Each line is a JSON object
 * representing one watched model with its complete price history. The file
 * name carries the plugin prefix so no other plugin can collide with it.
 *
 * Design principles:
 * - Price snapshots only carry the explicit `PRICE_FIELDS` whitelist from
 *   types.ts (the exact numeric fields of the PriceInfo contract), so a new
 *   numeric dataset field can never leak into a snapshot or comparison
 *   without an intentional contract change.
 * - Each price snapshot is a complete record of all prices at that time.
 * - Records are kept on unfollow: the client marks them `paused` instead of
 *   deleting them, so history survives and price trends can be computed.
 * - All read-modify-write cycles are serialized through an in-process lock,
 *   and writes are atomic (tmp file + rename), so concurrent toggles cannot
 *   corrupt or lose the file.
 * - Snapshot appends are deduplicated against the last snapshot, and the
 *   host snapshots all active records after each dataset refresh, so the
 *   history only grows when prices actually change.
 * - Price change comparison only compares snapshots in the same currency;
 *   a currency change between snapshots is reported as such and never
 *   compared numerically.
 *
 * @module dsh-llm-quotes/server/watchlist
 */

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { dshHome } from '../config.ts'
import { PRICE_FIELDS } from '../types.ts'
import type { ModelInfo, PriceChangeResult, PriceInfo, PriceSnapshot, WatchlistRecord, WatchlistStatus } from '../types.ts'

/** Resolve the watchlist file path (honours `$DSH_HOME`, like config.ts). */
export function watchlistFilePath(): string {
  return join(dshHome(), 'llm-quotes-watchlist.jsonl')
}

/**
 * Extract the numeric price fields of a PriceInfo object — the explicit
 * `PRICE_FIELDS` whitelist only (fields with finite numbers).
 */
function extractAllPrices(price: PriceInfo): Record<string, number> {
  const result: Record<string, number> = {}
  for (const key of PRICE_FIELDS) {
    const value = price[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      result[key] = value
    }
  }
  return result
}

/** Create a complete price snapshot from a PriceInfo (empty-safe). */
function createSnapshot(price: PriceInfo | undefined): PriceSnapshot {
  return {
    time: new Date().toISOString(),
    currency: price?.priceUnit ?? 'USD',
    prices: price === undefined ? {} : extractAllPrices(price),
  }
}

/** True when two snapshots carry identical currency + prices (time ignored). */
function snapshotsEqual(a: PriceSnapshot | undefined, b: PriceSnapshot): boolean {
  if (a === undefined) return false
  if (a.currency !== b.currency) return false
  const keys = new Set([...Object.keys(a.prices), ...Object.keys(b.prices)])
  for (const key of keys) {
    if ((a.prices[key] ?? null) !== (b.prices[key] ?? null)) return false
  }
  return true
}

/**
 * Serialize all read-modify-write cycles: two concurrent toggles would
 * otherwise interleave read/compare/write and lose an update.
 */
let lock: Promise<void> = Promise.resolve()
async function withLock<T>(run: () => Promise<T>): Promise<T> {
  const previous = lock
  let release!: () => void
  lock = new Promise<void>((resolve) => { release = resolve })
  await previous
  try {
    return await run()
  } finally {
    release()
  }
}

/** Read all records from the JSONL file. Corrupt lines are skipped. */
async function readRecords(): Promise<WatchlistRecord[]> {
  try {
    const content = await readFile(watchlistFilePath(), 'utf-8')
    const lines = content.split('\n').filter((line) => line.trim().length > 0)
    const records: WatchlistRecord[] = []
    for (const line of lines) {
      try {
        records.push(JSON.parse(line) as WatchlistRecord)
      } catch {
        // Skip one corrupt line; keep the rest of the file readable.
      }
    }
    return records
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

/** Atomically replace the JSONL file (tmp + rename). */
async function writeRecords(records: readonly WatchlistRecord[]): Promise<void> {
  const path = watchlistFilePath()
  await mkdir(dirname(path), { recursive: true })
  const content = records.map((r) => JSON.stringify(r)).join('\n') + '\n'
  const tmp = `${path}.tmp`
  await writeFile(tmp, content, 'utf-8')
  await rename(tmp, path)
}

/** Get all watched models. */
export async function getWatchlist(): Promise<readonly WatchlistRecord[]> {
  return readRecords()
}

/** Get one watched model by key. */
export async function getWatchlistEntry(key: string): Promise<WatchlistRecord | null> {
  const records = await readRecords()
  return records.find((r) => r.key === key) ?? null
}

/** Add or update a watched model (follow). */
export async function upsertWatchlist(
  model: ModelInfo,
  providerSlug: string,
  status: WatchlistStatus = 'active',
): Promise<WatchlistRecord> {
  return withLock(async () => {
    const key = `${providerSlug}:${model.slug}`
    const records = await readRecords()
    const existing = records.find((r) => r.key === key)

    const now = new Date().toISOString()
    const primaryPrice = model.prices[0] ?? model.price
    const snapshot = createSnapshot(primaryPrice)

    // Append only when the prices actually changed since the last snapshot
    // (re-following with unchanged data must not duplicate history).
    const priceHistory = existing ? [...existing.priceHistory] : []
    if (!snapshotsEqual(priceHistory[priceHistory.length - 1], snapshot)) {
      priceHistory.push(snapshot)
    }

    const record: WatchlistRecord = {
      key,
      provider: providerSlug,
      model: model.slug,
      modelName: model.name,
      modalities: [...model.modalities],
      status,
      addedAt: existing?.addedAt ?? now,
      updatedAt: now,
      priceHistory,
    }

    // Replace existing or append.
    const next = existing
      ? records.map((r) => (r.key === key ? record : r))
      : [...records, record]

    await writeRecords(next)
    return record
  })
}

/**
 * Remove a watched model permanently.
 * Use this only when the record should be completely deleted.
 * For unfollow, the client marks the record `paused` instead, so its
 * price history survives.
 */
export async function removeWatchlist(key: string): Promise<boolean> {
  return withLock(async () => {
    const records = await readRecords()
    const next = records.filter((r) => r.key !== key)
    if (next.length === records.length) return false
    await writeRecords(next)
    return true
  })
}

/** Update the status of a watched model. */
export async function updateWatchlistStatus(
  key: string,
  status: WatchlistStatus,
): Promise<WatchlistRecord | null> {
  return withLock(async () => {
    const records = await readRecords()
    const index = records.findIndex((r) => r.key === key)
    if (index === -1) return null
    const updated: WatchlistRecord = {
      ...records[index],
      status,
      updatedAt: new Date().toISOString(),
    }
    records[index] = updated
    await writeRecords(records)
    return updated
  })
}

/** Append a new price snapshot to an existing watched model (deduped). */
export async function appendPriceSnapshot(
  key: string,
  price: PriceInfo,
): Promise<WatchlistRecord | null> {
  return withLock(async () => {
    const records = await readRecords()
    const index = records.findIndex((r) => r.key === key)
    if (index === -1) return null

    const existing = records[index]
    const snapshot = createSnapshot(price)
    if (snapshotsEqual(existing.priceHistory[existing.priceHistory.length - 1], snapshot)) {
      return existing
    }

    const updated: WatchlistRecord = {
      ...existing,
      updatedAt: new Date().toISOString(),
      priceHistory: [...existing.priceHistory, snapshot],
    }

    records[index] = updated
    await writeRecords(records)
    return updated
  })
}

/**
 * Snapshot current prices for every `active` record from a fresh dataset.
 * Called after each dataset refresh (at most once per day), so history grows
 * only when the dataset actually changed. Returns how many records gained a
 * snapshot.
 */
export async function snapshotActiveRecords(models: readonly ModelInfo[]): Promise<number> {
  return withLock(async () => {
    const records = await readRecords()
    let appended = 0
    for (let i = 0; i < records.length; i++) {
      const record = records[i]
      if (record.status !== 'active') continue
      const model = models.find((m) => m.provider.slug === record.provider && m.slug === record.model)
      if (model === undefined) continue
      const snapshot = createSnapshot(model.prices[0] ?? model.price)
      if (snapshotsEqual(record.priceHistory[record.priceHistory.length - 1], snapshot)) continue
      records[i] = {
        ...record,
        updatedAt: new Date().toISOString(),
        priceHistory: [...record.priceHistory, snapshot],
      }
      appended++
    }
    if (appended > 0) await writeRecords(records)
    return appended
  })
}

/**
 * Get the latest price snapshot for a watched model.
 * Returns null if no price history exists.
 */
export async function getLatestPrice(key: string): Promise<PriceSnapshot | null> {
  const record = await getWatchlistEntry(key)
  if (!record || record.priceHistory.length === 0) return null
  return record.priceHistory[record.priceHistory.length - 1]
}

/**
 * Get price change between two time points.
 * Returns null if the model doesn't exist or has no history.
 *
 * Accuracy rules:
 * - Only the `PRICE_FIELDS` whitelist is compared (snapshots are built from
 *   it, so the union here cannot drift from the contract).
 * - A field missing in one snapshot is reported as `null` on that side
 *   (appeared/disappeared), never conflated with a zero price.
 * - When the two snapshots use different currencies, numeric comparison is
 *   meaningless: `currencyChanged` is set and the caller should not derive
 *   an up/down direction from `changes`.
 */
export async function getPriceChange(
  key: string,
  fromTime?: string,
  toTime?: string,
): Promise<PriceChangeResult | null> {
  const record = await getWatchlistEntry(key)
  if (!record || record.priceHistory.length === 0) return null

  const history = record.priceHistory
  const from = fromTime
    ? history.find((s) => s.time >= fromTime) ?? history[0]
    : history[0]
  const to = toTime
    ? history.findLast((s) => s.time <= toTime) ?? history[history.length - 1]
    : history[history.length - 1]

  // Calculate changes for all price fields (union of both snapshots; a field
  // absent on one side shows as null, never as a zero).
  const allKeys = new Set([...Object.keys(from.prices), ...Object.keys(to.prices)])
  const changes: Record<string, { old: number | null; new: number | null }> = {}
  for (const priceKey of allKeys) {
    changes[priceKey] = {
      old: from.prices[priceKey] ?? null,
      new: to.prices[priceKey] ?? null,
    }
  }

  const currencyChanged = from.currency !== to.currency
  return { from, to, changes, currencyChanged }
}

/**
 * Batch variant of {@link getPriceChange}: keys without a record or without
 * history are absent from the result map (never `null`-keyed garbage).
 * Bounded by the route's key cap.
 */
export async function getPriceChanges(
  keys: readonly string[],
): Promise<Record<string, PriceChangeResult | null>> {
  const records = await readRecords()
  const byKey = new Map(records.map((record) => [record.key, record]))
  const out: Record<string, PriceChangeResult | null> = {}
  for (const key of keys) {
    const record = byKey.get(key)
    if (record === undefined || record.priceHistory.length === 0) continue
    const from = record.priceHistory[0]
    const to = record.priceHistory[record.priceHistory.length - 1]
    const allKeys = new Set([...Object.keys(from.prices), ...Object.keys(to.prices)])
    const changes: Record<string, { old: number | null; new: number | null }> = {}
    for (const priceKey of allKeys) {
      changes[priceKey] = {
        old: from.prices[priceKey] ?? null,
        new: to.prices[priceKey] ?? null,
      }
    }
    out[key] = {
      from,
      to,
      changes,
      currencyChanged: from.currency !== to.currency,
    }
  }
  return out
}
