/**
 * Small display formatters shared by the prices panel and the detail popup.
 *
 * LLMRates numbers are raw values; the currency lives in each price row's
 * `priceUnit` field. Symbols are derived from that unit (rows without one
 * default to USD) — never hardcoded.
 * @module dsh-llm-quotes/client/format
 */

import type { PriceInfo } from '../types.ts'

/** Currency codes → display symbols (unknown codes fall back to the code). */
const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  USD: '$',
  CNY: '¥',
  CNH: '¥',
  JPY: '¥',
  EUR: '€',
  GBP: '£',
  KRW: '₩',
  HKD: 'HK$',
  SGD: 'S$',
  AUD: 'A$',
  CAD: 'C$',
  RUB: '₽',
  INR: '₹',
  BRL: 'R$',
}

/** Map non-standard currency codes to the ISO code used for FX lookup. */
const CURRENCY_ALIASES: Readonly<Record<string, string>> = { CNH: 'CNY' }

/** Canonical ISO code for FX lookup (unknown/empty → null). */
export function canonCurrency(unit: string | null | undefined): string | null {
  if (typeof unit !== 'string' || unit.length === 0) return null
  const upper = unit.trim().toUpperCase()
  return CURRENCY_ALIASES[upper] ?? upper
}

/**
 * Convert a price value from `fromUnit` to `toUnit` using USD-based FX rates
 * (`rates[code]` = units per 1 USD, e.g. from open.er-api.com). Returns `null`
 * when either code is unknown or a rate is non-positive — callers then fall
 * back to showing the native currency. Same-currency conversions return the
 * value unchanged.
 */
export function convertCurrency(
  value: number,
  fromUnit: string | null | undefined,
  toUnit: string | null | undefined,
  rates: Readonly<Record<string, number>>,
): number | null {
  const from = canonCurrency(fromUnit)
  const to = canonCurrency(toUnit)
  if (from === null || to === null) return null
  if (from === to) return value
  const fromRate = rates[from]
  const toRate = rates[to]
  if (typeof fromRate !== 'number' || typeof toRate !== 'number' || fromRate <= 0) return null
  return value * toRate / fromRate
}

/** A stable key identifying a price row's pricing tier (labels/tier text). */
export function priceTierKey(price: PriceInfo): string {
  return [price.tierLabel, price.processingTier]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .map((part) => part.toLowerCase())
    .join('|')
}

/** The human-readable tier label of a price row, when it carries one. */
export function priceTierLabel(price: PriceInfo): string | null {
  if (typeof price.tierLabel === 'string' && price.tierLabel.length > 0) return price.tierLabel
  if (typeof price.processingTier === 'string' && price.processingTier.length > 0) return price.processingTier
  return null
}

/** True when a price row is a discounted / off-peak / promotional tier. */
export function isDiscountedPrice(price: PriceInfo): boolean {
  return /off.?peak|off.?time|discount|promo|sale|reduced|non.?peak|non.?prime/.test(priceTierKey(price))
}

/**
 * Choose a model's price row for a comparison: prefer the standard
 * (non-discounted) row so every column compares peak-to-peak / standard-to-
 * standard. DeepSeek-style providers expose off-peak discount rows alongside
 * the standard price; standardizing on the standard row keeps the comparison
 * apples-to-apples. A model with only discount rows falls back to its display
 * price (the discounted one is then shown, flagged via `isDiscountedPrice`).
 */
export function chooseComparePrice(model: { prices: readonly PriceInfo[]; price: PriceInfo }): PriceInfo {
  const prices = model.prices.length > 0 ? model.prices : [model.price]
  const standard = prices.find((p) => !isDiscountedPrice(p))
  return standard ?? pickDisplayPrice(prices) ?? model.price
}

/** The display symbol for one price row's currency; '' defaults to USD. */
export function currencySymbol(unit: string | null | undefined): string {
  if (typeof unit !== 'string' || unit.length === 0) return '$'
  const upper = unit.trim().toUpperCase()
  return CURRENCY_SYMBOLS[upper] ?? `${upper} `
}

export function formatPrice(value: number | null | undefined, unit?: string | null): string {
  if (value === null || value === undefined) return '—'
  if (value === 0) return `${currencySymbol(unit)}0`
  const text = value < 1 ? value.toFixed(4) : value.toFixed(2)
  return `${currencySymbol(unit)}${text.replace(/\.?0+$/, '')}`
}

/**
 * Display priority of one price row's currency: CNY first, then USD, then
 * any other currency (order irrelevant). Rows without a unit are USD.
 */
export function priceUnitPriority(unit: string | null | undefined): number {
  if (typeof unit !== 'string' || unit.length === 0) return 1
  const upper = unit.trim().toUpperCase()
  if (upper === 'CNY' || upper === 'CNH') return 0
  if (upper === 'USD') return 1
  return 2
}

/** True when a price row carries per-token input/output prices. */
function hasTokenPrice(price: PriceInfo): boolean {
  return typeof price.inputPricePerMillion === 'number' || typeof price.outputPricePerMillion === 'number'
}

/**
 * The price row a model's table row should display: prefers a CNY row, then
 * a USD row, then any other currency; within the preferred group a row that
 * actually has input/output prices wins. Stable — ties keep dataset order.
 */
export function pickDisplayPrice(prices: readonly PriceInfo[] | undefined): PriceInfo | undefined {
  if (prices === undefined || prices.length === 0) return undefined
  const ordered = [...prices].sort((a, b) => priceUnitPriority(a.priceUnit) - priceUnitPriority(b.priceUnit))
  const withTokenPrice = ordered.filter(hasTokenPrice)
  return (withTokenPrice.length > 0 ? withTokenPrice : ordered)[0]
}

export function formatContext(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`
  return String(value)
}

export function formatTime(epochMs: number): string {
  const d = new Date(epochMs)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

/** Format a timestamp (epoch ms or ISO string) as `MM-DD`; '—' when absent. */
export function formatDay(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const date = new Date(typeof value === 'string' ? value : value)
  if (Number.isNaN(date.getTime())) return '—'
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${month}-${day}`
}