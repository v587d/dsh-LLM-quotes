/**
 * Watchlist price-change signal derivation (pure, unit-tested).
 *
 * A watchlist record's price history is reduced to one of three signals for
 * the composer model menu: up (red), down (green), none (gray).
 * @module dsh-llm-quotes/client/signals
 */

import type { PriceChangeResult } from '../types.ts'
import type { LlmQuotesKey } from './locales.ts'

/** One changed price field, already localized. */
export interface PriceSignalField {
  readonly label: string
  readonly old: number | null
  readonly new: number | null
}

/** The watchlist signal a menu row displays. */
export interface PriceSignal {
  /** up = any price rose (a new price appearing counts as up); down = any
   * price fell (a price disappearing counts as down); none = unchanged. */
  readonly direction: 'up' | 'down' | 'none'
  readonly currencyChanged: boolean
  readonly fields: readonly PriceSignalField[]
  readonly fromTime: string
  readonly toTime: string
  /** Currency of the compared snapshots (for formatting tooltip values). */
  readonly currency: string
}

/**
 * Reduce a price-change result to a single signal. Accuracy rules:
 * - fields unchanged between the snapshots are dropped;
 * - a field missing on one side shows as `null` on that side (appeared /
 *   disappeared), never as a zero;
 * - when the snapshots' currencies differ, no up/down direction is derived
 *   (`direction` is 'none', `currencyChanged` is true) — comparing numbers
 *   across currencies would be meaningless.
 */
export function priceSignalOf(
  result: PriceChangeResult,
  labelOf: (field: string) => string,
): PriceSignal {
  const fields: PriceSignalField[] = []
  let up = false
  let down = false
  for (const [field, change] of Object.entries(result.changes)) {
    if (change.old === change.new) continue
    fields.push({ label: labelOf(field), old: change.old, new: change.new })
    if (change.old === null) {
      up = true // a price appeared
      continue
    }
    if (change.new === null) {
      down = true // a price disappeared
      continue
    }
    if (change.new > change.old) up = true
    else if (change.new < change.old) down = true
  }
  const currencyChanged = result.currencyChanged === true
  return {
    direction: currencyChanged ? 'none' : up ? 'up' : down ? 'down' : 'none',
    currencyChanged,
    fields,
    fromTime: result.from?.time ?? '',
    toTime: result.to?.time ?? '',
    currency: result.to?.currency ?? result.from?.currency ?? '',
  }
}

/** Price field → existing `detail.*` locale key for tooltip labels. */
export const PRICE_FIELD_LABEL_KEYS: Readonly<Record<string, LlmQuotesKey>> = {
  inputPricePerMillion: 'detail.input',
  outputPricePerMillion: 'detail.output',
  thinkingOutputPricePerMillion: 'detail.thinkingOutput',
  cachedInputPricePerMillion: 'detail.cachedInput',
  cachedWritePricePerMillion: 'detail.cachedWrite',
  imagePrice: 'detail.imagePrice',
  imagePricePerMillion: 'detail.imagePricePerMillion',
  audioPricePerHour: 'detail.audioPricePerHour',
  audioPricePerMillion: 'detail.audioPricePerMillion',
  videoPrice: 'detail.videoPrice',
  videoPricePerSecond: 'detail.videoPricePerSecond',
  videoPricePerMillion: 'detail.videoPricePerMillion',
  characterPricePerMillion: 'detail.characterPricePerMillion',
  pagePrice: 'detail.pagePrice',
  searchPricePerThousand: 'detail.searchPricePerThousand',
  trackPrice: 'detail.trackPrice',
}
