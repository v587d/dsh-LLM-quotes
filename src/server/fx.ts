/**
 * Host-side FX rates for unifying mixed currencies in the compare table.
 *
 * LLMRates prices carry their own `priceUnit` (USD, CNY, …). Comparing models
 * across providers therefore mixes currencies, so the compare table normalizes
 * every price to one base currency.
 *
 * Rates come from a chain of free, key-less sources, in order of preference:
 *  1. Frankfurter (ECB official reference rates) — the most stable;
 *  2. open.er-api.com (exchange-rates-backed);
 *  3. the built-in approximation (marked `stale`).
 * The last successful rate set is cached to `~/.dsh/llm-quotes-fx.json` so a
 * cold start or an API outage still serves a real rate set rather than nothing.
 * @module dsh-llm-quotes/server/fx
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { FxResponse } from '../types.ts'
import { dshHome } from '../config.ts'

/** Base currency every rate is expressed against. */
export const FX_BASE = 'USD'
/** Rate sources tried in order (each returns units per 1 USD). */
export const FX_URLS = [
  'https://api.frankfurter.dev/v1/latest?base=USD',
  'https://open.er-api.com/v6/latest/USD',
]
/** Timeout per source attempt. */
export const FX_TIMEOUT_MS = 6_000

/**
 * Rough built-in approximation (units per 1 USD), used only when no source
 * and no cache is available. Kept in sync with the currencies the dataset uses.
 */
const FX_FALLBACK: Record<string, number> = {
  USD: 1,
  CNY: 7.25,
  CNH: 7.25,
  JPY: 150,
  EUR: 0.92,
  GBP: 0.79,
  KRW: 1330,
  HKD: 7.8,
  SGD: 1.35,
  AUD: 1.5,
  CAD: 1.36,
  RUB: 90,
  INR: 83,
  BRL: 5,
}

interface Cache {
  readonly rates: Record<string, number>
  readonly fetchedAt: number
  readonly stale: boolean
}

let cached: Cache | null = null
let inflight: Promise<FxResponse> | undefined

/** True when two epoch-millis timestamps fall on the same local calendar day. */
function sameLocalDay(a: number, b: number): boolean {
  const da = new Date(a)
  const db = new Date(b)
  return da.getFullYear() === db.getFullYear()
    && da.getMonth() === db.getMonth()
    && da.getDate() === db.getDate()
}

/** Keep only positive numeric rates, upper-cased. */
function normalizeRates(raw: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [code, value] of Object.entries(raw)) {
    const key = code.trim().toUpperCase()
    if (key.length === 0) continue
    if (typeof value === 'number' && value > 0) out[key] = value
  }
  return out
}

function toFx(cache: Cache): FxResponse {
  return { base: FX_BASE, rates: cache.rates, fetchedAt: cache.fetchedAt, stale: cache.stale }
}

/** Fetch one URL; throws when unreachable or the payload is bad. */
async function fetchOne(url: string): Promise<FxResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FX_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`FX request failed: HTTP ${response.status}`)
    const payload = await response.json() as { base?: string; base_code?: string; rates?: Record<string, number> }
    if (payload.rates === undefined) throw new Error('bad-fx-payload')
    return {
      base: (payload.base ?? payload.base_code ?? FX_BASE).toUpperCase(),
      rates: normalizeRates(payload.rates),
      fetchedAt: Date.now(),
      stale: false,
    }
  } finally {
    clearTimeout(timer)
  }
}

/** Try each source in order; throws only when every source fails. */
async function fetchRates(): Promise<FxResponse> {
  let lastError: unknown
  for (const url of FX_URLS) {
    try {
      return await fetchOne(url)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError ?? new Error('fx-unavailable')
}

function fxCachePath(): string {
  return join(dshHome(), 'llm-quotes-fx.json')
}

function loadFxCache(): Cache | null {
  try {
    const raw = readFileSync(fxCachePath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<Cache> | null
    if (parsed === null || typeof parsed !== 'object') return null
    if (typeof parsed.rates !== 'object' || parsed.rates === null) return null
    return {
      rates: parsed.rates as Record<string, number>,
      fetchedAt: typeof parsed.fetchedAt === 'number' ? parsed.fetchedAt : 0,
      stale: parsed.stale === true,
    }
  } catch {
    return null
  }
}

function saveFxCache(cache: Cache): void {
  try {
    const path = fxCachePath()
    const dir = dirname(path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(path, `${JSON.stringify(cache)}\n`, { mode: 0o600 })
    try {
      chmodSync(path, 0o600)
    } catch {
      // Best-effort.
    }
  } catch {
    // Cache write failure is non-fatal.
  }
}

/**
 * Return current FX rates, cached for the day. Tries the live sources first;
 * on failure falls back to the last-good disk cache (kept from a previous
 * successful fetch), then to the built-in approximation (marked `stale`) so a
 * mixed-currency comparison still renders unified prices instead of failing.
 */
export async function getFxRates(): Promise<FxResponse> {
  if (cached !== null && sameLocalDay(cached.fetchedAt, Date.now())) return toFx(cached)
  if (inflight !== undefined) return inflight

  inflight = (async (): Promise<FxResponse> => {
    try {
      const fx = await fetchRates()
      const cache: Cache = { rates: fx.rates, fetchedAt: fx.fetchedAt, stale: false }
      cached = cache
      saveFxCache(cache)
      return fx
    } catch {
      const disk = loadFxCache()
      if (disk !== null) {
        cached = disk
        return toFx(disk)
      }
      const fallback: Cache = { rates: FX_FALLBACK, fetchedAt: Date.now(), stale: true }
      cached = fallback
      saveFxCache(fallback)
      return toFx(fallback)
    } finally {
      inflight = undefined
    }
  })()
  return inflight
}
