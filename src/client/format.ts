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